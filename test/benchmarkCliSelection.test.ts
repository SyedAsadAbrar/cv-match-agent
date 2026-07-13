import assert from "node:assert/strict";
import test from "node:test";
import type { LlmGenerationResult, LlmMessage, LlmProvider } from "../src/ai/providers/types";
import type { OllamaModel } from "../src/ai/ollamaClient";
import {
  collectModelOption,
  parseRunCount,
  runOllamaBenchmark,
  selectCandidates
} from "../src/benchmark/benchmarkRunner";
import { loadRecommendationStatuses, resolveRecommendedModel } from "../src/benchmark/recommendations";
import type { BenchmarkCacheIdentity, BenchmarkReport, ModelBenchmarkResult } from "../src/benchmark/types";
import { resolveModelSelection } from "../src/services/modelSelection";
import { getAnalysisProviderMetadata } from "../src/services/runAnalysisWorkflow";

function installed(name: string, digest = `${name}-digest`): OllamaModel {
  return { name, model: name, modifiedAt: "2026-07-14T00:00:00Z", size: 1000, digest };
}

function benchmarkOutput(messages: LlmMessage[]): string {
  const prompt = messages.map((message) => message.content).join("\n");
  if (prompt.includes("Extract structured job requirements")) {
    return JSON.stringify({
      roleTitle: "Senior Product Engineer",
      company: "Meridian Systems",
      location: "Austin hybrid two days",
      seniority: "Senior, 6+ years",
      requiredSkills: ["TypeScript", "React", "Node.js", "REST APIs", "Jest automated testing"],
      niceToHaveSkills: ["GraphQL", "Kubernetes"],
      educationRequirements: [],
      responsibilities: ["Build accessible features", "Improve performance", "Mentor through code review"],
      domain: "workflow software",
      keywords: []
    });
  }
  if (prompt.includes("Compare the candidate profile")) {
    return JSON.stringify({
      matchScore: 78,
      summary: "Grounded match",
      strongMatches: ["TypeScript React", "Node.js REST", "Jest Playwright testing", "Accessibility", "Mentor code review"],
      partialMatches: ["Docker container knowledge transfers to Kubernetes"],
      gaps: ["No GraphQL evidence", "Austin hybrid location unconfirmed"],
      risks: [],
      suggestedPositioning: "Use workflow evidence",
      keywordSuggestions: ["GraphQL", "Kubernetes"]
    });
  }
  return JSON.stringify({
    recommendations: [
      "Lead with TypeScript and React workflow delivery.",
      "Highlight Node.js REST API work and performance impact.",
      "Emphasize Jest and Playwright testing while naming GraphQL and Kubernetes as gaps."
    ],
    recruiterMessage: "Hello, my Northwind Studio work includes TypeScript and React workflow products, Node.js REST APIs, accessibility improvements, and Jest and Playwright testing. These grounded examples align with Meridian Systems' product engineering responsibilities. I would welcome a brief conversation about the role, including its Austin hybrid arrangement and the areas where I would continue learning."
  });
}

function provider(model: string): LlmProvider {
  return {
    name: "ollama",
    model,
    async generate(messages): Promise<LlmGenerationResult> {
      return {
        text: benchmarkOutput(messages),
        provider: "ollama",
        model,
        usage: { promptTokens: 100, outputTokens: 50, totalTokens: 150 },
        timing: { totalDurationMs: 1000, generationDurationMs: 500 }
      };
    },
    async generateText(messages) {
      return (await this.generate(messages)).text;
    }
  };
}

