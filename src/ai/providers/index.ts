import { OllamaProvider } from "./ollamaProvider";
import { OpenAIProvider } from "./openaiProvider";
import type { LlmProvider, ProviderName } from "./types";

export function createProvider(providerName?: string): LlmProvider {
  const selected = (providerName ?? process.env.DEFAULT_PROVIDER ?? "ollama").toLowerCase();

  if (selected === "ollama") {
    return new OllamaProvider();
  }

  if (selected === "openai") {
    return new OpenAIProvider();
  }

  throw new Error(`Unsupported provider "${selected}". Use "ollama" or "openai".`);
}

export function normalizeProviderName(providerName?: string): ProviderName {
  const selected = (providerName ?? process.env.DEFAULT_PROVIDER ?? "ollama").toLowerCase();
  if (selected !== "ollama" && selected !== "openai") {
    throw new Error(`Unsupported provider "${selected}". Use "ollama" or "openai".`);
  }

  return selected;
}
