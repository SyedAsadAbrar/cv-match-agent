export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmProvider = {
  name: string;
  generateText(messages: LlmMessage[], options?: { json?: boolean }): Promise<string>;
};

export type ProviderName = "ollama" | "openai";