function eligibleResult(model = "good:1", digest = "good-digest"): ModelBenchmarkResult {
  return {
    model,
    modelDigest: digest,
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

function cachedReport(): BenchmarkReport {
  return {
    generatedAt: "2026-07-14T12:00:00.000Z",
    benchmarkVersion: "1",
    fixtureVersion: "1",
    promptVersion: "1",
    schemaVersion: "1",
    runsPerTask: 3,
    generationSettings: { temperature: 0, seed: 42, maxTokens: 1500, jsonMode: true, optionSupport: "requested-unverified" },
    models: [eligibleResult()],
    recommendations: { fast: "good:1", balanced: "good:1", quality: "good:1" }
  };
}

test("repeated --model options are collected in order", () => {
  assert.deepEqual(collectModelOption("qwen3:14b", collectModelOption("deepseek-r1:8b", [])), [
    "deepseek-r1:8b",
    "qwen3:14b"
  ]);
});

test("invalid benchmark run counts are rejected", () => {
  assert.throws(() => parseRunCount("0"), /integer from 1 to 10/);
  assert.throws(() => parseRunCount("11"), /integer from 1 to 10/);
  assert.throws(() => parseRunCount("2.5"), /integer from 1 to 10/);
});

test("missing requested models are reported", () => {
  assert.throws(() => selectCandidates([installed("one")], ["missing"]), /not installed: missing/);
});

test("a model inspection failure does not stop remaining benchmark candidates", async () => {
  let savedReport: BenchmarkReport | undefined;
  const result = await runOllamaBenchmark(
    { runs: 1 },
    {
      client: {
        async listModels() { return [installed("broken", "broken-digest"), installed("good:1", "good-digest")]; },
        async showModel(model) {
          if (model === "broken") throw new Error("inspection failed");
          return { model, capabilities: ["completion"] };
        }
      },
      cache: {
        async get() { return undefined; },
        async saveReport(report) { savedReport = report; return "memory-report"; }
      },
      providerFactory: provider,
      now: () => new Date("2026-07-14T12:00:00.000Z")
    }
  );
  assert.equal(result.report.models.length, 2);
  assert.match(result.report.models[0].disqualificationReasons[0], /inspection failed/);
  assert.equal(result.report.models[1].runs.length, 3);
  assert.equal(savedReport?.models.length, 2);
});

test("models recommendations reads a valid cached report", async () => {
  const result = await loadRecommendationStatuses({
    client: { async listModels() { return [installed("good:1", "good-digest")]; } },
    cache: { async latest() { return { report: cachedReport(), corrupted: false }; } }
  });
  assert.ok(result.statuses.every((status) => status.valid && status.model === "good:1"));
});

test("stale recommendation digests are reported", async () => {
  const result = await loadRecommendationStatuses({
    client: { async listModels() { return [installed("good:1", "changed-digest")]; } },
    cache: { async latest() { return { report: cachedReport(), corrupted: false }; } }
  });
  assert.ok(result.statuses.every((status) => !status.valid && status.reason?.includes("digest changed")));
});

test("--model and --mode together are rejected", async () => {
  await assert.rejects(
    resolveModelSelection({ provider: "ollama", model: "good:1", mode: "balanced" }),
    /cannot be used together/
  );
});

test("--mode with OpenAI is rejected", async () => {
  await assert.rejects(resolveModelSelection({ provider: "openai", mode: "fast" }), /only with the Ollama provider/);
});

test("explicit model selection remains unchanged", async () => {
  assert.deepEqual(await resolveModelSelection({ provider: "ollama", model: "good:1" }), {
    provider: "ollama",
    model: "good:1",
    metadata: { type: "explicit" }
  });
});

test("automatic mode resolves the cached recommended model", async () => {
  const selected = await resolveModelSelection(
    { provider: "ollama", mode: "quality" },
    async (mode) => ({ model: "good:1", modelDigest: "good-digest", benchmarkVersion: `1-${mode}` })
  );
  assert.equal(selected.model, "good:1");
  assert.deepEqual(selected.metadata, {
    type: "benchmark-recommendation",
    mode: "quality",
    benchmarkVersion: "1-quality",
    modelDigest: "good-digest"
  });
});

test("missing benchmark recommendations produce an actionable error", async () => {
  await assert.rejects(
    resolveRecommendedModel("balanced", {
      client: { async listModels() { return []; } },
      cache: { async latest() { return { corrupted: false }; } }
    }),
    /npm run dev -- models benchmark[\s\S]*--model <model>/
  );
});

test("analysis metadata records recommendation mode, version, and digest", () => {
  const llm = provider("good:1");
  const metadata = {
    type: "benchmark-recommendation" as const,
    mode: "balanced" as const,
    benchmarkVersion: "1",
    modelDigest: "good-digest"
  };
  assert.deepEqual(getAnalysisProviderMetadata(llm, metadata), {
    provider: "ollama",
    model: "good:1",
    modelSelection: metadata
  });
});
