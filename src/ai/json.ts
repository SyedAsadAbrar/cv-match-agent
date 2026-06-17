import { z } from "zod";
import type { LlmMessage, LlmProvider } from "./providers/types";

export type AiDebugArtifact = {
  label: string;
  messages: LlmMessage[];
  response: string;
  error?: string;
};

let debugRecorder: ((artifact: AiDebugArtifact) => void) | undefined;

export function setAiDebugRecorder(recorder: ((artifact: AiDebugArtifact) => void) | undefined): void {
  debugRecorder = recorder;
}

export async function generateJsonWithSchema<TSchema extends z.ZodTypeAny>(
  provider: LlmProvider,
  messages: LlmMessage[],
  schema: TSchema,
  label: string
): Promise<z.infer<TSchema>> {
  const response = await provider.generateText(messages, { json: true });

  try {
    const parsed = parseJsonWithSchema(response, schema, label);
    debugRecorder?.({ label, messages, response });
    return parsed;
  } catch (error) {
    const repairMessages = buildJsonRepairMessages(label, response, formatError(error));
    const repairedResponse = await provider.generateText(repairMessages, { json: true });

    try {
      const repaired = parseJsonWithSchema(repairedResponse, schema, label);
      debugRecorder?.({ label, messages, response, error: formatError(error) });
      debugRecorder?.({ label: `${label} repair`, messages: repairMessages, response: repairedResponse });
      return repaired;
    } catch (repairError) {
      debugRecorder?.({ label, messages, response, error: formatError(error) });
      debugRecorder?.({
        label: `${label} repair`,
        messages: repairMessages,
        response: repairedResponse,
        error: formatError(repairError)
      });

      throw repairError;
    }
  }
}

function buildJsonRepairMessages(label: string, response: string, error: string): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You repair invalid JSON model output.",
        "Return only one valid JSON object.",
        "Do not add markdown, commentary, or wrapper keys.",
        "Preserve the original meaning and fields as much as possible."
      ].join(" ")
    },
    {
      role: "user",
      content: `Repair this ${label} response so it validates as the expected JSON object.

Validation error:
${error}

Invalid response:
${response}`
    }
  ];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
