export type BenchmarkMode = "fast" | "balanced" | "quality";

export type BenchmarkTaskName = "job-extraction" | "profile-matching" | "grounded-writing";

export type ScoreReason = {
  code: string;
  deduction: number;
  detail: string;
};

export type BenchmarkScore = {
  completenessScore: number;
  groundingScore: number;
  taskScore: number;
  semanticFacts: string[];
  catastrophicFabrication: boolean;
  reasons: ScoreReason[];
};

export type BenchmarkRunMetrics = {
  model: string;
  modelDigest: string;
  task: BenchmarkTaskName;
  runNumber: number;
  success: boolean;
  schemaValid: boolean;
  repairAttempts: number;
  totalDurationMs: number;
  loadDurationMs?: number;
  promptEvaluationDurationMs?: number;
  generationDurationMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
  completenessScore: number;
  groundingScore: number;
  taskScore: number;
  semanticFacts: string[];
  catastrophicFabrication: boolean;
  scoreReasons: ScoreReason[];
  errors: string[];
  rawResponses?: string[];
};

export type ModelBenchmarkResult = {
  model: string;
  modelDigest: string;
  benchmarkVersion: string;
  runs: BenchmarkRunMetrics[];
  successRate: number;
  schemaSuccessRate: number;
  averageRepairAttempts: number;
  averageDurationMs: number;
  averageTokensPerSecond?: number;
  completenessScore: number;
  groundingScore: number;
  consistencyScore: number;
  qualityScore: number;
  eligibleForRecommendation: boolean;
  disqualificationReasons: string[];
  inspectionNote?: string;
};

export type BenchmarkRecommendations = {
  fast?: string;
  balanced?: string;
  quality?: string;
};

export type BenchmarkGenerationSettings = {
  temperature: number;
  seed: number;
  maxTokens: number;
  jsonMode: true;
  optionSupport: "requested-unverified";
};

export type BenchmarkReport = {
  generatedAt: string;
  benchmarkVersion: string;
  fixtureVersion: string;
  promptVersion: string;
  schemaVersion: string;
  runsPerTask: number;
  generationSettings: BenchmarkGenerationSettings;
  models: ModelBenchmarkResult[];
  recommendations: BenchmarkRecommendations;
};

export type BenchmarkCacheIdentity = {
  model: string;
  modelDigest: string;
  benchmarkVersion: string;
  fixtureVersion: string;
  promptVersion: string;
  schemaVersion: string;
  runsPerTask: number;
};

export type BenchmarkCacheFile = {
  cacheFormatVersion: "1";
  entries: ModelBenchmarkResult[];
  identities: BenchmarkCacheIdentity[];
  latestReport?: BenchmarkReport;
};

export type AnalysisModelSelection =
  | { type: "explicit" }
  | { type: "environment" }
  | { type: "default" }
  | {
      type: "benchmark-recommendation";
      mode: BenchmarkMode;
      benchmarkVersion: string;
      modelDigest: string;
    };
