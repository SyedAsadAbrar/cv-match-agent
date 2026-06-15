import { z } from "zod";

export const cvProfileSchema = z.object({
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
