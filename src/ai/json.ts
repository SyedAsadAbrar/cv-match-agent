import { z } from "zod";
import type {
  LlmGenerationOptions,
  LlmGenerationResult,
  LlmMessage,
  LlmProvider
} from "./providers/types";

export type AiDebugArtifact = {
  label: string;
  messages: LlmMessage[];
  response: string;
  error?: string;
};

export type JsonGenerationDetails<T> = {
  value: T;
  generations: LlmGenerationResult[];
  repairAttempts: number;
  firstResponseValid: boolean;
};

export class JsonGenerationError extends Error {
  constructor(
    message: string,
    public readonly generations: LlmGenerationResult[],
    public readonly repairAttempts: number
  ) {
    super(message);
    this.name = "JsonGenerationError";
  }
}

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
  let details: JsonGenerationDetails<z.infer<TSchema>>;
  try {
    details = await generateJsonWithSchemaDetailed(provider, messages, schema, label);
  } catch (error) {
    if (error instanceof JsonGenerationError) {
      const [first, repaired] = error.generations;
      if (first) debugRecorder?.({ label, messages, response: first.text, error: error.message });
      if (repaired) {
        debugRecorder?.({
          label: `${label} repair`,
          messages: buildJsonRepairMessages(label, first?.text ?? "", error.message),
          response: repaired.text,
          error: error.message
        });
      }
    }
    throw error;
  }
  const response = details.generations[0].text;

  if (details.repairAttempts === 0) {
    debugRecorder?.({ label, messages, response });
  } else {
    debugRecorder?.({ label, messages, response, error: "Initial response required JSON repair." });
    debugRecorder?.({
      label: `${label} repair`,
      messages: buildJsonRepairMessages(label, response, "Initial response did not validate."),
      response: details.generations[1].text
    });
  }

  return details.value;
}

export async function generateJsonWithSchemaDetailed<TSchema extends z.ZodTypeAny>(
  provider: LlmProvider,
  messages: LlmMessage[],
  schema: TSchema,
  label: string,
  generationOptions: LlmGenerationOptions = {}
): Promise<JsonGenerationDetails<z.infer<TSchema>>> {
  const first = await provider.generate(messages, { ...generationOptions, json: true });

  try {
    return {
      value: parseJsonWithSchema(first.text, schema, label),
      generations: [first],
      repairAttempts: 0,
      firstResponseValid: true
    };
  } catch (error) {
    const repairMessages = buildJsonRepairMessages(label, first.text, formatError(error));
    let repaired: LlmGenerationResult;
    try {
      repaired = await provider.generate(repairMessages, { ...generationOptions, json: true });
    } catch (repairRequestError) {
      throw new JsonGenerationError(formatError(repairRequestError), [first], 1);
    }

    try {
      return {
        value: parseJsonWithSchema(repaired.text, schema, label),
        generations: [first, repaired],
        repairAttempts: 1,
        firstResponseValid: false
      };
    } catch (repairError) {
      throw new JsonGenerationError(formatError(repairError), [first, repaired], 1);
    }
  }
}

export function buildJsonRepairMessages(label: string, response: string, error: string): LlmMessage[] {
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
