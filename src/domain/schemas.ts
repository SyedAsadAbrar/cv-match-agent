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

export const companyVerificationStatusSchema = z.enum([
  "candidate",
  "domain-resolved",
  "careers-page-found",
  "source-verified",
  "monitored",
  "temporarily-failing",
  "inactive",
  "rejected",
]);

export const atsProviderSchema = z.enum([
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "workday",
  "personio",
  "recruitee",
  "successfactors",
  "oracle",
  "custom",
]);

export const companyBoardStateSchema = z.enum([
  "active-with-jobs",
  "active-empty",
  "temporarily-unavailable",
  "invalid",
  "wrong-company",
  "unsupported",
  "blocked",
]);

export const detectedCareerSourceSchema = z.object({
  provider: atsProviderSchema,
  identifier: optionalText,
  sourceUrl: z.string().url(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: stringList,
  ingestible: z.boolean(),
});

export const hiringSourceClassificationSchema = z.enum([
  "direct-employer",
  "recruitment-agency",
  "staffing-consultancy",
  "job-platform",
  "government-portal",
  "ecosystem-directory",
  "unknown",
]);

export const companySourceVerificationResultSchema = z.object({
  sourceReachable: z.boolean(),
  responseValid: z.boolean(),
  sourceIdentityMatchesCompany: z.boolean(),
  boardState: companyBoardStateSchema,
  jobsParsed: z.number().int().nonnegative(),
  sampleJobUrl: z.string().url().optional(),
  sampleExternalId: optionalText,
  evidence: stringList,
  checkedAt: text,
});

export const companySourceReferenceSchema = z.object({
  sourceRecordId: text,
  sourceType: text,
  sourceName: text,
  sourceUrl: z.string().url(),
  sourcePublishedAt: optionalText,
  sourceRetrievedAt: text,
  originalIdentifier: optionalText,
});

export const targetCompanySchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const input = value as Record<string, unknown>;
    const name = input.displayName ?? input.name ?? input.legalName;
    return {
      ...input,
      name,
      legalName: input.legalName ?? name,
      displayName: input.displayName ?? name,
      aliases: input.aliases ?? [],
      operatingCountries: input.operatingCountries ?? input.countries ?? [],
      hiringCountries: input.hiringCountries ?? input.countries ?? [],
      countries: input.countries ?? input.hiringCountries ?? [],
      knownCities: input.knownCities ?? [],
      industries: input.industries ?? [],
      companyType: input.companyType ?? "unknown",
      sizeBand: input.sizeBand ?? "unknown",
      engineeringRelevance: input.engineeringRelevance ?? "unknown",
      englishEngineeringJobsLikelihood:
        input.englishEngineeringJobsLikelihood ?? "unknown",
      sourceType: input.sourceType ?? "legacy-manual",
      sourceRecords: input.sourceRecords ?? [],
      hiringSourceClassification: input.hiringSourceClassification ?? "unknown",
      sponsorshipCountries: input.sponsorshipCountries ?? [],
      relocationEvidence: input.relocationEvidence ?? "unknown",
      remoteHiringEvidence: input.remoteHiringEvidence ?? "unknown",
      verificationFailureCount: input.verificationFailureCount ?? 0,
      sourceDetections: input.sourceDetections ?? [],
      verificationStatus:
        input.verificationStatus ??
        (input.enabled ? "source-verified" : "candidate"),
      discoveredAt: input.discoveredAt ?? new Date(0).toISOString(),
    };
  },
  z.object({
    id: text,
    name: text,
    legalName: text,
    displayName: text,
    aliases: stringList,
    companyDomain: optionalText,
    websiteUrl: z.string().url().optional(),
    careersUrl: z.string().url().optional(),
    headquartersCountry: optionalText,
    operatingCountries: stringList,
    hiringCountries: stringList,
    countries: stringList,
    knownCities: stringList,
    industries: stringList,
    companyType: z.enum([
      "startup",
      "scaleup",
      "enterprise",
      "government-related",
      "consultancy",
      "bank",
      "telecom",
      "marketplace",
      "unknown",
    ]),
    sizeBand: z.enum([
      "1-10",
      "11-50",
      "51-200",
      "201-500",
      "501-1000",
      "1001-5000",
      "5001+",
      "unknown",
    ]),
    engineeringRelevance: z.enum(["high", "medium", "low", "unknown"]),
    englishEngineeringJobsLikelihood: z.enum([
      "high",
      "medium",
      "low",
      "unknown",
    ]),
    atsProvider: atsProviderSchema.optional(),
    atsIdentifier: optionalText,
    atsBoardUrl: z.string().url().optional(),
    corporateCareersUrl: z.string().url().optional(),
    sourceDetections: z.array(detectedCareerSourceSchema),
    sourceDetectionCheckedAt: optionalText,
    sharedCareerBoardKey: optionalText,
    sourceType: text,
    sourceRecords: z.array(companySourceReferenceSchema),
    hiringSourceClassification: hiringSourceClassificationSchema,
    sponsorshipEvidence: z.enum([
      "confirmed",
      "historical",
      "possible",
      "unknown",
      "unlikely",
    ]),
    sponsorshipCountries: stringList,
    sponsorshipEvidenceSources: stringList,
    relocationEvidence: z.enum([
      "confirmed",
      "historical",
      "possible",
      "unknown",
      "unlikely",
    ]),
    remoteHiringEvidence: z.enum([
      "confirmed",
      "possible",
      "unknown",
      "unlikely",
    ]),
    verificationStatus: companyVerificationStatusSchema,
    enabled: z.boolean(),
    discoveredAt: text,
    resolvedAt: optionalText,
    lastCheckedAt: optionalText,
    lastSuccessfulSyncAt: optionalText,
    boardState: companyBoardStateSchema.optional(),
    lastVerification: companySourceVerificationResultSchema.optional(),
    verificationFailureCount: z.number().int().nonnegative(),
    nextVerificationAt: optionalText,
    verificationError: optionalText,
    notes: optionalText,
  }),
);

