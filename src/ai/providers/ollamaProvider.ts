import type {
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider
} from "./types";

export type OllamaProviderOptions = {
  model?: string;
  baseUrl?: string;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  error?: string;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
};

export class OllamaProvider implements LlmProvider {
  public readonly name = "ollama";
  private readonly baseUrl: string;
  public readonly model: string;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = resolveOllamaBaseUrl(options.baseUrl);
    this.model = resolveOllamaModel(options.model);
  }

  async generate(messages: LlmMessage[], options: LlmGenerationOptions = {}): Promise<LlmGenerationResult> {
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
          format: options.json ? "json" : undefined,
          options: {
            temperature: options.temperature,
            seed: options.seed,
            num_predict: options.maxTokens
          },
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

    const promptTokens = readNonNegativeNumber(data.prompt_eval_count);
    const outputTokens = readNonNegativeNumber(data.eval_count);

    return {
      text,
      provider: this.name,
      model: this.model,
      finishReason: readString(data.done_reason),
      usage: buildUsage(promptTokens, outputTokens),
      timing: buildTiming(data),
    };
  }

  async generateText(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<string> {
    return (await this.generate(messages, options)).text;
  }
}

export function mapOllamaDurationToMilliseconds(durationNanoseconds: number | undefined): number | undefined {
  return durationNanoseconds === undefined || !Number.isFinite(durationNanoseconds) || durationNanoseconds < 0
    ? undefined
    : durationNanoseconds / 1_000_000;
}

function buildUsage(promptTokens?: number, outputTokens?: number): LlmGenerationResult["usage"] {
  if (promptTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  return {
    promptTokens,
    outputTokens,
    totalTokens: promptTokens !== undefined && outputTokens !== undefined ? promptTokens + outputTokens : undefined
  };
}

function buildTiming(data: OllamaChatResponse): LlmGenerationResult["timing"] {
  const timing = {
    totalDurationMs: mapOllamaDurationToMilliseconds(readNonNegativeNumber(data.total_duration)),
    loadDurationMs: mapOllamaDurationToMilliseconds(readNonNegativeNumber(data.load_duration)),
    promptEvaluationDurationMs: mapOllamaDurationToMilliseconds(readNonNegativeNumber(data.prompt_eval_duration)),
    generationDurationMs: mapOllamaDurationToMilliseconds(readNonNegativeNumber(data.eval_duration))
  };

  return Object.values(timing).some((value) => value !== undefined) ? timing : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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
