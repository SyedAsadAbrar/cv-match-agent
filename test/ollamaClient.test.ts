import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  inspectModelCompatibility,
  OllamaClient
} from "../src/ai/ollamaClient";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("maps the Ollama /api/tags response into application model fields", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        models: [
          {
            name: "deepseek-r1:8b",
            model: "deepseek-r1:8b",
            modified_at: "2026-07-14T10:00:00Z",
            size: 5_234_567_890,
            digest: "abc123",
            details: {
              parent_model: "",
              format: "gguf",
              family: "qwen2",
              families: ["qwen2"],
              parameter_size: "8.2B",
              quantization_level: "Q4_K_M"
            }
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  const models = await new OllamaClient({ baseUrl: "http://ollama.test" }).listModels();

  assert.deepEqual(models, [
    {
      name: "deepseek-r1:8b",
      model: "deepseek-r1:8b",
      modifiedAt: "2026-07-14T10:00:00Z",
      size: 5_234_567_890,
      digest: "abc123",
      details: {
        format: "gguf",
        family: "qwen2",
        families: ["qwen2"],
        parameterSize: "8.2B",
        quantizationLevel: "Q4_K_M"
      }
    }
  ]);
});

test("returns an empty list when Ollama has no installed models", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), { status: 200 });

  const models = await new OllamaClient({ baseUrl: "http://ollama.test" }).listModels();

  assert.deepEqual(models, []);
});

test("reports a non-success response from Ollama", async () => {
  globalThis.fetch = async () => new Response("service unavailable", { status: 503 });

  await assert.rejects(
    new OllamaClient({ baseUrl: "http://ollama.test" }).listModels(),
    /HTTP 503: service unavailable/
  );
});

test("reports a connection failure from Ollama", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };

  await assert.rejects(
    new OllamaClient({ baseUrl: "http://ollama.test" }).listModels(),
    /Could not reach Ollama at http:\/\/ollama\.test\. Ollama may not be running\. fetch failed/
  );
});

test("maps /api/show response fields and capabilities", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    modified_at: "2026-07-14T10:00:00Z",
    capabilities: ["completion", "tools"],
    details: {
      family: "qwen3",
      parameter_size: "14.8B",
      quantization_level: "Q4_K_M"
    }
  }), { status: 200 });

  const info = await new OllamaClient({ baseUrl: "http://ollama.test" }).showModel("qwen3:14b");
  assert.deepEqual(info, {
    model: "qwen3:14b",
    modifiedAt: "2026-07-14T10:00:00Z",
    capabilities: ["completion", "tools"],
    details: { family: "qwen3", parameterSize: "14.8B", quantizationLevel: "Q4_K_M" }
  });
});

test("capability filtering accepts completion models", () => {
  assert.deepEqual(inspectModelCompatibility({ model: "chat", capabilities: ["completion"] }), {
    compatible: true,
    inspection: "capabilities"
  });
});

test("capability filtering excludes embedding-only models", () => {
  const result = inspectModelCompatibility({ model: "embed", capabilities: ["embedding"] });
  assert.equal(result.compatible, false);
  assert.match(result.reason ?? "", /embedding/);
});

test("missing capabilities use a clearly reported generation probe fallback", () => {
  const result = inspectModelCompatibility({ model: "older-ollama-model" });
  assert.equal(result.compatible, true);
  assert.equal(result.inspection, "probe-required");
  assert.match(result.reason ?? "", /compatibility probe/);
});

test("model inspection failures are actionable", async () => {
  globalThis.fetch = async () => new Response("model unavailable", { status: 500 });
  await assert.rejects(
    new OllamaClient({ baseUrl: "http://ollama.test" }).showModel("broken"),
    /inspection failed for "broken" with HTTP 500: model unavailable/
  );
});
