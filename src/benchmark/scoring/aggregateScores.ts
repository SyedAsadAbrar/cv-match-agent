import {
  BALANCED_SCORE_WEIGHTS,
  BENCHMARK_VERSION,
  ELIGIBILITY_THRESHOLDS,
  QUALITY_SCORE_WEIGHTS
} from "../constants";
import type {
  BenchmarkRecommendations,
  BenchmarkRunMetrics,
  BenchmarkTaskName,
  ModelBenchmarkResult
} from "../types";
import { clampScore } from "./utils";

const REQUIRED_TASKS: BenchmarkTaskName[] = ["job-extraction", "profile-matching", "grounded-writing"];

export function aggregateModelRuns(
  model: string,
  modelDigest: string,
  runs: BenchmarkRunMetrics[],
  inspectionNote?: string
): ModelBenchmarkResult {
  const totalRuns = runs.length;
  const successRate = ratio(runs.filter((run) => run.success).length, totalRuns);
  const schemaSuccessRate = ratio(runs.filter((run) => run.schemaValid).length, totalRuns);
  const averageRepairAttempts = average(runs.map((run) => run.repairAttempts));
  const averageDurationMs = average(runs.map((run) => run.totalDurationMs));
  const throughput = runs.map((run) => run.tokensPerSecond).filter((value): value is number => value !== undefined);
  const averageTokensPerSecond = throughput.length > 0 ? average(throughput) : undefined;
  const completenessScore = average(runs.map((run) => run.completenessScore));
  const groundingScore = average(runs.map((run) => run.groundingScore));
  const consistencyScore = calculateConsistencyScore(runs);
  const qualityScore = clampScore(
    groundingScore * QUALITY_SCORE_WEIGHTS.grounding
      + completenessScore * QUALITY_SCORE_WEIGHTS.completeness
      + schemaSuccessRate * 100 * QUALITY_SCORE_WEIGHTS.schemaReliability
      + consistencyScore * QUALITY_SCORE_WEIGHTS.consistency
  );
  const disqualificationReasons: string[] = [];

  if (successRate < ELIGIBILITY_THRESHOLDS.successRate) {
    disqualificationReasons.push(`Success rate ${(successRate * 100).toFixed(1)}% is below ${(ELIGIBILITY_THRESHOLDS.successRate * 100).toFixed(0)}%.`);
  }
  if (schemaSuccessRate < ELIGIBILITY_THRESHOLDS.schemaSuccessRate) {
    disqualificationReasons.push(`Schema success rate ${(schemaSuccessRate * 100).toFixed(1)}% is below ${(ELIGIBILITY_THRESHOLDS.schemaSuccessRate * 100).toFixed(0)}%.`);
  }
  if (groundingScore < ELIGIBILITY_THRESHOLDS.groundingScore) {
    disqualificationReasons.push(`Grounding score ${groundingScore.toFixed(1)} is below ${ELIGIBILITY_THRESHOLDS.groundingScore}.`);
  }
  if (qualityScore < ELIGIBILITY_THRESHOLDS.qualityScore) {
    disqualificationReasons.push(`Quality score ${qualityScore.toFixed(1)} is below ${ELIGIBILITY_THRESHOLDS.qualityScore}.`);
  }
  if (runs.some((run) => run.catastrophicFabrication)) {
    disqualificationReasons.push("At least one run contained a catastrophic fabricated claim.");
  }
  for (const task of REQUIRED_TASKS) {
    if (!runs.some((run) => run.task === task && run.success)) {
      disqualificationReasons.push(`No successful ${task} run.`);
    }
  }

  return {
    model,
    modelDigest,
    benchmarkVersion: BENCHMARK_VERSION,
    runs,
    successRate,
    schemaSuccessRate,
    averageRepairAttempts,
    averageDurationMs,
    ...(averageTokensPerSecond !== undefined ? { averageTokensPerSecond } : {}),
    completenessScore,
    groundingScore,
    consistencyScore,
    qualityScore,
    eligibleForRecommendation: disqualificationReasons.length === 0,
    disqualificationReasons,
    ...(inspectionNote ? { inspectionNote } : {})
  };
}

export function calculateConsistencyScore(runs: BenchmarkRunMetrics[]): number {
  const taskScores = REQUIRED_TASKS.map((task) => {
    const successful = runs.filter((run) => run.task === task && run.success);
    if (successful.length === 0) return 0;
    if (successful.length === 1) return 100;

    const similarities: number[] = [];
    for (let left = 0; left < successful.length; left += 1) {
      for (let right = left + 1; right < successful.length; right += 1) {
        similarities.push(jaccard(successful[left].semanticFacts, successful[right].semanticFacts) * 100);
      }
    }
    return average(similarities);
  });

  return clampScore(average(taskScores));
}

export function calculateRecommendations(results: ModelBenchmarkResult[]): BenchmarkRecommendations {
  const eligible = results.filter((result) => result.eligibleForRecommendation);
  if (eligible.length === 0) return {};

  const quality = eligible.slice().sort(compareQuality)[0];
  const fast = eligible.slice().sort(compareFast)[0];
  const durations = eligible.map((result) => result.averageDurationMs);
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const balanced = eligible
    .map((result) => ({ result, score: balancedScore(result, minDuration, maxDuration) }))
    .sort((left, right) => right.score - left.score || compareQuality(left.result, right.result))[0].result;

  return { fast: fast.model, balanced: balanced.model, quality: quality.model };
}

export function balancedScore(result: ModelBenchmarkResult, minDuration: number, maxDuration: number): number {
  const normalizedQuality = result.qualityScore / 100;
  const relativeSpeed = maxDuration === minDuration
    ? 1
    : (maxDuration - result.averageDurationMs) / (maxDuration - minDuration);
  return normalizedQuality * BALANCED_SCORE_WEIGHTS.quality + relativeSpeed * BALANCED_SCORE_WEIGHTS.relativeSpeed;
}

function compareQuality(left: ModelBenchmarkResult, right: ModelBenchmarkResult): number {
  return right.qualityScore - left.qualityScore
    || right.groundingScore - left.groundingScore
    || right.schemaSuccessRate - left.schemaSuccessRate
    || right.completenessScore - left.completenessScore
    || left.averageDurationMs - right.averageDurationMs
    || compareModelNames(left.model, right.model);
}

function compareFast(left: ModelBenchmarkResult, right: ModelBenchmarkResult): number {
  return left.averageDurationMs - right.averageDurationMs
    || compareQuality(left, right);
}

function compareModelNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function jaccard(leftValues: string[], rightValues: string[]): number {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / union.size;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
