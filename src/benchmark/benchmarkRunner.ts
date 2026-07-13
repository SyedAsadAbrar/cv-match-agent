import { performance } from "node:perf_hooks";
import { z } from "zod";
import { generateJsonWithSchemaDetailed, JsonGenerationError } from "../ai/json";
import { OllamaClient, inspectModelCompatibility, type OllamaModel, type OllamaModelInfo } from "../ai/ollamaClient";
import { buildComparisonMessages, buildJobExtractionMessages } from "../ai/prompts";
import { jobRequirementsSchema, matchAnalysisSchema } from "../ai/schemas";
import { OllamaProvider } from "../ai/providers/ollamaProvider";
import type { LlmGenerationResult, LlmMessage, LlmProvider } from "../ai/providers/types";
import { BenchmarkCache } from "./cache";
import {
  BENCHMARK_GENERATION_SETTINGS,
  BENCHMARK_PROMPT_VERSION,
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_VERSION,
  DEFAULT_BENCHMARK_RUNS,
  FIXTURE_VERSION,
  MAX_BENCHMARK_RUNS,
  MIN_BENCHMARK_RUNS
} from "./constants";
import type { BenchmarkFixtures } from "./fixtureTypes";
import { loadBenchmarkFixtures } from "./fixtures";
import { buildGroundedWritingBenchmarkMessages } from "./prompts";
import { groundedWritingSchema } from "./schemas";
import { aggregateModelRuns, calculateRecommendations } from "./scoring/aggregateScores";
import { scoreGroundedWriting } from "./scoring/groundedWritingScorer";
import { scoreJobExtraction } from "./scoring/jobExtractionScorer";
import { scoreProfileMatching } from "./scoring/profileMatchingScorer";
import type {
  BenchmarkCacheIdentity,
  BenchmarkReport,
  BenchmarkRunMetrics,
  BenchmarkScore,
  BenchmarkTaskName,
  ModelBenchmarkResult
} from "./types";

export type RunBenchmarkOptions = {
  models?: string[];
  runs?: number;
  force?: boolean;
};

export type BenchmarkProgress =
  | { type: "start"; modelCount: number; runs: number }
  | { type: "model"; model: string; index: number; total: number }
  | { type: "task"; model: string; task: BenchmarkTaskName; success: boolean; error?: string }
  | { type: "cache"; model: string };

type OllamaInspectionClient = {
  listModels(): Promise<OllamaModel[]>;
  showModel(model: string): Promise<OllamaModelInfo>;
};

type BenchmarkCachePort = {
  get(identity: BenchmarkCacheIdentity, force?: boolean): Promise<ModelBenchmarkResult | undefined>;
  saveReport(report: BenchmarkReport, identities: BenchmarkCacheIdentity[]): Promise<string>;
};

export type BenchmarkRunnerDependencies = {
  client?: OllamaInspectionClient;
  cache?: BenchmarkCachePort;
  providerFactory?: (model: string) => LlmProvider;
  fixtures?: BenchmarkFixtures;
  now?: () => Date;
  progress?: (event: BenchmarkProgress) => void;
};

export type RunBenchmarkResult = {
  report: BenchmarkReport;
  reportDirectory: string;
  reusedModels: string[];
};

