import { z } from "zod";

const text = z.string().trim().min(1);
const textArray = z.array(z.unknown()).default([]).transform(normalizeTextArray).pipe(z.array(text));
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  text.optional()
);

export const cvProfileSchema = z.object({
  name: optionalText,
  currentTitle: optionalText,
  location: optionalText,
  yearsOfExperience: z.number().nonnegative().optional(),
  summary: text,
  education: z
    .array(
      z.object({
        degree: optionalText,
        institution: optionalText,
        field: optionalText,
        graduationYear: z.number().int().optional(),
        notes: optionalText
      })
    )
    .default([]),
  skills: textArray,
  industries: textArray,
  companies: textArray,
  workExperience: z.array(
    z.object({
      company: optionalText,
      role: optionalText,
      location: optionalText,
      startDate: optionalText,
      endDate: optionalText,
      responsibilities: textArray,
      technologies: textArray,
      achievements: textArray
    })
  ).default([]),
  projects: z.array(
    z.object({
      name: text,
      description: text,
      technologies: textArray,
      impact: optionalText
    })
  ).default([]),
  achievements: textArray
});

export const jobRequirementsSchema = z.object({
  roleTitle: text,
  company: optionalText,
  location: optionalText,
  seniority: optionalText,
  requiredSkills: textArray,
  niceToHaveSkills: textArray,
  educationRequirements: textArray,
  responsibilities: textArray,
  domain: optionalText,
  keywords: textArray
});

export const matchAnalysisSchema = z.object({
  matchScore: z.number().min(0).max(100),
  summary: text,
  strongMatches: textArray,
  partialMatches: textArray,
  gaps: textArray,
  risks: textArray,
  suggestedPositioning: text,
  keywordSuggestions: textArray
});

export const applicationAssetsSchema = z.object({
  cvImprovements: z.object({
    improvedBullets: textArray,
    skillsToEmphasize: textArray,
    experienceToRewrite: textArray,
    missingKeywords: textArray
  }),
  linkedinMessage: text,
  coverLetter: text,
  interviewPrep: z.object({
    likelyInterviewTopics: textArray,
    technicalQuestions: textArray,
    behavioralQuestions: textArray,
    suggestedTalkingPoints: textArray
  })
});

export const userPreferencesSchema = z.object({
  linkedinTone: optionalText,
  coverLetterLength: optionalText,
  preferredRoles: textArray,
  avoidPhrases: textArray
});

export const outputReviewSchema = z.object({
  passed: z.boolean(),
  issues: textArray,
  suggestedFixes: textArray
});

export const semanticCvSchema = z.object({
  header: textArray,
  sections: z
    .array(
      z.object({
        type: text,
        heading: text,
        content: textArray,
        items: z
          .array(
            z.object({
              heading: text,
              role: optionalText,
              company: optionalText,
              location: optionalText,
              startDate: optionalText,
              endDate: optionalText,
              bullets: textArray
            })
          )
          .default([])
      })
    )
    .default([])
});

export const rawAnalysisSchema = z.object({
  provider: z.string(),
  generatedAt: z.string(),
  semanticCv: semanticCvSchema.optional(),
  cvProfile: cvProfileSchema,
  jobRequirements: jobRequirementsSchema,
  matchAnalysis: matchAnalysisSchema,
  applicationAssets: applicationAssetsSchema,
  review: outputReviewSchema.optional()
});

export type CvProfile = z.infer<typeof cvProfileSchema>;
export type JobRequirements = z.infer<typeof jobRequirementsSchema>;
export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
export type ApplicationAssets = z.infer<typeof applicationAssetsSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type OutputReview = z.infer<typeof outputReviewSchema>;
export type SemanticCv = z.infer<typeof semanticCvSchema>;
export type RawAnalysis = z.infer<typeof rawAnalysisSchema>;

function normalizeTextArray(items: unknown[]): string[] {
  return items.map(normalizeTextArrayItem).filter((item): item is string => typeof item === "string" && item.length > 0);
}

function normalizeTextArrayItem(item: unknown): string | undefined {
  if (typeof item === "string") {
    return item.trim() || undefined;
  }

  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return undefined;
  }

  const values = Object.values(item)
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim())
    .filter(Boolean);

  return values.length > 0 ? values.join(": ") : undefined;
}
