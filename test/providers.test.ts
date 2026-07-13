import assert from "node:assert/strict";
import test from "node:test";
import { createProvider } from "../src/ai/providers";
import { resolveOllamaModel } from "../src/ai/providers/ollamaProvider";
import type { LlmProvider } from "../src/ai/providers/types";
import { getAnalysisProviderMetadata } from "../src/services/runAnalysisWorkflow";

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
    async generateText() {
      return "";
    }
  };

  assert.deepEqual(getAnalysisProviderMetadata(provider), {
    provider: "ollama",
    model: "deepseek-r1:8b"
  });
});