export async function runOllamaBenchmark(
  options: RunBenchmarkOptions = {},
  dependencies: BenchmarkRunnerDependencies = {}
): Promise<RunBenchmarkResult> {
  const runs = validateRunCount(options.runs ?? DEFAULT_BENCHMARK_RUNS);
  const client = dependencies.client ?? new OllamaClient();
  const cache = dependencies.cache ?? new BenchmarkCache();
  const fixtures = dependencies.fixtures ?? await loadBenchmarkFixtures();
  const providerFactory = dependencies.providerFactory ?? ((model: string) => new OllamaProvider({ model }));
  const installed = (await client.listModels()).slice().sort((left, right) => compareNames(left.name, right.name));
  const candidates = selectCandidates(installed, options.models);
  dependencies.progress?.({ type: "start", modelCount: candidates.length, runs });

  const results: ModelBenchmarkResult[] = [];
  const identities: BenchmarkCacheIdentity[] = [];
  const reusedModels: string[] = [];

  for (const [index, candidate] of candidates.entries()) {
    dependencies.progress?.({ type: "model", model: candidate.name, index: index + 1, total: candidates.length });
    const identity = buildCacheIdentity(candidate, runs);
    const cached = await cache.get(identity, options.force ?? false);
    if (cached) {
      identities.push(identity);
      results.push(cached);
      reusedModels.push(candidate.name);
      dependencies.progress?.({ type: "cache", model: candidate.name });
      continue;
    }

    let info: OllamaModelInfo;
    try {
      info = await client.showModel(candidate.name);
    } catch (error) {
      results.push(failedModelResult(candidate, `Model inspection failed: ${sanitizeBenchmarkError(error)}`));
      continue;
    }

    const compatibility = inspectModelCompatibility(info);
    if (!compatibility.compatible) {
      identities.push(identity);
      results.push(failedModelResult(candidate, compatibility.reason ?? "Model is incompatible with text generation."));
      continue;
    }

    const provider = providerFactory(candidate.name);
    const modelRuns: BenchmarkRunMetrics[] = [];
    for (const task of taskDefinitions(fixtures)) {
      let taskSucceeded = true;
      let taskError: string | undefined;
      for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
        const metrics = await executeTask(provider, candidate, task.name, runNumber, task.messages, task.schema, task.score);
        modelRuns.push(metrics);
        if (!metrics.success) {
          taskSucceeded = false;
          taskError ??= metrics.errors[0];
        }
      }
      dependencies.progress?.({
        type: "task",
        model: candidate.name,
        task: task.name,
        success: taskSucceeded,
        ...(taskError ? { error: taskError } : {})
      });
    }

    identities.push(identity);
    results.push(aggregateModelRuns(candidate.name, candidate.digest, modelRuns, compatibility.reason));
  }

  const report: BenchmarkReport = {
    generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    benchmarkVersion: BENCHMARK_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    promptVersion: BENCHMARK_PROMPT_VERSION,
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    runsPerTask: runs,
    generationSettings: BENCHMARK_GENERATION_SETTINGS,
    models: results,
    recommendations: calculateRecommendations(results)
  };
  const reportDirectory = await cache.saveReport(report, identities);
  return { report, reportDirectory, reusedModels };
}

export function validateRunCount(value: number): number {
  if (!Number.isInteger(value) || value < MIN_BENCHMARK_RUNS || value > MAX_BENCHMARK_RUNS) {
    throw new Error(`--runs must be an integer from ${MIN_BENCHMARK_RUNS} to ${MAX_BENCHMARK_RUNS}.`);
  }
  return value;
}

export function parseRunCount(value: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`--runs must be an integer from ${MIN_BENCHMARK_RUNS} to ${MAX_BENCHMARK_RUNS}.`);
  return validateRunCount(Number(value));
}

