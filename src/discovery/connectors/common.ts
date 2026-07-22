import type { SafeFetchOptions } from "../../security/safeFetch";
import { safeFetch } from "../../security/safeFetch";

export type ConnectorOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  minRequestIntervalMs?: number;
  lookup?: (hostname: string) => Promise<string[]>;
};

export class ConnectorHttpClient {
  private lastRequestAt = 0;
  constructor(private readonly options: ConnectorOptions = {}) {}

  async json(url: string): Promise<unknown> {
    const waitMs =
      (this.options.minRequestIntervalMs ?? 50) -
      (Date.now() - this.lastRequestAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
    const safeOptions: SafeFetchOptions = {
      fetchImpl: this.options.fetchImpl,
      timeoutMs:
        this.options.timeoutMs ??
        readPositiveInteger(process.env.JOB_FETCH_TIMEOUT_MS, 15_000),
      retries: this.options.retries ?? 1,
      maxBytes: 4_000_000,
      allowedContentTypes: ["application/json", "text/json"],
      lookup: this.options.lookup,
    };
    const response = await safeFetch(url, safeOptions);
    if (!response.ok)
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}.`);
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new Error(
        `Invalid JSON from ${new URL(url).hostname}: ${formatError(error)}`,
      );
    }
  }
}

export function assertIdentifier(identifier: string, label: string): string {
  const value = identifier.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(value))
    throw new Error(`${label} contains unsupported characters.`);
  return value;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
