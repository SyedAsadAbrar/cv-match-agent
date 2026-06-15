export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmProvider = {
  name: string;
  generateText(messages: LlmMessage[]): Promise<string>;
};

export type ProviderName = "ollama" | "openai";
