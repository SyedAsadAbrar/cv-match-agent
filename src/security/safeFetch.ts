import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  retries?: number;
  allowedContentTypes?: string[];
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  lookup?: (hostname: string) => Promise<string[]>;
};

const DEFAULT_USER_AGENT = "cv-match-agent/0.2 (+local personal job discovery)";

export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchWithRedirects(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1)),
        );
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWithRedirects(
  input: string,
  options: SafeFetchOptions,
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let current = input;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const url = await assertSafePublicUrl(current, options.lookup);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/html;q=0.9, text/plain;q=0.8",
          "User-Agent": DEFAULT_USER_AGENT,
          ...options.headers,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Request to ${url.hostname} timed out after ${timeoutMs}ms.`,
        );
      }
      throw new Error(
        `Request to ${url.hostname} failed: ${formatError(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location)
        throw new Error(
          `Redirect from ${url.hostname} did not include a location.`,
        );
      if (redirects === maxRedirects)
        throw new Error(`Request exceeded ${maxRedirects} redirects.`);
      current = new URL(location, url).toString();
      continue;
    }

    validateResponseMetadata(response, options);
    const bytes = await readBoundedBody(
      response,
      options.maxBytes ?? 2_000_000,
    );
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  throw new Error("Unexpected redirect handling failure.");
}

function validateResponseMetadata(
  response: Response,
  options: SafeFetchOptions,
): void {
  const maxBytes = options.maxBytes ?? 2_000_000;
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response exceeded the ${maxBytes}-byte limit.`);
  }

  const allowed = options.allowedContentTypes;
  if (allowed && allowed.length > 0) {
    const contentType = (
      response.headers.get("content-type") ?? ""
    ).toLowerCase();
    if (!allowed.some((type) => contentType.includes(type))) {
      throw new Error(`Unexpected content type "${contentType || "unknown"}".`);
    }
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeded the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function assertSafePublicUrl(
  input: string,
  lookup?: (hostname: string) => Promise<string[]>,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed.");
  }
  if (url.username || url.password)
    throw new Error("URLs containing credentials are not allowed.");
  if (isBlockedHostname(url.hostname))
    throw new Error(
      `Private or local target "${url.hostname}" is not allowed.`,
    );

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : lookup
      ? (await lookup(url.hostname)).map((address) => ({ address }))
      : await dns
          .lookup(url.hostname, { all: true })
          .catch((error: unknown) => {
            throw new Error(
              `Could not resolve ${url.hostname}: ${formatError(error)}`,
            );
          });

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error(
      `Private or unresolved target "${url.hostname}" is not allowed.`,
    );
  }
  return url;
}

export function isBlockedHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/\.$/, "");
  return (
    value === "localhost" ||
    value === "0.0.0.0" ||
    value === "metadata.google.internal" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal") ||
    value === "169.254.169.254"
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  )
    return true;

  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    parts[0] >= 224
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