export const companySourceRecordSchema = z.object({
  sourceRecordId: text,
  legalName: text,
  displayName: optionalText,
  aliases: stringList,
  sourceType: z.enum([
    "official-sponsor-register",
    "official-permit-list",
    "official-job-portal",
    "government-open-data",
    "government-startup-ecosystem",
    "official-company-page",
    "verified-curated-list",
  ]),
  sourceName: text,
  sourceUrl: z.string().url(),
  sourcePublishedAt: optionalText,
  sourceRetrievedAt: text,
  country: text,
  cities: stringList,
  websiteUrl: z.string().url().optional(),
  careersUrl: z.string().url().optional(),
  atsBoardUrl: z.string().url().optional(),
  hiringSourceClassification: hiringSourceClassificationSchema.optional(),
  parentCompanyName: optionalText,
  relationship: z
    .enum(["parent", "subsidiary", "brand", "former-name", "regional-entity"])
    .optional(),
  industries: stringList,
  sponsorshipEvidence: z
    .object({
      level: z.enum([
        "confirmed-register",
        "permit-history",
        "company-statement",
        "historical",
        "possible",
        "unknown",
      ]),
      countries: stringList,
      sourceUrls: z.array(z.string().url()).default([]),
      observedAt: optionalText,
    })
    .optional(),
  notes: optionalText,
});

export const companyRelationshipSchema = z.object({
  parentCompanyId: optionalText,
  subsidiaryCompanyId: optionalText,
  relationship: z.enum([
    "parent",
    "subsidiary",
    "brand",
    "former-name",
    "regional-entity",
  ]),
});

export const companyImportRunSchema = z.object({
  id: text,
  sourceName: text,
  status: z.enum(["running", "completed", "partially-completed", "failed"]),
  sourceUrl: z.string().url(),
  sourceVersion: optionalText,
  sourcePublishedAt: optionalText,
  startedAt: text,
  completedAt: optionalText,
  recordsRead: z.number().int().nonnegative(),
  recordsCreated: z.number().int().nonnegative(),
  recordsUpdated: z.number().int().nonnegative(),
  duplicatesFound: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  errors: z.array(z.object({ recordId: optionalText, message: text })),
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
  hiringSourceClassification:
    hiringSourceClassificationSchema.default("unknown"),
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
export type CompanySourceRecord = z.infer<typeof companySourceRecordSchema>;
export type CompanySourceReference = z.infer<
  typeof companySourceReferenceSchema
>;
export type CompanyRelationship = z.infer<typeof companyRelationshipSchema>;
export type CompanyImportRun = z.infer<typeof companyImportRunSchema>;
export type CompanyVerificationStatus = z.infer<
  typeof companyVerificationStatusSchema
>;
export type CompanyBoardState = z.infer<typeof companyBoardStateSchema>;
export type HiringSourceClassification = z.infer<
  typeof hiringSourceClassificationSchema
>;
export type CompanySourceVerificationResult = z.infer<
  typeof companySourceVerificationResultSchema
>;
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
    targetCountries: [
      "United Arab Emirates",
      "Saudi Arabia",
      "Ireland",
      "Germany",
      "Netherlands",
      "Belgium",
      "Estonia",
      "France",
      "Spain",
      "Portugal",
      "Austria",
      "Denmark",
      "Sweden",
      "Finland",
      "Poland",
      "Czechia",
    ],
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
