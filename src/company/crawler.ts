import { z } from "zod";
import { htmlToSafeText } from "../security/content";
import { safeFetch, type SafeFetchOptions } from "../security/safeFetch";
import { extractHtmlLinks } from "./detection";

const jsonLdJobSchema = z
  .object({
    "@type": z.union([z.literal("JobPosting"), z.array(z.string())]),
    title: z.string().min(1),
    description: z.string().optional(),
    datePosted: z.string().optional(),
    url: z.string().url().optional(),
    hiringOrganization: z
      .object({ name: z.string().optional() })
      .passthrough()
      .optional(),
    jobLocation: z.unknown().optional(),
  })
  .passthrough();

export type CrawledJob = {
  title: string;
  description: string;
  url: string;
  publishedAt?: string;
  locationText?: string;
};

export type CareersCrawlerOptions = SafeFetchOptions & {
  maxDepth?: number;
  maxPages?: number;
  delayMs?: number;
};

export async function crawlOfficialCareersSite(
  careersUrl: string,
  options: CareersCrawlerOptions = {},
): Promise<{
  jobs: CrawledJob[];
  pagesVisited: number;
  discoveredUrls: string[];
}> {
  const origin = new URL(careersUrl);
  const maximumDepth =
    options.maxDepth ??
    readPositiveInteger(process.env.CAREERS_CRAWLER_MAX_DEPTH, 2);
  const maximumPages =
    options.maxPages ??
    readPositiveInteger(process.env.CAREERS_CRAWLER_MAX_PAGES_PER_COMPANY, 100);
  const robots = await loadRobotsPolicy(origin, options);
  const queue = [
    { url: origin.toString(), depth: 0 },
    ...robots.sitemaps.map((url) => ({ url, depth: 0 })),
  ];
  const visited = new Set<string>();
  const jobs = new Map<string, CrawledJob>();
  const discoveredUrls = new Set<string>();

  while (queue.length > 0 && visited.size < maximumPages) {
    const current = queue.shift()!;
    const canonical = canonicalUrl(current.url);
    if (
      visited.has(canonical) ||
      !isAllowedCareerUrl(origin, canonical) ||
      isDisallowedByRobots(canonical, robots.disallowedPaths)
    )
      continue;
    visited.add(canonical);
    const delayMs =
      options.delayMs ??
      readNonNegativeInteger(process.env.CAREERS_CRAWLER_DELAY_MS, 0);
    if (delayMs > 0 && visited.size > 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    const response = await safeFetch(canonical, {
      ...options,
      timeoutMs:
        options.timeoutMs ??
        readPositiveInteger(process.env.CAREERS_CRAWLER_TIMEOUT_MS, 15_000),
      maxBytes:
        options.maxBytes ??
        readPositiveInteger(
          process.env.CAREERS_CRAWLER_MAX_RESPONSE_BYTES,
          5_000_000,
        ),
      maxRedirects: options.maxRedirects ?? 3,
      retries: options.retries ?? 1,
      allowedContentTypes: [
        "text/html",
        "application/xhtml+xml",
        "application/xml",
        "text/xml",
      ],
    });
    if (!response.ok) {
      if (visited.size === 1)
        throw new Error(
          `HTTP ${response.status} from ${new URL(canonical).hostname}.`,
        );
      continue;
    }
    const body = await response.text();
    const structuredJobs = extractJsonLdJobs(canonical, body);
    for (const job of structuredJobs) jobs.set(job.url, job);
    if (structuredJobs.length === 0 && looksLikeJobUrl(canonical)) {
      const title = extractPageTitle(body);
      const description = htmlToSafeText(body);
      if (title && description.length >= 40)
        jobs.set(canonical, { title, description, url: canonical });
    }
    const sitemapUrls = /(?:sitemap|\.xml)(?:$|[?#])/i.test(canonical)
      ? extractSitemapUrls(body)
      : [];
    const links = [...extractHtmlLinks(canonical, body), ...sitemapUrls];
    for (const link of links) {
      const next = canonicalUrl(link);
      if (!isAllowedCareerUrl(origin, next)) continue;
      if (looksLikeJobUrl(next)) discoveredUrls.add(next);
      if (current.depth < maximumDepth && shouldCrawl(next))
        queue.push({ url: next, depth: current.depth + 1 });
    }
    if (visited.size === 1 && robots.sitemaps.length === 0)
      queue.push({
        url: new URL("/sitemap.xml", origin).toString(),
        depth: 0,
      });
  }
  return {
    jobs: [...jobs.values()],
    pagesVisited: visited.size,
    discoveredUrls: [...discoveredUrls],
  };
}

async function loadRobotsPolicy(
  origin: URL,
  options: CareersCrawlerOptions,
): Promise<{ sitemaps: string[]; disallowedPaths: string[] }> {
  try {
    const response = await safeFetch(
      new URL("/robots.txt", origin).toString(),
      {
        ...options,
        timeoutMs:
          options.timeoutMs ??
          readPositiveInteger(process.env.CAREERS_CRAWLER_TIMEOUT_MS, 15_000),
        maxBytes: Math.min(options.maxBytes ?? 1_000_000, 1_000_000),
        maxRedirects: options.maxRedirects ?? 3,
        retries: 0,
        allowedContentTypes: ["text/plain"],
      },
    );
    if (!response.ok) return { sitemaps: [], disallowedPaths: [] };
    return parseRobotsPolicy(await response.text());
  } catch {
    return { sitemaps: [], disallowedPaths: [] };
  }
}

export function parseRobotsPolicy(input: string): {
  sitemaps: string[];
  disallowedPaths: string[];
} {
  const sitemaps: string[] = [];
  const disallowedPaths: string[] = [];
  let applies = false;
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") applies = value === "*";
    else if (field === "sitemap" && /^https?:\/\//i.test(value))
      sitemaps.push(value);
    else if (
      field === "disallow" &&
      applies &&
      value.startsWith("/") &&
      value !== "/"
    )
      disallowedPaths.push(value);
    else if (field === "disallow" && applies && value === "/")
      disallowedPaths.push(value);
  }
  return { sitemaps: [...new Set(sitemaps)], disallowedPaths };
}

function isDisallowedByRobots(input: string, paths: string[]): boolean {
  const pathname = new URL(input).pathname;
  return paths.some((path) => path === "/" || pathname.startsWith(path));
}

export function extractJsonLdJobs(pageUrl: string, html: string): CrawledJob[] {
  const results: CrawledJob[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const entries = flattenJsonLd(parsed);
      for (const entry of entries) {
        const job = jsonLdJobSchema.safeParse(entry);
        if (!job.success) continue;
        const type = job.data["@type"];
        if (Array.isArray(type) && !type.includes("JobPosting")) continue;
        results.push({
          title: job.data.title,
          description: htmlToSafeText(job.data.description ?? job.data.title),
          url: job.data.url
            ? new URL(job.data.url, pageUrl).toString()
            : pageUrl,
          publishedAt: job.data.datePosted,
          locationText: extractLocation(job.data.jobLocation),
        });
      }
    } catch {
      // Ignore malformed JSON-LD without failing the whole source.
    }
  }
  return results;
}

export function extractSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter((value) => /^https?:\/\//i.test(value));
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [value, ...(record["@graph"] ? flattenJsonLd(record["@graph"]) : [])];
}

function extractLocation(value: unknown): string | undefined {
  const text = JSON.stringify(value ?? "");
  const matches = [
    ...text.matchAll(/"(?:addressLocality|addressCountry)":"([^"]+)"/g),
  ].map((match) => match[1]);
  return matches.length ? matches.join(", ") : undefined;
}

function canonicalUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(?:utm_[^=]+|gclid|fbclid|mc_[^=]+)$/i.test(key))
      url.searchParams.delete(key);
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function isAllowedCareerUrl(origin: URL, input: string): boolean {
  const url = new URL(input);
  return (
    ["http:", "https:"].includes(url.protocol) &&
    (url.hostname === origin.hostname ||
      url.hostname.endsWith(`.${origin.hostname}`))
  );
}

function shouldCrawl(input: string): boolean {
  return /(?:career|jobs?|vacanc|position|opening|opportunit|sitemap|\.xml)/i.test(
    new URL(input).pathname,
  );
}

function looksLikeJobUrl(input: string): boolean {
  return /\/(?:jobs?|careers?|positions?|openings?|vacancies?)\//i.test(
    new URL(input).pathname,
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractPageTitle(html: string): string | undefined {
  const value =
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return value ? htmlToSafeText(value).trim() : undefined;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
