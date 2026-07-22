import { z } from "zod";

const text = z.string().trim().min(1);
const optionalText = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  text.optional(),
);
const stringList = z.array(text).default([]);

export const workplaceTypeSchema = z.enum([
  "onsite",
  "hybrid",
  "remote",
  "unknown",
]);
export const jobSourceTypeSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "web-search",
  "company-careers",
  "official-job-portal",
  "manual",
  "unknown",
]);

export const candidateProfileSchema = z.object({
  id: text,
  personal: z.object({
    currentCity: optionalText,
    currentCountry: optionalText,
    citizenship: optionalText,
    requiresWorkPermit: z.boolean(),
  }),
  currentCompensation: z
    .object({
      amount: z.number().nonnegative(),
      currency: text,
      period: z.enum(["monthly", "annual"]),
      grossOrNet: z.enum(["gross", "net", "unknown"]),
    })
    .optional(),
  summary: optionalText,
  targetRoles: stringList,
  targetCountries: stringList,
  experience: z
    .array(
      z.object({
        id: text,
        company: text,
        title: text,
        startDate: optionalText,
        endDate: optionalText,
        isCurrent: z.boolean(),
        achievements: stringList,
        technologies: stringList,
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        institution: text,
        degree: optionalText,
        field: optionalText,
        graduationYear: z.number().int().min(1900).max(2200).optional(),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        name: text,
        proficiency: z.enum(["strong", "working", "exposure"]),
        estimatedYears: z.number().nonnegative().optional(),
        lastUsed: optionalText,
        evidence: stringList,
        confidence: z.number().min(0).max(1),
      }),
    )
    .default([]),
  preferences: z.object({
    workplaceTypes: z.array(z.enum(["onsite", "hybrid", "remote"])).default([]),
    relocationAllowed: z.boolean(),
    preferredIndustries: stringList,
    excludedIndustries: stringList,
    excludedCompanies: stringList,
    requiredLanguages: stringList,
    maximumJobAgeDays: z.number().int().min(1).max(365),
    minimumSeniority: optionalText,
    maximumSeniority: optionalText,
  }),
});

export const targetCompanySchema = z.object({
  id: text,
  name: text,
  companyDomain: text,
  careersUrl: optionalText,
  countries: stringList,
  atsProvider: z
    .enum([
      "greenhouse",
      "lever",
      "ashby",
      "workable",
      "smartrecruiters",
      "workday",
      "personio",
      "recruitee",
      "custom",
    ])
    .optional(),
  atsIdentifier: optionalText,
  sponsorshipEvidence: z.enum([
    "confirmed",
    "historical",
    "possible",
    "unknown",
    "unlikely",
  ]),
  sponsorshipEvidenceSources: stringList,
  enabled: z.boolean(),
  lastCheckedAt: optionalText,
});

export const compensationSchema = z.object({
  minimum: z.number().nonnegative().optional(),
  maximum: z.number().nonnegative().optional(),
  currency: optionalText,
  period: z.enum(["hourly", "monthly", "annual"]).optional(),
  grossOrNet: z.enum(["gross", "net", "unknown"]).optional(),
  sourceText: optionalText,
});

export const jobPostingSchema = z.object({
  id: text,
  externalId: optionalText,
  canonicalUrl: z.string().url(),
  discoveredUrl: z.string().url().optional(),
  sourceType: jobSourceTypeSchema,
  sourceName: optionalText,
  title: text,
  company: text,
  locationText: optionalText,
  city: optionalText,
  country: optionalText,
  workplaceType: workplaceTypeSchema,
  employmentType: optionalText,
  seniority: optionalText,
  description: text,
  responsibilities: stringList,
  requiredSkills: stringList,
  preferredSkills: stringList,
  minimumYearsExperience: z.number().nonnegative().optional(),
  languages: z
    .array(z.object({ language: text, required: z.boolean() }))
    .default([]),
  compensation: compensationSchema.optional(),
  workAuthorization: z.object({
    sponsorshipMentioned: z.boolean(),
    sponsorshipAvailable: z.boolean().optional(),
    relocationMentioned: z.boolean(),
    relocationAvailable: z.boolean().optional(),
    restrictions: stringList,
    evidenceText: stringList,
  }),
  publishedAt: optionalText,
  firstSeenAt: text,
  lastSeenAt: text,
  lastVerifiedAt: optionalText,
  status: z.enum([
    "active",
    "possibly-closed",
    "closed",
    "verification-failed",
  ]),
  rawContentHash: text,
});

