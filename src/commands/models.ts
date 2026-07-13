import { Command } from "commander";
import { OllamaClient, type OllamaModel } from "../ai/ollamaClient";
import {
  collectModelOption,
  parseRunCount,
  runOllamaBenchmark,
  type BenchmarkProgress
} from "../benchmark/benchmarkRunner";
import { loadRecommendationStatuses } from "../benchmark/recommendations";
import type { BenchmarkReport } from "../benchmark/types";
import { logger } from "../utils/logger";

type BenchmarkCommandOptions = {
  model: string[];
  runs: string;
  force?: boolean;
};

export function createModelsCommand(): Command {
  const modelsCommand = new Command("models").description("Inspect locally installed Ollama models.");

  modelsCommand
    .command("list")
    .description("List models installed in the local Ollama instance.")
    .action(async () => {
      const client = new OllamaClient();
      const models = await client.listModels();

      if (models.length === 0) {
        logger.info(`No local Ollama models found at ${client.baseUrl}.`);
        logger.info("Install one first, for example: ollama pull deepseek-r1:8b");
        return;
      }

      logger.info("Installed Ollama models\n");
      logger.info(formatModelTable(models));
    });

  modelsCommand
    .command("benchmark")
    .description("Benchmark compatible locally installed Ollama models on synthetic CV-matching tasks.")
    .option("--model <model>", "Benchmark a specific installed model; repeat to select several.", collectModelOption, [])
    .option("--runs <number>", "Runs per model per task (1-10).", "3")
    .option("--force", "Bypass valid cached model results.")
    .action(async (options: BenchmarkCommandOptions) => {
      const result = await runOllamaBenchmark(
        {
          models: options.model,
          runs: parseRunCount(options.runs),
          force: options.force
        },
        { progress: renderBenchmarkProgress }
      );
      logger.info(`\n${formatBenchmarkResults(result.report)}`);
      logger.info(`\nDetailed report: ${result.reportDirectory}`);
      if (!Object.values(result.report.recommendations).some(Boolean)) {
        throw new Error(
          "No benchmarked model met the recommendation thresholds. Install another model, try a more capable model, or select a model manually."
        );
      }
    });

  modelsCommand
    .command("recommendations")
    .description("Show recommendations from the most recent valid local benchmark.")
    .action(async () => {
      const { report, statuses, corrupted } = await loadRecommendationStatuses();
      if (!report) {
        logger.info(corrupted ? "The local benchmark cache is corrupted." : "No cached benchmark results were found.");
        logger.info("Run: npm run dev -- models benchmark");
        return;
      }

      logger.info(`Benchmark date: ${report.generatedAt}`);
      logger.info(`Benchmark version: ${report.benchmarkVersion}`);
      for (const status of statuses) {
        const label = status.mode === "quality" ? "Best quality" : capitalize(status.mode);
        if (status.valid) {
          logger.info(`${label}: ${status.model} (${shortDigest(status.modelDigest)})`);
        } else {
          logger.info(`${label}: unavailable — ${status.reason}`);
        }
      }
      if (statuses.some((status) => !status.valid)) {
        logger.info("Run: npm run dev -- models benchmark");
      }
    });

  return modelsCommand;
}

export function formatBenchmarkResults(report: BenchmarkReport): string {
  const headers = ["MODEL", "SCHEMA", "GROUNDING", "QUALITY", "AVG TIME", "ELIGIBLE"];
  const rows = report.models.map((result) => [
    result.model,
    `${(result.schemaSuccessRate * 100).toFixed(0)}%`,
    result.groundingScore.toFixed(1),
    result.qualityScore.toFixed(1),
    `${(result.averageDurationMs / 1000).toFixed(1)}s`,
    result.eligibleForRecommendation ? "yes" : "no"
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const line = (row: string[]) => row.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
  const recommendations = [
    "",
    "Recommendations",
    `Fast:          ${report.recommendations.fast ?? "Unavailable"}`,
    `Balanced:      ${report.recommendations.balanced ?? "Unavailable"}`,
    `Best quality:  ${report.recommendations.quality ?? "Unavailable"}`
  ];
  const ineligible = report.models.filter((result) => !result.eligibleForRecommendation);
  const reasons = ineligible.length === 0
    ? []
    : [
        "",
        "Ineligible models",
        ...ineligible.flatMap((result) => [result.model, ...result.disqualificationReasons.map((reason) => `  - ${reason}`)])
      ];
  return ["Results", "", line(headers), ...rows.map(line), ...reasons, ...recommendations].join("\n");
}

function renderBenchmarkProgress(event: BenchmarkProgress): void {
  if (event.type === "start") {
    logger.info(`Benchmarking ${event.modelCount} local Ollama model${event.modelCount === 1 ? "" : "s"}`);
    logger.info(`Runs per task: ${event.runs}\n`);
  } else if (event.type === "model") {
    logger.info(`[${event.index}/${event.total}] ${event.model}`);
  } else if (event.type === "cache") {
    logger.info("  Reused valid cached result");
  } else {
    const task = event.task.split("-").map(capitalize).join(" ");
    logger.info(`  ${event.success ? "✓" : "✗"} ${task}${event.error ? `: ${event.error}` : ""}`);
  }
}

function shortDigest(value?: string): string {
  return value ? value.slice(0, 12) : "unknown digest";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatModelTable(models: OllamaModel[]): string {
  const rows = models
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((model) => [
      model.name,
      model.details?.parameterSize ?? "-",
      model.details?.quantizationLevel ?? "-",
      formatByteSize(model.size),
      model.details?.family ?? "-"
    ]);
  const headers = ["MODEL", "PARAMETERS", "QUANTIZATION", "SIZE", "FAMILY"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const formatRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  return [formatRow(headers), ...rows.map(formatRow)].join("\n");
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${value} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}
