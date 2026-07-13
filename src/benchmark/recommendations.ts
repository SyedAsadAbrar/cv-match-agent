import { OllamaClient, type OllamaModel } from "../ai/ollamaClient";
import { BenchmarkCache } from "./cache";
import {
  BENCHMARK_PROMPT_VERSION,
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_VERSION,
  FIXTURE_VERSION
} from "./constants";
import type { BenchmarkMode, BenchmarkReport, ModelBenchmarkResult } from "./types";

export type RecommendationStatus = {
  mode: BenchmarkMode;
  model?: string;
  modelDigest?: string;
  valid: boolean;
  reason?: string;
};

type RecommendationClient = { listModels(): Promise<OllamaModel[]> };
type RecommendationCache = { latest(): Promise<{ report?: BenchmarkReport; corrupted: boolean }> };

export async function loadRecommendationStatuses(dependencies: {
  client?: RecommendationClient;
  cache?: RecommendationCache;
} = {}): Promise<{ report?: BenchmarkReport; statuses: RecommendationStatus[]; corrupted: boolean }> {
  const client = dependencies.client ?? new OllamaClient();
  const cache = dependencies.cache ?? new BenchmarkCache();
  const { report, corrupted } = await cache.latest();
  if (!report) {
    return { statuses: unavailableStatuses(corrupted ? "The benchmark cache is corrupted." : "No cached benchmark exists."), corrupted };
  }

  const compatibilityReason = reportCompatibilityError(report);
  if (compatibilityReason) {
    return { report, statuses: unavailableStatuses(compatibilityReason), corrupted };
  }

  const installed = await client.listModels();

  return {
    report,
    corrupted,
    statuses: (["fast", "balanced", "quality"] as BenchmarkMode[]).map((mode) =>
      validateRecommendation(mode, report, installed)
    )
  };
}

export async function resolveRecommendedModel(
  mode: BenchmarkMode,
  dependencies: { client?: RecommendationClient; cache?: RecommendationCache } = {}
): Promise<{ model: string; modelDigest: string; benchmarkVersion: string }> {
  const { report, statuses } = await loadRecommendationStatuses(dependencies);
  const status = statuses.find((candidate) => candidate.mode === mode);
  if (!report || !status?.valid || !status.model || !status.modelDigest) {
    throw new Error(
      `No valid ${mode}-model recommendation was found.${status?.reason ? ` ${status.reason}` : ""}\n\nRun:\n  npm run dev -- models benchmark\n\nOr select a model explicitly:\n  npm run dev -- analyze ... --model <model>`
    );
  }
  return { model: status.model, modelDigest: status.modelDigest, benchmarkVersion: report.benchmarkVersion };
}

export function validateRecommendation(
  mode: BenchmarkMode,
  report: BenchmarkReport,
  installed: OllamaModel[]
): RecommendationStatus {
  const model = report.recommendations[mode];
  if (!model) return { mode, valid: false, reason: "No eligible model qualified for this mode." };
  const result = report.models.find((candidate) => candidate.model === model);
  if (!result || !result.eligibleForRecommendation) {
    return { mode, model, valid: false, reason: "The cached model is no longer eligible." };
  }
  const installedModel = installed.find((candidate) => candidate.name === model || candidate.model === model);
  if (!installedModel) {
    return { mode, model, modelDigest: result.modelDigest, valid: false, reason: "The recommended model is no longer installed." };
  }
  if (installedModel.digest !== result.modelDigest) {
    return { mode, model, modelDigest: result.modelDigest, valid: false, reason: "The installed model digest changed; cached results are stale." };
  }
  return { mode, model, modelDigest: result.modelDigest, valid: true };
}

export function reportCompatibilityError(report: BenchmarkReport): string | undefined {
  if (report.benchmarkVersion !== BENCHMARK_VERSION) return "The benchmark version changed; cached results are stale.";
  if (report.fixtureVersion !== FIXTURE_VERSION) return "The fixture version changed; cached results are stale.";
  if (report.promptVersion !== BENCHMARK_PROMPT_VERSION) return "The benchmark prompt version changed; cached results are stale.";
  if (report.schemaVersion !== BENCHMARK_SCHEMA_VERSION) return "The benchmark schema version changed; cached results are stale.";
  return undefined;
}

export function findModelResult(report: BenchmarkReport, model: string): ModelBenchmarkResult | undefined {
  return report.models.find((candidate) => candidate.model === model);
}

function unavailableStatuses(reason: string): RecommendationStatus[] {
  return (["fast", "balanced", "quality"] as BenchmarkMode[]).map((mode) => ({ mode, valid: false, reason }));
}
