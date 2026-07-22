import type {
  CandidateProfile,
  JobPosting,
  MatchResult,
  WorkAuthorizationAssessment,
} from "../domain/schemas";

export const MATCH_WEIGHTS = {
  requiredSkills: 0.27,
  relevantExperience: 0.2,
  seniority: 0.13,
  roleAlignment: 0.12,
  domainExperience: 0.08,
  relocationFeasibility: 0.12,
  languageCompatibility: 0.04,
  preferences: 0.04,
} as const;

export type EmbeddingScores = {
  profileToJob?: number;
  experienceToResponsibilities?: number;
  skillsToRequirements?: number;
  rolesToTitle?: number;
};

export function scoreJob(
  profile: CandidateProfile,
  job: JobPosting,
  authorization: WorkAuthorizationAssessment,
  embeddings: EmbeddingScores = {},
): MatchResult {
  const candidateSkills = new Map(
    profile.skills.map((skill) => [normalize(skill.name), skill]),
  );
  const matchedSkills = job.requiredSkills.filter((skill) =>
    candidateSkills.has(normalize(skill)),
  );
  const missingSkills = job.requiredSkills.filter(
    (skill) => !candidateSkills.has(normalize(skill)),
  );
  const skillScore =
    job.requiredSkills.length === 0
      ? 60
      : percentage(matchedSkills.length / job.requiredSkills.length);
  const technologyEvidence = profile.experience.flatMap(
    (experience) => experience.technologies,
  );
  const experienceMatches = job.requiredSkills.filter((skill) =>
    technologyEvidence.some((item) => normalize(item) === normalize(skill)),
  );
  const experienceScore = blend(
    job.requiredSkills.length === 0
      ? 55
      : percentage(experienceMatches.length / job.requiredSkills.length),
    embeddings.experienceToResponsibilities,
  );
  const roleScore = blend(
    bestTitleSimilarity(profile.targetRoles, job.title),
    embeddings.rolesToTitle,
  );
  const seniorityScore = scoreSeniority(profile, job);
  const domainScore = blend(50, embeddings.profileToJob);
  const relocationScore = (
    {
      "likely-compatible": 100,
      "possibly-compatible": 72,
      unknown: 45,
      "likely-incompatible": 20,
      incompatible: 0,
    } as const
  )[authorization.status];
  const incompatibleLanguage = job.languages.some(
    (language) =>
      language.required &&
      !profile.preferences.requiredLanguages.some(
        (item) => normalize(item) === normalize(language.language),
      ),
  );
  const languageScore = incompatibleLanguage ? 0 : 100;
  const preferenceScore = scorePreferences(profile, job);
  const components: MatchResult["components"] = {
    requiredSkills: {
      score: blend(skillScore, embeddings.skillsToRequirements),
      evidence: matchedSkills,
    },
    relevantExperience: { score: experienceScore, evidence: experienceMatches },
    seniority: {
      score: seniorityScore,
      evidence: job.seniority
        ? [`Job classified as ${job.seniority}.`]
        : ["Seniority not explicit."],
    },
    roleAlignment: {
      score: roleScore,
      evidence: [`Compared “${job.title}” with configured role families.`],
    },
    domainExperience: {
      score: domainScore,
      evidence: ["No unsupported domain equivalence was assumed."],
    },
    relocationFeasibility: {
      score: relocationScore,
      evidence: authorization.positiveEvidence,
    },
    languageCompatibility: {
      score: languageScore,
      evidence: incompatibleLanguage
        ? ["A mandatory language is not evidenced."]
        : ["No mandatory language blocker detected."],
    },
    preferences: {
      score: preferenceScore,
      evidence: [`Workplace type: ${job.workplaceType}.`],
    },
  };
  const score = round(
    Object.entries(MATCH_WEIGHTS).reduce(
      (total, [name, weight]) => total + components[name].score * weight,
      0,
    ),
  );
  const gaps: MatchResult["gaps"] = missingSkills.map((skill) => ({
    type: "evidence-gap",
    requirement: skill,
    severity: "medium",
    explanation: `The required skill “${skill}” is not explicitly evidenced in the saved profile.`,
    candidateEvidence: [],
    recommendation:
      "Confirm transferable experience before treating this as a true skill gap.",
  }));
  if (
    authorization.status === "unknown" ||
    authorization.status === "likely-incompatible"
  )
    gaps.push({
      type: "work-authorization-gap",
      requirement: "Role-specific sponsorship eligibility",
      severity:
        authorization.status === "likely-incompatible" ? "high" : "medium",
      explanation: authorization.explanation,
      candidateEvidence: authorization.positiveEvidence,
      recommendation:
        "Ask the employer whether this specific vacancy supports sponsorship.",
    });
  return {
    jobId: job.id,
    score,
    recommendation: recommendJob(score, authorization),
    components,
    matchedSkills,
    missingSkills,
    transferableSkills: experienceMatches.filter(
      (skill) => !matchedSkills.includes(skill),
    ),
    gaps,
    needsDetailedAnalysis:
      score >= 54 && authorization.status !== "incompatible",
  };
}

export function recommendJob(
  score: number,
  authorization: WorkAuthorizationAssessment,
): MatchResult["recommendation"] {
  if (authorization.status === "incompatible") return "skip";
  if (
    authorization.sponsorshipRequired &&
    ["unknown", "likely-incompatible"].includes(authorization.status)
  )
    return "eligibility-unclear";
  if (score >= 80) return "strong-apply";
  if (score >= 68) return "apply";
  if (score >= 54) return "stretch";
  if (score >= 40) return "low-priority";
  return "skip";
}

function scorePreferences(profile: CandidateProfile, job: JobPosting): number {
  if (
    job.workplaceType === "unknown" ||
    profile.preferences.workplaceTypes.length === 0
  )
    return 60;
  return profile.preferences.workplaceTypes.includes(job.workplaceType)
    ? 100
    : 20;
}

function scoreSeniority(profile: CandidateProfile, job: JobPosting): number {
  if (!job.seniority) return 60;
  const targets = profile.targetRoles.join(" ").toLowerCase();
  if (targets.includes(job.seniority)) return 100;
  if (job.seniority === "senior" && /lead|staff/.test(targets)) return 80;
  if (job.seniority === "lead" && /senior|staff|lead/.test(targets)) return 75;
  if (job.seniority === "junior" && /senior|lead|staff/.test(targets))
    return 10;
  return 55;
}

function bestTitleSimilarity(roles: string[], title: string): number {
  if (roles.length === 0) return 60;
  const titleTokens = tokens(title);
  return Math.max(
    ...roles.map((role) => {
      const roleTokens = tokens(role);
      const intersection = [...roleTokens].filter((token) =>
        titleTokens.has(token),
      ).length;
      const union = new Set([...roleTokens, ...titleTokens]).size;
      return union === 0 ? 0 : percentage(intersection / union);
    }),
  );
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter(
        (token) =>
          token.length > 2 &&
          !["senior", "engineer", "developer"].includes(token),
      ),
  );
}

function blend(fallback: number, similarity?: number): number {
  if (similarity === undefined || !Number.isFinite(similarity)) return fallback;
  const normalized = similarity <= 1 ? similarity * 100 : similarity;
  return round(fallback * 0.55 + Math.max(0, Math.min(100, normalized)) * 0.45);
}

function percentage(value: number): number {
  return round(value * 100);
}
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim();
}