export function collectModelOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function selectCandidates(installed: OllamaModel[], requested?: string[]): OllamaModel[] {
  if (!requested || requested.length === 0) return installed;
  const uniqueRequested = [...new Set(requested)];
  const byName = new Map(installed.flatMap((model) => [[model.name, model], [model.model, model]]));
  const missing = uniqueRequested.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Requested Ollama model${missing.length === 1 ? "" : "s"} not installed: ${missing.join(", ")}. Run "npm run dev -- models list".`);
  }
  return uniqueRequested.map((name) => byName.get(name) as OllamaModel);
}

function taskDefinitions(fixtures: BenchmarkFixtures): Array<{
  name: BenchmarkTaskName;
  messages: LlmMessage[];
  schema: z.ZodTypeAny;
  score: (value: unknown) => BenchmarkScore;
}> {
  return [
    {
      name: "job-extraction",
      messages: buildJobExtractionMessages(fixtures.jobExtraction.input),
      schema: jobRequirementsSchema,
      score: (value) => scoreJobExtraction(jobRequirementsSchema.parse(value), fixtures.jobExtraction.expected)
    },
    {
      name: "profile-matching",
      messages: buildComparisonMessages(fixtures.profileMatching.profile, fixtures.profileMatching.requirements),
      schema: matchAnalysisSchema,
      score: (value) => scoreProfileMatching(matchAnalysisSchema.parse(value), fixtures.profileMatching.expected)
    },
    {
      name: "grounded-writing",
      messages: buildGroundedWritingBenchmarkMessages(
        fixtures.groundedWriting.profile,
        fixtures.groundedWriting.requirements,
        fixtures.groundedWriting.matchAnalysis
      ),
      schema: groundedWritingSchema,
      score: (value) => scoreGroundedWriting(groundedWritingSchema.parse(value), fixtures.groundedWriting.expected)
    }
  ];
}

async function executeTask(
  provider: LlmProvider,
  model: OllamaModel,
  task: BenchmarkTaskName,
  runNumber: number,
  messages: LlmMessage[],
  schema: z.ZodTypeAny,
  scorer: (value: unknown) => BenchmarkScore
): Promise<BenchmarkRunMetrics> {
  const started = performance.now();
  try {
    const details = await generateJsonWithSchemaDetailed(provider, messages, schema, task, {
      temperature: BENCHMARK_GENERATION_SETTINGS.temperature,
      seed: BENCHMARK_GENERATION_SETTINGS.seed,
      maxTokens: BENCHMARK_GENERATION_SETTINGS.maxTokens
    });
    const score = scorer(details.value);
    return buildRunMetrics(
      model,
      task,
      runNumber,
      true,
      true,
      details.repairAttempts,
      details.generations,
      performance.now() - started,
      score,
      []
    );
  } catch (error) {
    const generations = error instanceof JsonGenerationError ? error.generations : [];
    const repairs = error instanceof JsonGenerationError ? error.repairAttempts : 0;
    return buildRunMetrics(
      model,
      task,
      runNumber,
      false,
      false,
      repairs,
      generations,
      performance.now() - started,
      emptyScore(),
      [sanitizeBenchmarkError(error)]
    );
  }
}

function buildRunMetrics(
  model: OllamaModel,
  task: BenchmarkTaskName,
  runNumber: number,
  success: boolean,
  schemaValid: boolean,
  repairAttempts: number,
  generations: LlmGenerationResult[],
  wallDurationMs: number,
  score: BenchmarkScore,
  errors: string[]
): BenchmarkRunMetrics {
  const totalDuration = sumOptional(generations.map((generation) => generation.timing?.totalDurationMs));
  const loadDuration = sumOptional(generations.map((generation) => generation.timing?.loadDurationMs));
  const promptDuration = sumOptional(generations.map((generation) => generation.timing?.promptEvaluationDurationMs));
  const generationDuration = sumOptional(generations.map((generation) => generation.timing?.generationDurationMs));
  const promptTokens = sumOptional(generations.map((generation) => generation.usage?.promptTokens));
  const outputTokens = sumOptional(generations.map((generation) => generation.usage?.outputTokens));
  const tokensPerSecond = outputTokens !== undefined && generationDuration !== undefined && generationDuration > 0
    ? outputTokens / (generationDuration / 1000)
    : undefined;

  return {
    model: model.name,
    modelDigest: model.digest,
    task,
    runNumber,
    success,
    schemaValid,
    repairAttempts,
    totalDurationMs: totalDuration ?? wallDurationMs,
    ...(loadDuration !== undefined ? { loadDurationMs: loadDuration } : {}),
    ...(promptDuration !== undefined ? { promptEvaluationDurationMs: promptDuration } : {}),
    ...(generationDuration !== undefined ? { generationDurationMs: generationDuration } : {}),
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
    completenessScore: score.completenessScore,
    groundingScore: score.groundingScore,
    taskScore: score.taskScore,
    semanticFacts: score.semanticFacts,
    catastrophicFabrication: score.catastrophicFabrication,
    scoreReasons: score.reasons,
    errors,
    ...(generations.length > 0 ? { rawResponses: generations.map((generation) => generation.text) } : {})
  };
}

function failedModelResult(model: OllamaModel, reason: string): ModelBenchmarkResult {
  const result = aggregateModelRuns(model.name, model.digest, []);
  return {
    ...result,
    eligibleForRecommendation: false,
    disqualificationReasons: [reason, ...result.disqualificationReasons]
  };
}

function emptyScore(): BenchmarkScore {
  return {
    completenessScore: 0,
    groundingScore: 0,
    taskScore: 0,
    semanticFacts: [],
    catastrophicFabrication: false,
    reasons: []
  };
}

function buildCacheIdentity(model: OllamaModel, runsPerTask: number): BenchmarkCacheIdentity {
  return {
    model: model.name,
    modelDigest: model.digest,
    benchmarkVersion: BENCHMARK_VERSION,
    fixtureVersion: FIXTURE_VERSION,
    promptVersion: BENCHMARK_PROMPT_VERSION,
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    runsPerTask
  };
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : undefined;
}

function sanitizeBenchmarkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