export const trustAssessmentSchema = z.object({
  score: z.number().min(0).max(100),
  level: z.enum(["verified", "likely-legitimate", "unverified", "suspicious"]),
  canonicalCompanyPageFound: z.boolean(),
  officialDomainMatch: z.boolean(),
  recognisedAtsHost: z.boolean(),
  activePostingVerified: z.boolean(),
  suspiciousSignals: stringList,
  evidence: stringList,
});

export const workAuthorizationAssessmentSchema = z.object({
  status: z.enum([
    "likely-compatible",
    "possibly-compatible",
    "unknown",
    "likely-incompatible",
    "incompatible",
  ]),
  sponsorshipRequired: z.boolean(),
  sponsorshipMentioned: z.boolean(),
  relocationMentioned: z.boolean(),
  explicitRestrictions: stringList,
  positiveEvidence: stringList,
  missingInformation: stringList,
  explanation: text,
  disclaimer: text,
});

export const salaryEvidenceSchema = z.object({
  id: text,
  evidenceType: z.enum([
    "job-advertisement",
    "same-company-comparable",
    "market-comparable-job",
    "official-statistic",
    "salary-guide",
    "immigration-threshold",
    "user-provided",
  ]),
  sourceName: text,
  sourceUrl: z.string().url().optional(),
  jobTitle: optionalText,
  company: optionalText,
  country: optionalText,
  city: optionalText,
  minimum: z.number().nonnegative().optional(),
  maximum: z.number().nonnegative().optional(),
  currency: text,
  period: z.enum(["hourly", "monthly", "annual"]),
  grossOrNet: z.enum(["gross", "net", "unknown"]),
  collectedAt: text,
  confidence: z.number().min(0).max(1),
});

export const salaryRangeSchema = z.object({
  minimum: z.number().nonnegative().optional(),
  maximum: z.number().nonnegative().optional(),
  currency: text,
  period: z.enum(["hourly", "monthly", "annual"]),
  grossOrNet: z.enum(["gross", "net", "unknown"]),
});

