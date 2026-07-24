import type {
  CandidateProfile,
  JobPosting,
  WorkAuthorizationAssessment,
} from "../domain/schemas";

export type HardFilterResult = {
  accepted: boolean;
  reasons: string[];
  deprioritized: string[];
};

export function applyHardFilters(
  profile: CandidateProfile,
  job: JobPosting,
  authorization: WorkAuthorizationAssessment,
  now = new Date(),
): HardFilterResult {
  const reasons: string[] = [];
  const deprioritized: string[] = [];
  if (job.status === "closed") reasons.push("Posting is closed.");
  if (
    profile.preferences.excludedCompanies.some(
      (company) => normalize(company) === normalize(job.company),
    )
  ) {
    reasons.push("Company is explicitly excluded.");
  }
  if (
    job.country &&
    profile.targetCountries.length > 0 &&
    !profile.targetCountries.some(
      (country) => normalize(country) === normalize(job.country ?? ""),
    )
  ) {
    reasons.push("Country is outside the configured targets.");
  }
  if (
    /\b(intern|internship|graduate|junior|entry.level)\b/i.test(job.title) &&
    profile.preferences.minimumSeniority &&
    !/junior|entry|graduate/i.test(profile.preferences.minimumSeniority)
  ) {
    reasons.push("Role is below the configured minimum seniority.");
  }
  const unsupportedLanguages = job.languages.filter(
    (language) =>
      language.required &&
      !profile.preferences.requiredLanguages.some(
        (known) => normalize(known) === normalize(language.language),
      ),
  );
  if (unsupportedLanguages.length > 0)
    reasons.push(
      `Mandatory language not in profile: ${unsupportedLanguages.map((item) => item.language).join(", ")}.`,
    );
  if (authorization.status === "incompatible")
    reasons.push("Explicit work-authorisation incompatibility.");
  if (!isRelatedRole(profile, job))
    reasons.push("Title is outside the configured role families.");
  if (job.publishedAt) {
    const ageDays =
      (now.getTime() - new Date(job.publishedAt).getTime()) / 86_400_000;
    if (
      Number.isFinite(ageDays) &&
      ageDays > profile.preferences.maximumJobAgeDays
    )
      reasons.push("Posting is older than the configured maximum age.");
  }
  if (job.status === "possibly-closed" || job.status === "verification-failed")
    deprioritized.push("Active status could not be fully verified.");
  return { accepted: reasons.length === 0, reasons, deprioritized };
}

function isRelatedRole(profile: CandidateProfile, job: JobPosting): boolean {
  if (profile.targetRoles.length === 0) return true;
  const titleTokens = tokens(job.title);
  const jobSkillTokens = new Set(
    [...job.requiredSkills, ...job.preferredSkills].flatMap((skill) => [
      ...tokens(skill),
    ]),
  );
  const profileSkillTokens = new Set(
    profile.skills.flatMap((skill) => [...tokens(skill.name)]),
  );
  const hasProfileSkillEvidence = [...jobSkillTokens].some((skill) =>
    profileSkillTokens.has(skill),
  );
  return profile.targetRoles.some((role) => {
    const roleTokens = tokens(role);
    const overlap = [...roleTokens].filter((token) =>
      titleTokens.has(token),
    ).length;
    // A single broad word (for example, "product") is not enough to make a
    // role relevant. Require two meaningful terms when the target role has
    // more than one, while still allowing precise one-word targets.
    const requiredMatches = roleTokens.size > 1 ? 2 : 1;
    if (
      overlap >= Math.min(requiredMatches, roleTokens.size) &&
      (!requiresSkillEvidence(roleTokens) || hasProfileSkillEvidence)
    )
      return true;

    // Employer titles often use a broad family such as "Software Engineer"
    // even when the vacancy clearly calls for a target speciality. Treat that
    // as a relevant discovery candidate only when the job itself provides
    // matching skill evidence; title-only broad matches remain excluded.
    const roleSpecialties = [...roleTokens].filter(
      (token) => !GENERIC_ENGINEERING_TOKENS.has(token),
    );
    return (
      isGenericEngineeringTitle(titleTokens) &&
      roleSpecialties.some((specialty) => jobSkillTokens.has(specialty))
    );
  });
}

const GENERIC_ENGINEERING_TOKENS = new Set([
  "engineer",
  "engineering",
  "developer",
  "technical",
  "lead",
]);

const AMBIGUOUS_ROLE_TOKENS = new Set([
  ...GENERIC_ENGINEERING_TOKENS,
  "product",
]);

function requiresSkillEvidence(roleTokens: Set<string>): boolean {
  return [...roleTokens].every((token) => AMBIGUOUS_ROLE_TOKENS.has(token));
}

function isGenericEngineeringTitle(titleTokens: Set<string>): boolean {
  return (
    titleTokens.has("engineer") ||
    titleTokens.has("engineering") ||
    titleTokens.has("developer")
  );
}

function tokens(value: string): Set<string> {
  const ignored = new Set(["senior", "junior", "hands", "on", "full"]);
  return new Set(
    normalize(value)
      .replace(/\bfront[\s-]?end\b/g, "frontend")
      .replace(/\bfull[\s-]?stack\b/g, "fullstack")
      .replace(/\bdev(?:eloper)?\b/g, "engineer")
      .replace(/\btech\b/g, "technical")
      .split(" ")
      .filter((token) => token.length > 2 && !ignored.has(token)),
  );
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
