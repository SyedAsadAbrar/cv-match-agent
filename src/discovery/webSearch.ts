import type {
  WebSearchOptions,
  WebSearchProvider,
  WebSearchResult,
} from "./types";

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
  if (!provider || provider === "none") return undefined;
  throw new Error(
    `Unsupported WEB_SEARCH_PROVIDER "${provider}". Version 1 supports only "none".`,
  );
}
