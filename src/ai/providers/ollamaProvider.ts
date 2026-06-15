import type { LlmMessage, LlmProvider } from "./types";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  error?: string;
};

export class OllamaProvider implements LlmProvider {
  public readonly name = "ollama";

  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.model = process.env.OLLAMA_MODEL ?? "llama3.1:8b";
  }

  async generateText(messages: LlmMessage[]): Promise<string> {
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
      throw new Error(`Ollama request failed with HTTP ${response.status}: ${body}`);
    }

    const data = (await response.json()) as OllamaChatResponse;

    if (data.error) {
      throw new Error(`Ollama error: ${data.error}`);
    }

    const text = data.message?.content?.trim();
    if (!text) {
      throw new Error("Ollama returned an empty response.");
    }

    return text;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
