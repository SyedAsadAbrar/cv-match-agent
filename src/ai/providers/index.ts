import { OllamaProvider } from "./ollamaProvider";
import { OpenAIProvider } from "./openaiProvider";
import type { LlmProvider, ProviderName } from "./types";

export type CreateProviderOptions = {
  provider?: string;
  model?: string;
};

export function createProvider(options: CreateProviderOptions = {}): LlmProvider {
  const selected = normalizeProviderName(options.provider);

  if (selected === "ollama") {
    return new OllamaProvider({ model: options.model });
  }

  if (selected === "openai") {
    if (options.model !== undefined) {
      throw new Error("The --model option selects an Ollama model and cannot be used with --provider openai.");
    }
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
