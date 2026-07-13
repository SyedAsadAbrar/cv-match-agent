import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BenchmarkCache } from "../src/benchmark/cache";
import type { BenchmarkCacheIdentity, BenchmarkReport, ModelBenchmarkResult } from "../src/benchmark/types";

function identity(overrides: Partial<BenchmarkCacheIdentity> = {}): BenchmarkCacheIdentity {
  return {
    model: "model:1",
    modelDigest: "digest-one",
    benchmarkVersion: "1",
    fixtureVersion: "1",
    promptVersion: "1",
    schemaVersion: "1",
    runsPerTask: 3,
    ...overrides
  };
}

function modelResult(): ModelBenchmarkResult {
  return {
    model: "model:1",
    modelDigest: "digest-one",
    benchmarkVersion: "1",
    runs: [],
    successRate: 1,
    schemaSuccessRate: 1,
    averageRepairAttempts: 0,
    averageDurationMs: 1000,
    completenessScore: 90,
    groundingScore: 90,
    consistencyScore: 100,
    qualityScore: 91,
    eligibleForRecommendation: true,
    disqualificationReasons: []
  };
}

function report(): BenchmarkReport {
  return {
    generatedAt: "2026-07-14T12:00:00.000Z",
    benchmarkVersion: "1",
    fixtureVersion: "1",
    promptVersion: "1",
    schemaVersion: "1",
    runsPerTask: 3,
    generationSettings: { temperature: 0, seed: 42, maxTokens: 1500, jsonMode: true, optionSupport: "requested-unverified" },
    models: [modelResult()],
    recommendations: { fast: "model:1", balanced: "model:1", quality: "model:1" }
  };
}

async function withSavedCache(): Promise<{ cache: BenchmarkCache; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-match-cache-"));
  const cache = new BenchmarkCache({ dataDir: dir });
  await cache.saveReport(report(), [identity()]);
  return { cache, dir };
}

test("valid benchmark cache entries are reused", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal((await cache.get(identity()))?.model, "model:1");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("force bypasses an otherwise valid cache entry", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity(), true), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a model digest change invalidates cache", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity({ modelDigest: "digest-two" })), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a benchmark version change invalidates cache", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity({ benchmarkVersion: "2" })), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a fixture version change invalidates cache", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity({ fixtureVersion: "2" })), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a benchmark prompt version change invalidates cache", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity({ promptVersion: "2" })), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a benchmark schema version change invalidates cache", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity({ schemaVersion: "2" })), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a requested run-count change invalidates cache", async () => {
  const { cache, dir } = await withSavedCache();
  try {
    assert.equal(await cache.get(identity({ runsPerTask: 4 })), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("corrupted benchmark cache is handled safely", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-match-cache-"));
  const cache = new BenchmarkCache({ dataDir: dir });
  try {
    await fs.mkdir(path.dirname(cache.resultsPath), { recursive: true });
    await fs.writeFile(cache.resultsPath, "not json", "utf8");
    assert.equal(await cache.get(identity()), undefined);
    assert.equal((await cache.latest()).corrupted, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
