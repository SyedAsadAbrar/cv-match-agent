import type { LlmMessage, LlmProvider } from "./types";

export type OllamaProviderOptions = {
  model?: string;
  baseUrl?: string;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  error?: string;
};

export class OllamaProvider implements LlmProvider {
  public readonly name = "ollama";
  private readonly baseUrl: string;
  public readonly model: string;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = resolveOllamaBaseUrl(options.baseUrl);
    this.model = resolveOllamaModel(options.model);
  }

  async generateText(messages: LlmMessage[], options?: { json?: boolean }): Promise<string> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          format: options?.json ? "json" : undefined,
          stream: false
        })
      });
    } catch (error) {
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Start Ollama or choose another provider. ${formatError(error)}`
      );
    }

    if (!response.ok) {
      const body = await response.text();
      if (isMissingModelError(body, this.model)) {
        throw new Error(missingModelMessage(this.model));
      }
      throw new Error(`Ollama request failed with HTTP ${response.status}: ${body}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    if (data.error) {
      if (isMissingModelError(data.error, this.model)) {
        throw new Error(missingModelMessage(this.model));
      }
      throw new Error(`Ollama error: ${data.error}`);
    }

    const text = data.message?.content?.trim();
    if (!text) {
      throw new Error("Ollama returned an empty response.");
    }

    return text;
  }
}

export function resolveOllamaModel(explicitModel?: string, environmentModel = process.env.OLLAMA_MODEL): string {
  const model = explicitModel ?? environmentModel ?? "llama3.1:8b";
  if (!model.trim()) {
    throw new Error("An Ollama model must not be empty.");
  }

  return model;
}

function resolveOllamaBaseUrl(explicitBaseUrl?: string): string {
  const baseUrl = explicitBaseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  return baseUrl.replace(/\/+$/, "");
}

function isMissingModelError(message: string, model: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes(model.toLowerCase()) && /(not found|does not exist|not installed)/.test(normalized);
}

function missingModelMessage(model: string): string {
  return `Ollama model "${model}" is not installed. Install it with: ollama pull ${model}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
