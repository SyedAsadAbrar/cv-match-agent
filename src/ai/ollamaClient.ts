export type OllamaModel = {
  name: string;
  model: string;
  modifiedAt: string;
  size: number;
  digest: string;
  details?: {
    parentModel?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameterSize?: string;
    quantizationLevel?: string;
  };
};

export type OllamaClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
};

export type OllamaModelInfo = {
  model: string;
  modifiedAt?: string;
  details?: OllamaModel["details"];
  capabilities?: string[];
};

export type OllamaModelCompatibility = {
  compatible: boolean;
  inspection: "capabilities" | "probe-required";
  reason?: string;
};

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 10_000;

export class OllamaClient {
  public readonly baseUrl: string;

  private readonly timeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = resolveOllamaBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async listModels(): Promise<OllamaModel[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
    } catch (error) {
      const detail = isAbortError(error)
        ? `Request timed out after ${Math.ceil(this.timeoutMs / 1000)} seconds.`
        : formatError(error);
      throw new Error(
        `Could not reach Ollama at ${this.baseUrl}. Ollama may not be running. ${detail}`
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      const suffix = body.trim() ? `: ${body.trim()}` : "";
      throw new Error(`Ollama model listing failed at ${this.baseUrl} with HTTP ${response.status}${suffix}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Ollama returned an invalid model list from ${this.baseUrl}: ${formatError(error)}`);
    }

    if (!isRecord(payload) || !Array.isArray(payload.models)) {
      throw new Error(`Ollama returned a malformed model list from ${this.baseUrl}.`);
    }

    return payload.models.map(mapOllamaModel).filter((model): model is OllamaModel => model !== undefined);
  }

  async showModel(model: string): Promise<OllamaModelInfo> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
        signal: controller.signal
      });
    } catch (error) {
      const detail = isAbortError(error)
        ? `Request timed out after ${Math.ceil(this.timeoutMs / 1000)} seconds.`
        : formatError(error);
      throw new Error(`Could not inspect Ollama model "${model}" at ${this.baseUrl}. ${detail}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text();
      const suffix = body.trim() ? `: ${body.trim()}` : "";
      throw new Error(`Ollama model inspection failed for "${model}" with HTTP ${response.status}${suffix}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`Ollama returned invalid inspection data for "${model}": ${formatError(error)}`);
    }

    const info = mapOllamaModelInfo(model, payload);
    if (!info) {
      throw new Error(`Ollama returned malformed inspection data for "${model}".`);
    }

    return info;
  }
}

export function resolveOllamaBaseUrl(explicitBaseUrl?: string): string {
  const baseUrl = explicitBaseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

export function mapOllamaModel(value: unknown): OllamaModel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readString(value.name);
  const model = readString(value.model);
  const modifiedAt = readString(value.modified_at);
  const size = readNumber(value.size);
  const digest = readString(value.digest);

  if (!name || !model || !modifiedAt || size === undefined || !digest) {
    return undefined;
  }

  const details = mapOllamaModelDetails(value.details);
  return details ? { name, model, modifiedAt, size, digest, details } : { name, model, modifiedAt, size, digest };
}

export function mapOllamaModelInfo(model: string, value: unknown): OllamaModelInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const modifiedAt = readString(value.modified_at);
  const details = mapOllamaModelDetails(value.details);
  const capabilities = readStringArray(value.capabilities);

  return {
    model,
    ...(modifiedAt ? { modifiedAt } : {}),
    ...(details ? { details } : {}),
    ...(capabilities ? { capabilities } : {})
  };
}

export function inspectModelCompatibility(info: OllamaModelInfo): OllamaModelCompatibility {
  if (!info.capabilities || info.capabilities.length === 0) {
    return {
      compatible: true,
      inspection: "probe-required",
      reason: "Ollama did not report capabilities; the first benchmark generation acts as a compatibility probe."
    };
  }

  const capabilities = new Set(info.capabilities.map((capability) => capability.toLowerCase()));
  if (capabilities.has("completion") || capabilities.has("chat")) {
    return { compatible: true, inspection: "capabilities" };
  }

  return {
    compatible: false,
    inspection: "capabilities",
    reason: capabilities.has("embedding")
      ? "Model exposes embedding capability but no text completion or chat capability."
      : "Model exposes no text completion or chat capability."
  };
}

function mapOllamaModelDetails(value: unknown): OllamaModel["details"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const details: NonNullable<OllamaModel["details"]> = {};
  const parentModel = readString(value.parent_model);
  const format = readString(value.format);
  const family = readString(value.family);
  const families = readStringArray(value.families);
  const parameterSize = readString(value.parameter_size);
  const quantizationLevel = readString(value.quantization_level);

  if (parentModel) details.parentModel = parentModel;
  if (format) details.format = format;
  if (family) details.family = family;
  if (families) details.families = families;
  if (parameterSize) details.parameterSize = parameterSize;
  if (quantizationLevel) details.quantizationLevel = quantizationLevel;

  return Object.keys(details).length > 0 ? details : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values : undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
