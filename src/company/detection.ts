import type { TargetCompany } from "../domain/schemas";
import { htmlToSafeText } from "../security/content";

export type DetectedCareerSource = {
  provider: NonNullable<TargetCompany["atsProvider"]>;
  identifier?: string;
  sourceUrl: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  ingestible: boolean;
};

export type HtmlLink = {
  url: string;
  text: string;
};

const ATS_PATTERNS: Array<{
  provider: DetectedCareerSource["provider"];
  matches: (hostname: string) => boolean;
  identifier: (url: URL) => string | undefined;
  ingestible: boolean;
}> = [
  {
    provider: "greenhouse",
    matches: hostMatcher([
      "boards.greenhouse.io",
      "job-boards.greenhouse.io",
      "boards.eu.greenhouse.io",
    ]),
    identifier: firstPathPart,
    ingestible: true,
  },
  {
    provider: "lever",
    matches: hostMatcher(["jobs.lever.co", "jobs.eu.lever.co"]),
    identifier: firstPathPart,
    ingestible: true,
  },
  {
    provider: "ashby",
    matches: hostMatcher(["jobs.ashbyhq.com"]),
    identifier: firstPathPart,
    ingestible: true,
  },
  {
    provider: "workable",
    matches: hostMatcher(["apply.workable.com"]),
    identifier: firstPathPart,
    ingestible: false,
  },
  {
    provider: "smartrecruiters",
    matches: hostMatcher(["jobs.smartrecruiters.com"]),
    identifier: firstPathPart,
    ingestible: false,
  },
  {
    provider: "workday",
    matches: (hostname) =>
      hostname.endsWith(".myworkdayjobs.com") ||
      hostname.endsWith(".myworkdaysite.com"),
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "personio",
    matches: (hostname) =>
      hostname === "personio.com" || hostname.endsWith(".personio.com"),
    identifier: personioIdentifier,
    ingestible: false,
  },
  {
    provider: "recruitee",
    matches: (hostname) =>
      hostname === "recruitee.com" || hostname.endsWith(".recruitee.com"),
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "successfactors",
    matches: (hostname) =>
      hostname.includes("successfactors") || hostname.endsWith(".sapsf.com"),
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "oracle",
    matches: (hostname) =>
      hostname.endsWith(".oraclecloud.com") || hostname.endsWith(".oracle.com"),
    identifier: hostPrefix,
    ingestible: false,
  },
];

export function detectCareerSource(
  input: string,
  options: {
    confidence?: DetectedCareerSource["confidence"];
    evidence?: string[];
  } = {},
): DetectedCareerSource | undefined {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  const match = ATS_PATTERNS.find((pattern) => pattern.matches(hostname));
  if (!match) return undefined;
  const identifier = match.identifier(url);
  return {
    provider: match.provider,
    identifier,
    sourceUrl: url.toString(),
    confidence: options.confidence ?? (identifier ? "medium" : "low"),
    evidence: options.evidence ?? [`Recognised ${match.provider} hostname.`],
    ingestible: match.ingestible,
  };
}

export function detectCareerSourcesFromPage(
  pageUrl: string,
  html: string,
): DetectedCareerSource[] {
  const detections = new Map<string, DetectedCareerSource>();
  const add = (
    url: string,
    confidence: DetectedCareerSource["confidence"],
    evidence: string[],
  ) => {
    const detection = detectCareerSource(url, { confidence, evidence });
    if (!detection) return;
    const key = `${detection.provider}:${detection.identifier ?? detection.sourceUrl}`;
    const existing = detections.get(key);
    if (
      !existing ||
      confidenceRank(confidence) > confidenceRank(existing.confidence)
    )
      detections.set(key, detection);
  };

  for (const link of extractHtmlAnchors(pageUrl, html))
    add(link.url, "high", [
      `Official careers page ${pageUrl} links directly to the ATS board.`,
      `Link text: ${link.text || "(empty)"}`,
      `External ATS URL: ${link.url}`,
    ]);

  const canonical = html.match(
    /<link\b[^>]*\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i,
  )?.[1];
  if (canonical) {
    try {
      const url = new URL(canonical, pageUrl).toString();
      add(url, "medium", [`Canonical careers URL observed on ${pageUrl}.`]);
    } catch {
      // Ignore malformed untrusted canonical metadata.
    }
  }

  for (const match of html.matchAll(
    /https?:\/\/(?:boards(?:\.eu)?\.greenhouse\.io|job-boards\.greenhouse\.io|jobs(?:\.eu)?\.lever\.co|jobs\.ashbyhq\.com|apply\.workable\.com|jobs\.smartrecruiters\.com|[^"' <]+(?:myworkdayjobs|myworkdaysite|personio|recruitee|successfactors|sapsf|oraclecloud)\.[^"' <]+)[^"' <]*/gi,
  ))
    add(match[0], "low", [
      `Recognised ATS URL appears in metadata or page source at ${pageUrl}.`,
    ]);

  return [...detections.values()].sort(
    (left, right) =>
      confidenceRank(right.confidence) - confidenceRank(left.confidence),
  );
}

export function findCareerLink(
  baseUrl: string,
  html: string,
): string | undefined {
  const links = extractHtmlAnchors(baseUrl, html);
  return links.find((link) =>
    /(?:career|jobs?|vacanc|join[-_ ]?us|work[-_ ]?with[-_ ]?us|opportunit)/i.test(
      `${link.url} ${link.text}`,
    ),
  )?.url;
}

export function extractHtmlAnchors(baseUrl: string, html: string): HtmlLink[] {
  const links: HtmlLink[] = [];
  for (const match of html.matchAll(
    /<a\b([^>]*)\bhref\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const url = new URL(match[2], baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      links.push({
        url: url.toString(),
        text: htmlToSafeText(match[4]).replace(/\s+/g, " ").trim(),
      });
    } catch {
      // Ignore malformed untrusted links.
    }
  }
  return [
    ...new Map(
      links.map((link) => [`${link.url}\u0000${link.text}`, link]),
    ).values(),
  ];
}

export function extractHtmlLinks(baseUrl: string, html: string): string[] {
  return [
    ...new Set(extractHtmlAnchors(baseUrl, html).map((link) => link.url)),
  ];
}

function hostMatcher(hosts: string[]): (hostname: string) => boolean {
  return (hostname) =>
    hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function firstPathPart(url: URL): string | undefined {
  return url.pathname.split("/").filter(Boolean)[0];
}

function hostPrefix(url: URL): string | undefined {
  return url.hostname.split(".")[0];
}

function personioIdentifier(url: URL): string | undefined {
  const host = hostPrefix(url);
  if (host && !["jobs", "recruiting", "personio"].includes(host)) return host;
  return firstPathPart(url);
}

function confidenceRank(value: DetectedCareerSource["confidence"]): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}
