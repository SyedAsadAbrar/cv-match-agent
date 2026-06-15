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
      title: z.string().optional(),
      company: z.string().optional(),
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

  return normalized;
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
