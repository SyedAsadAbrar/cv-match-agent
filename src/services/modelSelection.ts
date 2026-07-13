import { normalizeProviderName } from "../ai/providers";
import { resolveOllamaModel } from "../ai/providers/ollamaProvider";
import { resolveRecommendedModel } from "../benchmark/recommendations";
import type { AnalysisModelSelection, BenchmarkMode } from "../benchmark/types";

export type ModelSelectionOptions = {
  provider?: string;
  model?: string;
  mode?: string;
};

export type ResolvedModelSelection = {
  provider: "ollama" | "openai";
  model?: string;
  metadata: AnalysisModelSelection;
};

type RecommendationResolver = (mode: BenchmarkMode) => Promise<{
  model: string;
  modelDigest: string;
  benchmarkVersion: string;
}>;

export async function resolveModelSelection(
  options: ModelSelectionOptions,
  recommendationResolver: RecommendationResolver = (mode) => resolveRecommendedModel(mode)
): Promise<ResolvedModelSelection> {
  const provider = normalizeProviderName(options.provider);
  const mode = options.mode === undefined ? undefined : normalizeBenchmarkMode(options.mode);

  if (options.model !== undefined && mode !== undefined) {
    throw new Error("--model and --mode cannot be used together. Choose an explicit model or a benchmark recommendation.");
  }
  if (mode !== undefined && provider !== "ollama") {
    throw new Error("--mode is available only with the Ollama provider.");
  }
  if (options.model !== undefined && provider === "openai") {
    throw new Error("The --model option selects an Ollama model and cannot be used with --provider openai.");
  }

  if (mode) {
    const recommendation = await recommendationResolver(mode);
    return {
      provider,
      model: recommendation.model,
      metadata: {
        type: "benchmark-recommendation",
        mode,
        benchmarkVersion: recommendation.benchmarkVersion,
        modelDigest: recommendation.modelDigest
      }
    };
  }

  if (options.model !== undefined) {
    return { provider, model: options.model, metadata: { type: "explicit" } };
  }

  if (provider === "openai") {
    return { provider, metadata: { type: "environment" } };
  }

  const environmentModel = process.env.OLLAMA_MODEL;
  return {
    provider,
    model: resolveOllamaModel(undefined, environmentModel),
    metadata: { type: environmentModel === undefined ? "default" : "environment" }
  };
}

export function normalizeBenchmarkMode(value: string): BenchmarkMode {
  const normalized = value.toLowerCase();
  if (normalized !== "fast" && normalized !== "balanced" && normalized !== "quality") {
    throw new Error(`Unsupported benchmark mode "${value}". Use "fast", "balanced", or "quality".`);
  }
  return normalized;
}