export const salaryAnalysisSchema = z.object({
  advertisedSalary: salaryRangeSchema.optional(),
  estimatedMarketRange: salaryRangeSchema.optional(),
  recommendedExpectation: z
    .object({
      amount: z.number().nonnegative(),
      currency: text,
      period: z.enum(["hourly", "monthly", "annual"]),
    })
    .optional(),
  currentSalary: z.object({
    amount: z.literal(22000),
    currency: z.literal("AED"),
    period: z.literal("monthly"),
  }),
  comparisonStatus: z.enum([
    "not-comparable",
    "insufficient-evidence",
    "potential-decrease",
    "roughly-equivalent",
    "potential-increase",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceCount: z.number().int().nonnegative(),
  evidence: z.array(salaryEvidenceSchema),
  missingInformation: stringList,
  explanation: text,
});

export const gapSchema = z.object({
  type: z.enum([
    "skill-gap",
    "experience-gap",
    "evidence-gap",
    "keyword-gap",
    "seniority-gap",
    "role-positioning-gap",
    "location-gap",
    "work-authorization-gap",
    "language-gap",
  ]),
  requirement: text,
  severity: z.enum(["low", "medium", "high", "blocker"]),
  explanation: text,
  candidateEvidence: stringList,
  recommendation: text,
});

export const matchResultSchema = z.object({
  jobId: text,
  score: z.number().min(0).max(100),
  recommendation: z.enum([
    "strong-apply",
    "apply",
    "stretch",
    "low-priority",
    "skip",
    "eligibility-unclear",
  ]),
  components: z.record(
    z.object({ score: z.number().min(0).max(100), evidence: stringList }),
  ),
  matchedSkills: stringList,
  missingSkills: stringList,
  transferableSkills: stringList,
  gaps: z.array(gapSchema),
  needsDetailedAnalysis: z.boolean(),
  detailedAnalysis: z.record(z.unknown()).optional(),
});

export const discoveryRunSchema = z.object({
  id: text,
  status: z.enum([
    "queued",
    "running",
    "completed",
    "partially-completed",
    "failed",
    "cancelled",
  ]),
  startedAt: optionalText,
  completedAt: optionalText,
  searchesExecuted: z.number().int().nonnegative(),
  sourcesChecked: z.number().int().nonnegative(),
  jobsDiscovered: z.number().int().nonnegative(),
  jobsImported: z.number().int().nonnegative(),
  duplicatesFound: z.number().int().nonnegative(),
  jobsShortlisted: z.number().int().nonnegative(),
  jobsAnalysed: z.number().int().nonnegative(),
  errors: z.array(
    z.object({ source: text, message: text, retryable: z.boolean() }),
  ),
});

export const applicationStatusSchema = z.enum([
  "saved",
  "preparing",
  "applied",
  "recruiter-contact",
  "interview",
  "assessment",
  "offer",
  "rejected",
  "withdrawn",
]);

export const applicationSchema = z.object({
  id: text,
  jobId: text,
  status: applicationStatusSchema,
  appliedAt: optionalText,
  applicationUrl: z.string().url().optional(),
  cvVersion: optionalText,
  notes: z.string().default(""),
  recruiterDetails: z.string().default(""),
  nextAction: z.string().default(""),
  followUpAt: optionalText,
  interviewDates: stringList,
  updatedAt: text,
});

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export type TargetCompany = z.infer<typeof targetCompanySchema>;
export type JobPosting = z.infer<typeof jobPostingSchema>;
export type JobSourceType = z.infer<typeof jobSourceTypeSchema>;
export type JobTrustAssessment = z.infer<typeof trustAssessmentSchema>;
export type WorkAuthorizationAssessment = z.infer<
  typeof workAuthorizationAssessmentSchema
>;
export type SalaryEvidence = z.infer<typeof salaryEvidenceSchema>;
export type SalaryAnalysis = z.infer<typeof salaryAnalysisSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;
export type DiscoveryRun = z.infer<typeof discoveryRunSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const INITIAL_TARGET_ROLES = [
  "Senior Frontend Engineer",
  "Senior React Engineer",
  "Senior TypeScript Engineer",
  "Full-Stack TypeScript Engineer",
  "Product Engineer",
  "Frontend-led Full-Stack Engineer",
  "AI Product Engineer",
  "Hands-on Technical Lead",
] as const;

export function createInitialCandidateProfile(): CandidateProfile {
  return candidateProfileSchema.parse({
    id: "local-user",
    personal: {
      currentCity: "Dubai",
      currentCountry: "United Arab Emirates",
      citizenship: "Pakistan",
      requiresWorkPermit: true,
    },
    currentCompensation: {
      amount: 22000,
      currency: "AED",
      period: "monthly",
      grossOrNet: "unknown",
    },
    targetRoles: [...INITIAL_TARGET_ROLES],
    targetCountries: ["United Arab Emirates"],
    experience: [],
    education: [],
    skills: [],
    preferences: {
      workplaceTypes: ["onsite", "hybrid", "remote"],
      relocationAllowed: true,
      preferredIndustries: [],
      excludedIndustries: [],
      excludedCompanies: [],
      requiredLanguages: ["English"],
      maximumJobAgeDays: 30,
    },
  });
}
