import { z } from "zod";

const text = z.string().trim().min(1);
const textArray = z.array(z.string().trim()).default([]).transform((items) => items.filter(Boolean));
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
      description: optionalText,
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
