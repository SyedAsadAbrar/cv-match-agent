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
  if (!isRelatedRole(profile.targetRoles, job.title))
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

function isRelatedRole(targetRoles: string[], title: string): boolean {
  if (targetRoles.length === 0) return true;
  const titleTokens = tokens(title);
  return targetRoles.some((role) => {
    const roleTokens = tokens(role);
    return [...roleTokens].some((token) => titleTokens.has(token));
  });
}

function tokens(value: string): Set<string> {
  const ignored = new Set([
    "senior",
    "junior",
    "lead",
    "engineer",
    "developer",
    "technical",
    "hands",
    "on",
  ]);
  return new Set(
    normalize(value)
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
