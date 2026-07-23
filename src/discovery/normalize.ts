import { createHash, randomUUID } from "node:crypto";
import { jobPostingSchema, type JobPosting } from "../domain/schemas";
import type { RawJobPosting } from "./types";
import { htmlToSafeText } from "../security/content";

const KNOWN_SKILLS = [
  "React",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Next.js",
  "Vue",
  "Angular",
  "HTML",
  "CSS",
  "GraphQL",
  "REST",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "AWS",
  "Azure",
  "GCP",
  "Docker",
  "Kubernetes",
  "Python",
  "Java",
  "Go",
  "C#",
  "Git",
  "CI/CD",
  "Jest",
  "Playwright",
  "Cypress",
  "Tailwind",
  "Redux",
  "Express",
  "NestJS",
  "LLM",
  "Ollama",
  "OpenAI",
];

export function normalizeJob(
  raw: RawJobPosting,
  now = new Date().toISOString(),
): JobPosting {
  const description =
    htmlToSafeText(raw.description).trim() ||
    "Job details are available on the official application page.";
  const requiredSkills = extractSkills(description);
  const location = splitLocation(raw.locationText);
  const workAuthorization = extractWorkAuthorization(description);
  const workplaceType = normalizeWorkplaceType(
    raw.workplaceType ??
      `${raw.locationText ?? ""} ${description.slice(0, 600)}`,
  );
  return jobPostingSchema.parse({
    id: randomUUID(),
    externalId: raw.externalId,
    canonicalUrl: raw.canonicalUrl,
    discoveredUrl: raw.discoveredUrl,
    sourceType: raw.sourceType,
    sourceName: raw.sourceName,
    hiringSourceClassification: raw.hiringSourceClassification,
    title: raw.title,
    company: raw.company,
    locationText: raw.locationText,
    city: location.city,
    country: location.country,
    workplaceType,
    employmentType: raw.employmentType,
    seniority: classifySeniority(raw.title),
    description,
    responsibilities: extractResponsibilities(description),
    requiredSkills,
    preferredSkills: [],
    minimumYearsExperience: extractMinimumYears(description),
    languages: extractLanguages(description),
    compensation: raw.compensation
      ? {
          ...raw.compensation,
          grossOrNet: "unknown",
        }
      : undefined,
    workAuthorization,
    publishedAt: raw.publishedAt,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: now,
    status: raw.status ?? "active",
    rawContentHash: createHash("sha256").update(description).digest("hex"),
  });
}

export function extractSkills(text: string): string[] {
  return KNOWN_SKILLS.filter((skill) => {
    const aliases =
      skill === "Node.js"
        ? ["node.js", "nodejs", "node js"]
        : skill === "C#"
          ? ["c#", "c sharp"]
          : skill === "CI/CD"
            ? ["ci/cd", "continuous integration"]
            : skill === "LLM"
              ? ["llm", "large language model"]
              : [skill.toLowerCase()];
    return aliases.some((alias) => text.toLowerCase().includes(alias));
  });
}

function extractResponsibilities(description: string): string[] {
  return description
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 25 && item.length <= 400)
    .slice(0, 12);
}

function normalizeWorkplaceType(value: string): JobPosting["workplaceType"] {
  const normalized = value.toLowerCase();
  if (/\bhybrid\b/.test(normalized)) return "hybrid";
  if (/\bremote\b|work from home/.test(normalized)) return "remote";
  if (/\bon[ -]?site\b|in office/.test(normalized)) return "onsite";
  return "unknown";
}

function classifySeniority(title: string): string | undefined {
  const normalized = title.toLowerCase();
  if (/\b(intern|internship|graduate|junior|entry.level)\b/.test(normalized))
    return "junior";
  if (/\b(principal|staff)\b/.test(normalized)) return "staff";
  if (/\b(lead|manager|head|director)\b/.test(normalized)) return "lead";
  if (/\b(senior|sr\.?|iii)\b/.test(normalized)) return "senior";
  return undefined;
}

function extractMinimumYears(text: string): number | undefined {
  const values = [...text.matchAll(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi)].map(
    (match) => Number(match[1]),
  );
  return values.length > 0
    ? Math.min(...values.filter((value) => value <= 30))
    : undefined;
}

function extractLanguages(text: string): JobPosting["languages"] {
  const languages = [
    "English",
    "German",
    "French",
    "Dutch",
    "Spanish",
    "Arabic",
    "Estonian",
  ];
  return languages.flatMap((language) => {
    const match = text.match(
      new RegExp(`[^.]{0,80}\\b${language}\\b[^.]{0,80}`, "i"),
    );
    if (!match) return [];
    return [
      {
        language,
        required: /required|must|fluent|professional|native/i.test(match[0]),
      },
    ];
  });
}

function extractWorkAuthorization(
  text: string,
): JobPosting["workAuthorization"] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const evidence = sentences
    .filter((item) =>
      /sponsor|visa|relocat|right to work|work authori[sz]ation|residen|eligible to work|EU residents?|European Union|must be (?:based|located)/i.test(
        item,
      ),
    )
    .slice(0, 8);
  const joined = evidence.join(" ");
  const noSponsorship =
    /(?:no|not|unable to|cannot|can't|won't|will not)\s+(?:provide\s+)?(?:visa\s+)?sponsor/i.test(
      joined,
    ) ||
    /must (?:already )?have (?:an )?(?:unrestricted |existing )?right to work/i.test(
      joined,
    ) ||
    /(?:remote|role).{0,80}(?:limited to|only).{0,40}(?:EU residents?|European Union)/i.test(
      joined,
    ) ||
    /must (?:be )?(?:an? )?(?:EU|European Union) resident/i.test(joined);
  const sponsorshipAvailable =
    /(?:visa )?sponsorship (?:is )?(?:available|provided|offered)|we (?:can|will) sponsor/i.test(
      joined,
    );
  const relocationUnavailable =
    /no relocation|relocation (?:is )?not (?:available|provided)/i.test(joined);
  const relocationAvailable =
    /relocation (?:support|assistance|package|available|provided)/i.test(
      joined,
    );
  return {
    sponsorshipMentioned:
      /sponsor|visa|right to work|work authori[sz]ation/i.test(joined),
    sponsorshipAvailable: noSponsorship
      ? false
      : sponsorshipAvailable
        ? true
        : undefined,
    relocationMentioned: /relocat/i.test(joined),
    relocationAvailable: relocationUnavailable
      ? false
      : relocationAvailable
        ? true
        : undefined,
    restrictions: noSponsorship ? evidence : [],
    evidenceText: evidence,
  };
}

function splitLocation(value?: string): { city?: string; country?: string } {
  if (!value) return {};
  const countries = [
    "United Arab Emirates",
    "UAE",
    "Netherlands",
    "Germany",
    "Ireland",
    "Estonia",
    "United Kingdom",
    "UK",
    "France",
    "Spain",
    "Portugal",
    "United States",
    "USA",
    "Canada",
    "Pakistan",
  ];
  const country = countries.find((candidate) =>
    value.toLowerCase().includes(candidate.toLowerCase()),
  );
  const normalizedCountry =
    country === "UAE"
      ? "United Arab Emirates"
      : country === "UK"
        ? "United Kingdom"
        : country === "USA"
          ? "United States"
          : country;
  const city = value.split(",")[0]?.trim();
  return {
    city:
      city && city.toLowerCase() !== normalizedCountry?.toLowerCase()
        ? city
        : undefined,
    country: normalizedCountry,
  };
}
