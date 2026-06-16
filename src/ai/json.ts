import { z } from "zod";
import type { LlmMessage, LlmProvider } from "./providers/types";

export async function generateJsonWithSchema<TSchema extends z.ZodTypeAny>(
  provider: LlmProvider,
  messages: LlmMessage[],
  schema: TSchema,
  label: string
): Promise<z.infer<TSchema>> {
  const response = await provider.generateText(messages, { json: true });
  return parseJsonWithSchema(response, schema, label);
}

export function parseJsonWithSchema<TSchema extends z.ZodTypeAny>(
  text: string,
  schema: TSchema,
  label: string
): z.infer<TSchema> {
  const errors: string[] = [];

  for (const candidate of getJsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const result = schema.safeParse(parsed);

      if (result.success) {
        return result.data;
      }

      errors.push(result.error.message);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `Could not parse valid ${label} JSON from the model response. Last validation error: ${
      errors.at(-1) ?? "unknown error"
    }`
  );
}

function getJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates = new Set<string>([trimmed]);

  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fencedJson) {
    candidates.add(fencedJson);
  }

  const objectJson = extractBalancedObject(trimmed);
  if (objectJson) {
    candidates.add(objectJson);
  }

  return [...candidates].filter(Boolean);
}

function extractBalancedObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}
