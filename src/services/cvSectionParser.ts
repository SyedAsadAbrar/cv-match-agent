import type { SemanticCv } from "../ai/schemas";

type SemanticCvItem = SemanticCv["sections"][number]["items"][number];

const SECTION_ALIASES: Array<[string, string[]]> = [
  ["summary", ["summary", "profile", "professional summary"]],
  ["employment", ["employment", "experience", "work experience", "professional experience", "work history", "professional history"]],
  ["education", ["education"]],
  ["projects", ["projects", "personal projects", "selected projects"]],
  ["achievements", ["achievements", "awards", "additional experience and awards", "additional experience", "honors and awards"]],
  ["skills", ["skills", "technical skills", "technologies", "languages, technologies and tools", "languages and technologies"]],
  ["certifications", ["certifications", "licenses and certifications"]]
];

const DATE_RANGE_PATTERN =
  /((?:[A-Za-z]+\s+)?\d{4})\s*(?:-|–|—|to)\s*((?:[A-Za-z]+\s+)?(?:\d{4}|present|current|now))/i;

export function extractCvSections(cvText: string): SemanticCv {
  const lines = normalizeCvLines(cvText);
  const header: string[] = [];
  const sections: SemanticCv["sections"] = [];
  let currentSection: SemanticCv["sections"][number] | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionType = getSectionType(line);

    if (sectionType) {
      currentSection = {
        type: sectionType,
        heading: stripMarkdownHeading(line),
        content: [],
        items: []
      };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection) {
      header.push(line);
      continue;
    }

    currentSection.content.push(line);

    if (currentSection.type === "employment") {
      const parsed = parseEmploymentItem(lines, index);
      if (parsed) {
        currentSection.items.push(parsed.item);
        index = parsed.nextIndex;
      }
    }
  }

  return { header, sections };
}

function normalizeCvLines(cvText: string): string[] {
  return cvText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
}

function getSectionType(line: string): string | undefined {
  const normalized = normalizeHeading(line);

  for (const [type, aliases] of SECTION_ALIASES) {
    if (aliases.includes(normalized)) {
      return type;
    }
  }

  return undefined;
}

function parseEmploymentItem(
  lines: string[],
  index: number
): { item: SemanticCvItem; nextIndex: number } | undefined {
  const heading = parseEmploymentHeading(lines, index);
  if (!heading) {
    return undefined;
  }

  const bullets: string[] = [];
  let nextIndex = heading.nextIndex + 1;

  while (nextIndex < lines.length) {
    const line = lines[nextIndex];

    if (getSectionType(line) || parseEmploymentHeading(lines, nextIndex)) {
      break;
    }

    const bullet = parseBullet(line);
    if (bullet) {
      bullets.push(bullet);
      nextIndex += 1;
      continue;
    }

    if (bullets.length > 0 && !looksLikeStandaloneDate(line)) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`.trim();
    }

    nextIndex += 1;
  }

  return {
    item: { ...heading.item, bullets },
    nextIndex: nextIndex - 1
  };
}

function parseEmploymentHeading(
  lines: string[],
  index: number
): { item: Omit<SemanticCvItem, "bullets">; nextIndex: number } | undefined {
  const line = lines[index];
  const markdownHeading = line.match(/^#{2,4}\s+(.+)$/);

  if (markdownHeading) {
    const dateRange = parseDateRange(lines[index + 1] ?? "");
    if (!dateRange) {
      return undefined;
    }

    const heading = markdownHeading[1].trim();
    const [role, company] = splitMarkdownRoleCompany(heading);
    return {
      item: { heading, role, company, ...dateRange },
      nextIndex: index + 1
    };
  }

  const dateRange = parseDateRange(line);
  const dateMatch = line.match(DATE_RANGE_PATTERN);
  if (!dateRange || !dateMatch || dateMatch.index === undefined) {
    return undefined;
  }

  const heading = line.slice(0, dateMatch.index).trim();
  const parts = heading.split(/\t+|\s{2,}|\s+\|\s+/).map((part) => part.trim()).filter(Boolean);

  if (parts.length < 2) {
    return undefined;
  }

  return {
    item: {
      heading,
      role: parts[0],
      company: parts[1],
      location: parts[2],
      ...dateRange
    },
    nextIndex: index
  };
}

function parseDateRange(value: string): Pick<SemanticCvItem, "startDate" | "endDate"> | undefined {
  const match = value.match(DATE_RANGE_PATTERN);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const endsNearLineEnd = match.index + match[0].length >= value.length - 2;
  if (!endsNearLineEnd) {
    return undefined;
  }

  return {
    startDate: match[1].trim(),
    endDate: match[2].trim()
  };
}

function splitMarkdownRoleCompany(value: string): [string | undefined, string | undefined] {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return [parts[0], parts.slice(1).join(", ")];
  }

  return [value, undefined];
}

function parseBullet(line: string): string | undefined {
  return line.match(/^(?:[-*•●]\s+)(.+)$/)?.[1]?.trim();
}

function normalizeHeading(line: string): string {
  return stripMarkdownHeading(line).replace(/:$/, "").toLowerCase();
}

function stripMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}

function looksLikeStandaloneDate(line: string): boolean {
  return DATE_RANGE_PATTERN.test(line) || /^(?:[A-Za-z]+\s+)?\d{4}$/.test(line);
}
