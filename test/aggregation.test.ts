import assert from "node:assert/strict";
import test from "node:test";
import type { BenchmarkRunMetrics, BenchmarkTaskName, ModelBenchmarkResult } from "../src/benchmark/types";
import {
  aggregateModelRuns,
  calculateConsistencyScore,
  calculateRecommendations
} from "../src/benchmark/scoring/aggregateScores";

function run(task: BenchmarkTaskName, overrides: Partial<BenchmarkRunMetrics> = {}): BenchmarkRunMetrics {
  return {
    model: "model",
    modelDigest: "digest",
    task,
    runNumber: 1,
    success: true,
    schemaValid: true,
    repairAttempts: 0,
    totalDurationMs: 1000,
    completenessScore: 90,
    groundingScore: 90,
    taskScore: 90,
    semanticFacts: ["a", "b"],
    catastrophicFabrication: false,
    scoreReasons: [],
    errors: [],
    ...overrides
  };
}

function completeRuns(overrides: Partial<BenchmarkRunMetrics> = {}): BenchmarkRunMetrics[] {
  return [run("job-extraction", overrides), run("profile-matching", overrides), run("grounded-writing", overrides)];
}

function result(model: string, quality: number, duration: number, eligible = true): ModelBenchmarkResult {
  return {
    model,
    modelDigest: `${model}-digest`,
    benchmarkVersion: "1",
    runs: [],
    successRate: 1,
    schemaSuccessRate: 1,
    averageRepairAttempts: 0,
    averageDurationMs: duration,
    completenessScore: quality,
    groundingScore: quality,
    consistencyScore: 100,
    qualityScore: quality,
    eligibleForRecommendation: eligible,
    disqualificationReasons: eligible ? [] : ["failed gate"]
  };
}

test("multiple benchmark runs are aggregated", () => {
  const runs = completeRuns().flatMap((item) => [item, { ...item, runNumber: 2, totalDurationMs: 3000 }]);
  const aggregate = aggregateModelRuns("model", "digest", runs);
  assert.equal(aggregate.averageDurationMs, 2000);
  assert.equal(aggregate.successRate, 1);
  assert.equal(aggregate.schemaSuccessRate, 1);
});

test("consistency compares semantic facts rather than exact wording", () => {
  const runs = completeRuns().flatMap((item) => [
    item,
    { ...item, runNumber: 2, semanticFacts: ["a", "b"] }
  ]);
  assert.equal(calculateConsistencyScore(runs), 100);
});

test("failed runs retain errors and lower reliability", () => {
  const failed = run("job-extraction", { success: false, schemaValid: false, errors: ["invalid final schema"] });
  const aggregate = aggregateModelRuns("model", "digest", [failed, ...completeRuns().slice(1)]);
  assert.equal(aggregate.runs[0].errors[0], "invalid final schema");
  assert.ok(aggregate.successRate < 1);
  assert.ok(aggregate.schemaSuccessRate < 1);
});

test("quality score excludes speed", () => {
  const slow = aggregateModelRuns("slow", "one", completeRuns({ totalDurationMs: 100_000 }));
  const fast = aggregateModelRuns("fast", "two", completeRuns({ totalDurationMs: 100 }));
  assert.equal(slow.qualityScore, fast.qualityScore);
});

test("fast recommendation respects eligibility and quality gates", () => {
  const recommendations = calculateRecommendations([
    result("unsafe-fast", 50, 100, false),
    result("safe", 85, 1000, true)
  ]);
  assert.equal(recommendations.fast, "safe");
});

test("quality recommendation chooses highest eligible quality", () => {
  const recommendations = calculateRecommendations([result("good", 85, 500), result("best", 95, 1000)]);
  assert.equal(recommendations.quality, "best");
});

test("balanced recommendation combines normalized quality and relative speed", () => {
  const recommendations = calculateRecommendations([result("slow-quality", 90, 100_000), result("fast-good", 80, 10_000)]);
  assert.equal(recommendations.balanced, "fast-good");
});

test("recommendation tie-breaking is deterministic", () => {
  const recommendations = calculateRecommendations([result("beta", 90, 1000), result("alpha", 90, 1000)]);
  assert.deepEqual(recommendations, { fast: "alpha", balanced: "alpha", quality: "alpha" });
});

test("no recommendation is returned when every model is ineligible", () => {
  assert.deepEqual(calculateRecommendations([result("one", 95, 100, false)]), {});
});
