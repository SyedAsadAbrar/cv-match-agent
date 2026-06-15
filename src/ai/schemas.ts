import { z } from "zod";

const cvProfileBaseSchema = z.object({
  name: z.string().optional(),
  currentTitle: z.string().optional(),
  yearsOfExperience: z.number().nonnegative().optional(),
  summary: z.string().min(1),
  education: z
    .array(
      z.object({
        degree: z.string().optional(),
        institution: z.string().optional(),
        field: z.string().optional(),
        graduationYear: z.number().int().optional(),
        notes: z.string().optional()
      })
    )
    .default([]),
  skills: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  companies: z.array(z.string()).default([]),
  workExperience: z.array(
    z.object({
      company: z.string().optional(),
      role: z.string().optional(),
      location: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      description: z.string().optional(),
      responsibilities: z.array(z.string()).default([]),
      technologies: z.array(z.string()).default([]),
      achievements: z.array(z.string()).default([])
    })
  ).default([]),
  projects: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      technologies: z.array(z.string()).default([]),
      impact: z.string().optional()
    })
  ).default([]),
  achievements: z.array(z.string()).default([])
});

export const cvProfileSchema = z.preprocess(normalizeCvProfileInput, cvProfileBaseSchema);

export const jobRequirementsSchema = z.object({
  roleTitle: z.string().min(1),
  company: z.string().optional(),
  location: z.string().optional(),
  seniority: z.string().optional(),
  requiredSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  educationRequirements: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  domain: z.string().optional(),
  keywords: z.array(z.string()).default([])
});

export const matchAnalysisSchema = z.object({
  matchScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  strongMatches: z.array(z.string()).default([]),
  partialMatches: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  suggestedPositioning: z.string().min(1),
  keywordSuggestions: z.array(z.string()).default([])
});

export const applicationAssetsSchema = z.object({
  cvImprovements: z.object({
    improvedBullets: z.array(z.string()).default([]),
    skillsToEmphasize: z.array(z.string()).default([]),
    experienceToRewrite: z.array(z.string()).default([]),
    missingKeywords: z.array(z.string()).default([])
  }),
  linkedinMessage: z.string().min(1),
  coverLetter: z.string().min(1),
  interviewPrep: z.object({
    likelyInterviewTopics: z.array(z.string()).default([]),
    technicalQuestions: z.array(z.string()).default([]),
    behavioralQuestions: z.array(z.string()).default([]),
    suggestedTalkingPoints: z.array(z.string()).default([])
  })
});

export const rawAnalysisSchema = z.object({
  provider: z.string(),
  generatedAt: z.string(),
  cvProfile: cvProfileSchema,
  jobRequirements: jobRequirementsSchema,
  matchAnalysis: matchAnalysisSchema,
  applicationAssets: applicationAssetsSchema
});

export type CvProfile = z.infer<typeof cvProfileSchema>;
export type JobRequirements = z.infer<typeof jobRequirementsSchema>;
export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
export type ApplicationAssets = z.infer<typeof applicationAssetsSchema>;
export type RawAnalysis = z.infer<typeof rawAnalysisSchema>;

function normalizeCvProfileInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized: Record<string, unknown> = { ...value };
  stripEmptyStrings(normalized);

  if (!hasNonEmptyString(normalized.summary)) {
    normalized.summary = findFirstString(normalized, [
      "professionalSummary",
      "profileSummary",
      "careerSummary",
      "candidateSummary",
      "objective",
      "about",
      "bio"
    ]) ?? buildSummaryFallback(normalized);
  }

  normalized.workExperience = normalizeWorkExperience(normalized.workExperience);
  normalized.skills = normalizeStringArray(normalized.skills);
  normalized.industries = normalizeStringArray(normalized.industries);
  normalized.companies = normalizeStringArray(normalized.companies);
  normalized.achievements = normalizeStringArray(normalized.achievements);
  normalized.education = normalizeObjectArray(normalized.education);
  normalized.projects = normalizeObjectArray(normalized.projects);

  return normalized;
}

function normalizeWorkExperience(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const merged = new Map<string, Record<string, unknown>>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const normalizedEntry: Record<string, unknown> = { ...entry };
    stripEmptyStrings(normalizedEntry);

    if (!hasNonEmptyString(normalizedEntry.role)) {
      normalizedEntry.role = findFirstString(normalizedEntry, ["title", "position", "jobTitle"]);
    }

    normalizedEntry.responsibilities = normalizeStringArray(normalizedEntry.responsibilities);
    normalizedEntry.technologies = normalizeStringArray(normalizedEntry.technologies);
    normalizedEntry.achievements = normalizeStringArray(normalizedEntry.achievements);

    const key = buildWorkExperienceKey(normalizedEntry);
    const existing = merged.get(key);

    if (existing) {
      mergeWorkExperience(existing, normalizedEntry);
    } else {
      merged.set(key, normalizedEntry);
    }
  }

  return [...merged.values()];
}

function buildWorkExperienceKey(entry: Record<string, unknown>): string {
  return [
    asNonEmptyString(entry.company) ?? "unknown-company",
    asNonEmptyString(entry.role) ?? "unknown-role",
    asNonEmptyString(entry.startDate) ?? "",
    asNonEmptyString(entry.endDate) ?? ""
  ]
    .map((value) => value.toLowerCase())
    .join("|");
}

function mergeWorkExperience(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const field of ["company", "role", "location", "startDate", "endDate", "description"] as const) {
    if (!hasNonEmptyString(target[field]) && hasNonEmptyString(source[field])) {
      target[field] = source[field];
    }
  }

  target.responsibilities = mergeStringArrays(target.responsibilities, source.responsibilities);
  target.technologies = mergeStringArrays(target.technologies, source.technologies);
  target.achievements = mergeStringArrays(target.achievements, source.achievements);
}

function buildSummaryFallback(profile: Record<string, unknown>): string {
  const details: string[] = [];
  const title = asNonEmptyString(profile.currentTitle);
  const yearsOfExperience = typeof profile.yearsOfExperience === "number" ? profile.yearsOfExperience : undefined;
  const skills = Array.isArray(profile.skills)
    ? profile.skills.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0)
    : [];

  if (title) {
    details.push(title);
  }

  if (yearsOfExperience !== undefined) {
    details.push(`${yearsOfExperience} years of experience`);
  }

  if (skills.length > 0) {
    details.push(`skills include ${skills.slice(0, 8).join(", ")}`);
  }

  if (details.length > 0) {
    return `Candidate profile extracted from the CV: ${details.join("; ")}.`;
  }

  return "Candidate profile extracted from the CV. Review the source CV for details.";
}

function findFirstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asNonEmptyString(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeObjectArray(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .filter(isRecord)
    .map((entry) => {
      const normalizedEntry: Record<string, unknown> = { ...entry };
      stripEmptyStrings(normalizedEntry);
      return normalizedEntry;
    });
}

function mergeStringArrays(left: unknown, right: unknown): string[] {
  return uniqueCaseInsensitive([...normalizeStringArray(left), ...normalizeStringArray(right)]);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueCaseInsensitive(
    value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
  );
}

function uniqueCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function stripEmptyStrings(record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim().length === 0) {
      delete record[key];
    }
  }
}

function hasNonEmptyString(value: unknown): boolean {
  return asNonEmptyString(value) !== undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
