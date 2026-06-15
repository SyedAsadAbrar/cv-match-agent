import OpenAI from "openai";
import type { LlmMessage, LlmProvider } from "./types";

export class OpenAIProvider implements LlmProvider {
  public readonly name = "openai";

  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL;

    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is missing. Add it to .env or export it in your shell.");
    }

    if (!model) {
      throw new Error("OPENAI_MODEL is missing. Add a model name to .env or export it in your shell.");
    }

    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateText(messages: LlmMessage[]): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content
      }))
    });

    const text = response.output_text?.trim() ?? "";
    if (!text) {
      throw new Error("OpenAI returned an empty response.");
    }

    return text;
  }
}
