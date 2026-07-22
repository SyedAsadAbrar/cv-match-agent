import type { TargetCompany } from "../domain/schemas";

export type DetectedCareerSource = {
  provider: NonNullable<TargetCompany["atsProvider"]>;
  identifier?: string;
  url: string;
  ingestible: boolean;
};

const ATS_PATTERNS: Array<{
  provider: DetectedCareerSource["provider"];
  hosts: string[];
  identifier: (url: URL) => string | undefined;
  ingestible: boolean;
}> = [
  {
    provider: "greenhouse",
    hosts: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
    identifier: firstPathPart,
    ingestible: true,
  },
  {
    provider: "lever",
    hosts: ["jobs.lever.co"],
    identifier: firstPathPart,
    ingestible: true,
  },
  {
    provider: "ashby",
    hosts: ["jobs.ashbyhq.com"],
    identifier: firstPathPart,
    ingestible: true,
  },
  {
    provider: "workable",
    hosts: ["apply.workable.com"],
    identifier: firstPathPart,
    ingestible: false,
  },
  {
    provider: "smartrecruiters",
    hosts: ["jobs.smartrecruiters.com"],
    identifier: firstPathPart,
    ingestible: false,
  },
  {
    provider: "workday",
    hosts: ["myworkdayjobs.com"],
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "personio",
    hosts: ["jobs.personio.com"],
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "recruitee",
    hosts: ["recruitee.com"],
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "successfactors",
    hosts: ["successfactors.com"],
    identifier: hostPrefix,
    ingestible: false,
  },
  {
    provider: "oracle",
    hosts: ["oraclecloud.com"],
    identifier: hostPrefix,
    ingestible: false,
  },
];

export function detectCareerSource(
  input: string,
): DetectedCareerSource | undefined {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase();
  const match = ATS_PATTERNS.find(({ hosts }) =>
    hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
  );
  if (!match) return undefined;
  return {
    provider: match.provider,
    identifier: match.identifier(url),
    url: url.toString(),
    ingestible: match.ingestible,
  };
}

export function findCareerLink(
  baseUrl: string,
  html: string,
): string | undefined {
  const links = extractHtmlLinks(baseUrl, html);
  return links.find((link) =>
    /(?:career|jobs?|vacanc|join[-_ ]?us|work[-_ ]?with[-_ ]?us|opportunit)/i.test(
      link,
    ),
  );
}

export function extractHtmlLinks(baseUrl: string, html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    try {
      const url = new URL(match[1], baseUrl);
      if (["http:", "https:"].includes(url.protocol))
        links.push(url.toString());
    } catch {
      // Ignore malformed untrusted links.
    }
  }
  return [...new Set(links)];
}

function firstPathPart(url: URL): string | undefined {
  return url.pathname.split("/").filter(Boolean)[0];
}
function hostPrefix(url: URL): string | undefined {
  return url.hostname.split(".")[0];
}
