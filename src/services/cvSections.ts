import type { CvProfile, SemanticCv } from "../ai/schemas";

type SemanticCvItem = SemanticCv["sections"][number]["items"][number];

const SECTION_ALIASES: Array<[string, string[]]> = [
  ["employment", ["employment", "experience", "work experience", "professional experience"]],
  ["education", ["education"]],
  ["projects", ["projects", "personal projects", "selected projects"]],
  ["achievements", ["achievements", "awards", "additional experience and awards", "additional experience"]],
  ["skills", ["skills", "technologies", "languages, technologies and tools", "languages and technologies"]]
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

export function assertProfilePreservesEmploymentBullets(profile: CvProfile, semanticCv: SemanticCv): void {
  const missing: string[] = [];
  const profileExperience = profile.workExperience;

  for (const sourceItem of getEmploymentItems(semanticCv)) {
    const profileItem = findMatchingProfileExperience(profileExperience, sourceItem);

    if (!profileItem) {
      missing.push(`${sourceItem.heading}: no matching profile experience`);
      continue;
    }

    for (const bullet of sourceItem.bullets) {
      if (!profileItem.responsibilities.some((responsibility) => sameMeaning(responsibility, bullet))) {
        missing.push(`${sourceItem.heading}: ${bullet}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `CV profile extraction dropped ${missing.length} employment bullet(s). ` +
        `First missing bullet: ${missing[0]}. No further AI calls were made.`
    );
  }
}

export function mergeEmploymentBulletsIntoProfile(profile: CvProfile, semanticCv: SemanticCv): CvProfile {
  const workExperience = profile.workExperience.map((experience) => ({ ...experience }));

  for (const sourceItem of getEmploymentItems(semanticCv)) {
    const profileItem = findMatchingProfileExperience(workExperience, sourceItem);

    if (profileItem) {
      profileItem.responsibilities = mergeBullets(sourceItem.bullets, profileItem.responsibilities);
      continue;
    }

    workExperience.push({
      company: sourceItem.company,
      role: sourceItem.role,
      location: sourceItem.location,
      startDate: sourceItem.startDate,
      endDate: sourceItem.endDate,
      responsibilities: sourceItem.bullets,
      technologies: [],
      achievements: []
    });
  }

  return { ...profile, workExperience };
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
  const parts = heading.split(/\t+|\s{2,}/).map((part) => part.trim()).filter(Boolean);

  if (parts.length < 2) {
    return undefined;
  }

  return {
    item: {
      heading,
      role: parts[0],
      company: parts[1],
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

function getEmploymentItems(semanticCv: SemanticCv): SemanticCvItem[] {
  return semanticCv.sections.flatMap((section) => (section.type === "employment" ? section.items : []));
}

function findMatchingProfileExperience(
  experiences: CvProfile["workExperience"],
  sourceItem: SemanticCvItem
): CvProfile["workExperience"][number] | undefined {
  let bestMatch: CvProfile["workExperience"][number] | undefined;
  let bestScore = 0;

  for (const experience of experiences) {
    const score =
      matchScore(experience.company, sourceItem.company, 3) +
      matchScore(experience.role, sourceItem.role, 3) +
      matchScore(experience.startDate, sourceItem.startDate, 1) +
      matchScore(experience.endDate, sourceItem.endDate, 1);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = experience;
    }
  }

  return bestScore >= 4 ? bestMatch : undefined;
}

function mergeBullets(sourceBullets: string[], profileBullets: string[]): string[] {
  const merged: string[] = [];

  for (const bullet of [...sourceBullets, ...profileBullets]) {
    if (!merged.some((existing) => sameMeaning(existing, bullet))) {
      merged.push(bullet);
    }
  }

  return merged;
}

function matchScore(left: string | undefined, right: string | undefined, score: number): number {
  if (!left || !right) {
    return 0;
  }

  const normalizedLeft = normalizeForMatch(left);
  const normalizedRight = normalizeForMatch(right);

  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? score : 0;
}

function sameMeaning(left: string, right: string): boolean {
  const normalizedLeft = normalizeForMatch(left);
  const normalizedRight = normalizeForMatch(right);

  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeHeading(line: string): string {
  return stripMarkdownHeading(line).toLowerCase();
}

function stripMarkdownHeading(line: string): string {
  return line.replace(/^#+\s*/, "").trim();
}

function looksLikeStandaloneDate(line: string): boolean {
  return DATE_RANGE_PATTERN.test(line) || /^(?:[A-Za-z]+\s+)?\d{4}$/.test(line);
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
