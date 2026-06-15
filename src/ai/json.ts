import { z } from "zod";

export function parseJsonWithSchema<T>(text: string, schema: z.ZodType<T>, label: string): T {
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

function getValidationCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return [parsed, ...parsed];
  }

  return [parsed];
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
