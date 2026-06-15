import { z } from "zod";
import type { LlmMessage, LlmProvider } from "./providers/types";

const WRAPPER_KEYS = [
  "data",
  "result",
  "cvProfile",
  "profile",
  "candidateProfile",
  "parsedCv",
  "parsedCV",
  "resume",
  "jobRequirements",
  "matchAnalysis",
  "analysis",
  "applicationAssets",
  "assets"
];

export function parseJsonWithSchema<TSchema extends z.ZodTypeAny>(
  text: string,
  schema: TSchema,
  label: string
): z.infer<TSchema> {
  const candidates = getJsonCandidates(text);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const valuesToValidate = getValidationCandidates(parsed);

      for (const value of valuesToValidate) {
        const result = schema.safeParse(value);

        if (result.success) {
          return result.data;
        }

        errors.push(result.error.message);
      }
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

export async function generateJsonWithSchema<TSchema extends z.ZodTypeAny>(
  provider: LlmProvider,
  messages: LlmMessage[],
  schema: TSchema,
  label: string
): Promise<z.infer<TSchema>> {
  const response = await provider.generateText(messages);

  try {
    return parseJsonWithSchema(response, schema, label);
  } catch (error) {
    const repairedResponse = await provider.generateText([
      ...messages,
      {
        role: "assistant",
        content: response
      },
      {
        role: "user",
        content: `The previous response was invalid for ${label}.

Return only one valid JSON object that matches the schema requested above.
Do not return a quoted JSON string.
Do not return markdown.
Do not explain the correction.

Validation error:
${error instanceof Error ? error.message : String(error)}`
      }
    ]);

    try {
      return parseJsonWithSchema(repairedResponse, schema, label);
    } catch (repairError) {
      throw new Error(
        `${repairError instanceof Error ? repairError.message : String(repairError)}\n` +
          `The first invalid ${label} response could not be repaired automatically.`
      );
    }
  }
}

function getJsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates = new Set<string>([trimmed]);

  const fencedBlocks = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedBlocks) {
    if (match[1]) {
      candidates.add(match[1].trim());
    }
  }

  const objectCandidate = extractBalancedJson(trimmed, "{", "}");
  if (objectCandidate) {
    candidates.add(objectCandidate);
  }

  const arrayCandidate = extractBalancedJson(trimmed, "[", "]");
  if (arrayCandidate) {
    candidates.add(arrayCandidate);
  }

  return [...candidates].filter(Boolean);
}

function getValidationCandidates(parsed: unknown, depth = 0): unknown[] {
  const candidates: unknown[] = [parsed];

  if (depth >= 2) {
    return candidates;
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      candidates.push(...getValidationCandidates(item, depth + 1));
    }
  }

  if (isRecord(parsed)) {
    for (const key of WRAPPER_KEYS) {
      if (key in parsed) {
        candidates.push(...getValidationCandidates(parsed[key], depth + 1));
      }
    }

    const entries = Object.entries(parsed);
    if (entries.length === 1) {
      candidates.push(...getValidationCandidates(entries[0][1], depth + 1));
    }
  }

  if (typeof parsed === "string") {
    for (const candidate of getJsonCandidates(parsed)) {
      try {
        candidates.push(...getValidationCandidates(JSON.parse(candidate) as unknown, depth + 1));
      } catch {
        // Keep the original string validation error; not every string is nested JSON.
      }
    }
  }

  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractBalancedJson(text: string, open: "{" | "[", close: "}" | "]"): string | undefined {
  const start = text.indexOf(open);
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

    if (char === open) {
      depth += 1;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
}
