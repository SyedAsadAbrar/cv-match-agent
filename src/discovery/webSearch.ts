import { z } from "zod";
import { safeFetch } from "../security/safeFetch";
import type {
  WebSearchOptions,
  WebSearchProvider,
  WebSearchResult,
} from "./types";

const braveResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string(),
            url: z.string().url(),
            description: z.string().optional(),
            age: z.string().optional(),
          }),
        )
        .default([]),
    })
    .optional(),
});

export class BraveWebSearchProvider implements WebSearchProvider {
  readonly name = "brave";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl?: typeof fetch,
  ) {
    if (!apiKey.trim())
      throw new Error("WEB_SEARCH_API_KEY is required for Brave Search.");
  }

  async search(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<WebSearchResult[]> {
    if (
      !query.trim() ||
      query.length > 400 ||
      query.trim().split(/\s+/).length > 50
    ) {
      throw new Error(
        "Search queries must contain 1-50 words and at most 400 characters.",
      );
    }
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(options.limit ?? 10, 20)));
    if (options.recencyDays !== undefined) {
      url.searchParams.set(
        "freshness",
        options.recencyDays <= 1
          ? "pd"
          : options.recencyDays <= 7
            ? "pw"
            : "pm",
      );
    }
    const response = await safeFetch(url.toString(), {
      fetchImpl: this.fetchImpl,
      headers: {
        "X-Subscription-Token": this.apiKey,
        Accept: "application/json",
      },
      allowedContentTypes: ["application/json"],
      maxBytes: 2_000_000,
      retries: 1,
    });
    if (!response.ok)
      throw new Error(`Brave Search returned HTTP ${response.status}.`);
    const payload = braveResponseSchema.parse(
      (await response.json()) as unknown,
    );
    return (payload.web?.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.description,
    }));
  }
}

export class MockWebSearchProvider implements WebSearchProvider {
  readonly name = "mock";
  constructor(
    private readonly results: Record<string, WebSearchResult[]> = {},
  ) {}
  async search(
    query: string,
    options: WebSearchOptions = {},
  ): Promise<WebSearchResult[]> {
    return (this.results[query] ?? []).slice(0, options.limit);
  }
}

export function createConfiguredWebSearchProvider():
  WebSearchProvider | undefined {
  const provider = process.env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  const key = process.env.WEB_SEARCH_API_KEY?.trim();
  if (!provider || !key) return undefined;
  if (provider === "brave") return new BraveWebSearchProvider(key);
  throw new Error(
    `Unsupported WEB_SEARCH_PROVIDER "${provider}". Supported: brave.`,
  );
}
