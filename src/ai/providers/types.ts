export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmGenerationOptions = {
  json?: boolean;
  temperature?: number;
  seed?: number;
  maxTokens?: number;
};

export type LlmGenerationResult = {
  text: string;
  provider: string;
  model: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  timing?: {
    totalDurationMs?: number;
    loadDurationMs?: number;
    promptEvaluationDurationMs?: number;
    generationDurationMs?: number;
  };
};

export type LlmProvider = {
  name: string;
  model: string;
  generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult>;
  generateText(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<string>;
};

export type ProviderName = "ollama" | "openai";
