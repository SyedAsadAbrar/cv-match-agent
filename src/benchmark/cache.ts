import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BenchmarkCacheFile,
  BenchmarkCacheIdentity,
  BenchmarkReport,
  ModelBenchmarkResult
} from "./types";

const EMPTY_CACHE: BenchmarkCacheFile = {
  cacheFormatVersion: "1",
  entries: [],
  identities: []
};

export type BenchmarkCacheOptions = {
  dataDir?: string;
};

export class BenchmarkCache {
  public readonly benchmarkDir: string;
  public readonly resultsPath: string;

  constructor(options: BenchmarkCacheOptions = {}) {
    this.benchmarkDir = path.join(options.dataDir ?? getAppDataDir(), "benchmarks");
    this.resultsPath = path.join(this.benchmarkDir, "results.json");
  }

  async get(identity: BenchmarkCacheIdentity, force = false): Promise<ModelBenchmarkResult | undefined> {
    if (force) return undefined;
    const { data } = await this.read();
    const index = data.identities.findIndex((candidate) => cacheIdentityMatches(candidate, identity));
    return index >= 0 ? data.entries[index] : undefined;
  }

  async latest(): Promise<{ report?: BenchmarkReport; corrupted: boolean }> {
    const { data, corrupted } = await this.read();
    return { ...(data.latestReport ? { report: data.latestReport } : {}), corrupted };
  }

  async saveReport(report: BenchmarkReport, identities: BenchmarkCacheIdentity[]): Promise<string> {
    const { data } = await this.read();
    const next: BenchmarkCacheFile = {
      cacheFormatVersion: "1",
      entries: [...data.entries],
      identities: [...data.identities],
      latestReport: report
    };

    for (const identity of identities) {
      const result = report.models.find(
        (modelResult) => modelResult.model === identity.model && modelResult.modelDigest === identity.modelDigest
      );
      if (!result) continue;
      const existing = next.identities.findIndex((candidate) => cacheIdentityMatches(candidate, identity));
      if (existing >= 0) {
        next.identities[existing] = identity;
        next.entries[existing] = result;
      } else {
        next.identities.push(identity);
        next.entries.push(result);
      }
    }

    await fs.mkdir(this.benchmarkDir, { recursive: true });
    await writeJsonAtomic(this.resultsPath, next);

    const runDir = path.join(this.benchmarkDir, "runs", safeTimestamp(report.generatedAt));
    await fs.mkdir(path.join(runDir, "raw"), { recursive: true });
    await writeJsonAtomic(path.join(runDir, "summary.json"), report);
    await fs.writeFile(path.join(runDir, "summary.md"), renderBenchmarkMarkdown(report), "utf8");
    await this.writeRawOutputs(runDir, report);
    return runDir;
  }

  private async read(): Promise<{ data: BenchmarkCacheFile; corrupted: boolean }> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.resultsPath, "utf8")) as unknown;
      if (!isBenchmarkCacheFile(parsed)) return { data: { ...EMPTY_CACHE }, corrupted: true };
      return { data: parsed, corrupted: false };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : undefined;
      return { data: { ...EMPTY_CACHE }, corrupted: code !== "ENOENT" };
    }
  }

  private async writeRawOutputs(runDir: string, report: BenchmarkReport): Promise<void> {
    for (const model of report.models) {
      for (const run of model.runs) {
        if (!run.rawResponses || run.rawResponses.length === 0) continue;
        const baseName = `${sanitize(model.model)}-${run.task}-run-${run.runNumber}`;
        await writeJsonAtomic(path.join(runDir, "raw", `${baseName}.json`), {
          model: model.model,
          modelDigest: model.modelDigest,
          task: run.task,
          runNumber: run.runNumber,
          responses: run.rawResponses,
          errors: run.errors
        });
      }
    }
  }
}

export function getAppDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  homeDir = os.homedir()
): string {
  if (env.CV_MATCH_AGENT_DATA_DIR) return path.resolve(env.CV_MATCH_AGENT_DATA_DIR);
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(homeDir, "AppData", "Local"), "cv-match-agent");
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support", "cv-match-agent");
  return path.join(env.XDG_DATA_HOME ?? path.join(homeDir, ".local", "share"), "cv-match-agent");
}

export function cacheIdentityMatches(left: BenchmarkCacheIdentity, right: BenchmarkCacheIdentity): boolean {
  return left.model === right.model
    && left.modelDigest === right.modelDigest
    && left.benchmarkVersion === right.benchmarkVersion
    && left.fixtureVersion === right.fixtureVersion
    && left.promptVersion === right.promptVersion
    && left.schemaVersion === right.schemaVersion
    && left.runsPerTask === right.runsPerTask;
}

export function renderBenchmarkMarkdown(report: BenchmarkReport): string {
  const lines = [
    "# Local Ollama Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    `Benchmark version: ${report.benchmarkVersion}`,
    `Runs per task: ${report.runsPerTask}`,
    "",
    "| Model | Schema | Grounding | Quality | Average time | Eligible |",
    "| --- | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const result of report.models) {
    lines.push(`| ${result.model} | ${(result.schemaSuccessRate * 100).toFixed(1)}% | ${result.groundingScore.toFixed(1)} | ${result.qualityScore.toFixed(1)} | ${(result.averageDurationMs / 1000).toFixed(1)}s | ${result.eligibleForRecommendation ? "yes" : "no"} |`);
  }

  const ineligible = report.models.filter((result) => !result.eligibleForRecommendation);
  if (ineligible.length > 0) {
    lines.push("", "## Ineligible models", "");
    for (const result of ineligible) {
      lines.push(`### ${result.model}`, "", ...result.disqualificationReasons.map((reason) => `- ${reason}`), "");
    }
  }

  lines.push(
    "",
    "## Recommendations",
    "",
    `- Fast: ${report.recommendations.fast ?? "Unavailable"}`,
    `- Balanced: ${report.recommendations.balanced ?? "Unavailable"}`,
    `- Best quality: ${report.recommendations.quality ?? "Unavailable"}`,
    ""
  );
  return lines.join("\n");
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function isBenchmarkCacheFile(value: unknown): value is BenchmarkCacheFile {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).cacheFormatVersion === "1"
    && Array.isArray((value as Record<string, unknown>).entries)
    && Array.isArray((value as Record<string, unknown>).identities);
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]+/g, "_");
}
