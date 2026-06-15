import { z } from "zod";

export const cvProfileSchema = z.object({
  name: z.string().optional(),
  currentTitle: z.string().optional(),
  yearsOfExperience: z.number().nonnegative().optional(),
  summary: z.string().min(1),
  skills: z.array(z.string()),
  industries: z.array(z.string()),
  companies: z.array(z.string()),
  projects: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      technologies: z.array(z.string()),
      impact: z.string().optional()
    })
  ),
  achievements: z.array(z.string())
});

export const jobRequirementsSchema = z.object({
  roleTitle: z.string().min(1),
  company: z.string().optional(),
  location: z.string().optional(),
  seniority: z.string().optional(),
  requiredSkills: z.array(z.string()),
  niceToHaveSkills: z.array(z.string()),
  responsibilities: z.array(z.string()),
  domain: z.string().optional(),
  keywords: z.array(z.string())
});

export const matchAnalysisSchema = z.object({
  matchScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  strongMatches: z.array(z.string()),
  partialMatches: z.array(z.string()),
  gaps: z.array(z.string()),
  risks: z.array(z.string()),
  suggestedPositioning: z.string().min(1),
  keywordSuggestions: z.array(z.string())
});

export const applicationAssetsSchema = z.object({
  cvImprovements: z.object({
    improvedBullets: z.array(z.string()),
    skillsToEmphasize: z.array(z.string()),
    experienceToRewrite: z.array(z.string()),
    missingKeywords: z.array(z.string())
  }),
  linkedinMessage: z.string().min(1),
  coverLetter: z.string().min(1),
  interviewPrep: z.object({
    likelyInterviewTopics: z.array(z.string()),
    technicalQuestions: z.array(z.string()),
    behavioralQuestions: z.array(z.string()),
    suggestedTalkingPoints: z.array(z.string())
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
