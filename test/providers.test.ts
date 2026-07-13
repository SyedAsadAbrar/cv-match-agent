import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createProvider } from "../src/ai/providers";
import { mapOllamaDurationToMilliseconds, OllamaProvider, resolveOllamaModel } from "../src/ai/providers/ollamaProvider";
import type { LlmProvider } from "../src/ai/providers/types";
import { getAnalysisProviderMetadata } from "../src/services/runAnalysisWorkflow";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("the CLI model selection takes precedence over OLLAMA_MODEL", () => {
  assert.equal(resolveOllamaModel("deepseek-r1:8b", "llama3.1:8b"), "deepseek-r1:8b");
});

test("OLLAMA_MODEL takes precedence over the default model", () => {
  assert.equal(resolveOllamaModel(undefined, "qwen3:14b"), "qwen3:14b");
});

test("Ollama defaults to llama3.1:8b when no model is configured", () => {
  assert.equal(resolveOllamaModel(undefined, undefined), "llama3.1:8b");
});

test("OpenAI rejects an Ollama --model override", () => {
  assert.throws(
    () => createProvider({ provider: "openai", model: "deepseek-r1:8b" }),
    /cannot be used with --provider openai/
  );
});

test("analysis metadata contains both provider and model", () => {
  const provider: LlmProvider = {
    name: "ollama",
    model: "deepseek-r1:8b",
    async generate() {
      return { text: "", provider: "ollama", model: "deepseek-r1:8b" };
    },
    async generateText() {
      return "";
    }
  };

  assert.deepEqual(getAnalysisProviderMetadata(provider, { type: "explicit" }), {
    provider: "ollama",
    model: "deepseek-r1:8b",
    modelSelection: { type: "explicit" }
  });
});

test("Ollama generation maps timing and token telemetry", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: { content: "ok" },
    done_reason: "stop",
    total_duration: 2_500_000_000,
    load_duration: 500_000_000,
    prompt_eval_count: 20,
    prompt_eval_duration: 400_000_000,
    eval_count: 40,
    eval_duration: 1_600_000_000
  }), { status: 200 });

  const result = await new OllamaProvider({ model: "qwen3:14b", baseUrl: "http://ollama.test" }).generate([]);
  assert.deepEqual(result.usage, { promptTokens: 20, outputTokens: 40, totalTokens: 60 });
  assert.deepEqual(result.timing, {
    totalDurationMs: 2500,
    loadDurationMs: 500,
    promptEvaluationDurationMs: 400,
    generationDurationMs: 1600
  });
  assert.equal(result.finishReason, "stop");
});

test("Ollama nanosecond durations convert to milliseconds", () => {
  assert.equal(mapOllamaDurationToMilliseconds(1_234_000_000), 1234);
});

test("missing optional Ollama telemetry fields stay absent", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: { content: "ok" } }), { status: 200 });
  const result = await new OllamaProvider({ baseUrl: "http://ollama.test" }).generate([]);
  assert.equal(result.usage, undefined);
  assert.equal(result.timing, undefined);
  assert.equal(result.finishReason, undefined);
});
