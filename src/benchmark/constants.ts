import type { BenchmarkGenerationSettings } from "./types";

export const BENCHMARK_VERSION = "1";
export const FIXTURE_VERSION = "1";
export const BENCHMARK_PROMPT_VERSION = "1";
export const BENCHMARK_SCHEMA_VERSION = "1";
export const DEFAULT_BENCHMARK_RUNS = 3;
export const MIN_BENCHMARK_RUNS = 1;
export const MAX_BENCHMARK_RUNS = 10;

export const BENCHMARK_GENERATION_SETTINGS: BenchmarkGenerationSettings = {
  temperature: 0,
  seed: 42,
  maxTokens: 1_500,
  jsonMode: true,
  optionSupport: "requested-unverified"
};

export const TASK_SCORE_WEIGHTS = {
  grounding: 0.45,
  completeness: 0.35,
  schemaReliability: 0.2
} as const;

export const QUALITY_SCORE_WEIGHTS = {
  grounding: 0.4,
  completeness: 0.3,
  schemaReliability: 0.2,
  consistency: 0.1
} as const;

export const BALANCED_SCORE_WEIGHTS = {
  quality: 0.7,
  relativeSpeed: 0.3
} as const;

export const ELIGIBILITY_THRESHOLDS = {
  successRate: 0.8,
  schemaSuccessRate: 0.8,
  groundingScore: 75,
  qualityScore: 70
} as const;
