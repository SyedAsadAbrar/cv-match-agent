import type {
  CandidateProfile,
  JobPosting,
  TargetCompany,
  WorkAuthorizationAssessment,
} from "../domain/schemas";

const DISCLAIMER =
  "Preliminary evidence only; this is not immigration or legal advice. Confirm eligibility with the employer and official authorities.";

export function assessWorkAuthorization(
  profile: CandidateProfile,
  job: JobPosting,
  company?: TargetCompany,
): WorkAuthorizationAssessment {
  const required =
    profile.personal.requiresWorkPermit &&
    job.country !== profile.personal.currentCountry;
  const source = job.workAuthorization;
  const explicitNo = source.sponsorshipAvailable === false;
  const historical =
    company &&
    ["confirmed", "historical", "possible"].includes(
      company.sponsorshipEvidence,
    );
  if (!required)
    return {
      status: "likely-compatible",
      sponsorshipRequired: false,
      sponsorshipMentioned: source.sponsorshipMentioned,
      relocationMentioned: source.relocationMentioned,
      explicitRestrictions: source.restrictions,
      positiveEvidence: [
        "No cross-border sponsorship requirement is currently indicated.",
      ],
      missingInformation: [],
      explanation:
        "The saved profile does not indicate a sponsorship requirement for this location.",
      disclaimer: DISCLAIMER,
    };
  if (explicitNo)
    return {
      status: "incompatible",
      sponsorshipRequired: true,
      sponsorshipMentioned: true,
      relocationMentioned: source.relocationMentioned,
      explicitRestrictions: source.restrictions,
      positiveEvidence: [],
      missingInformation: [],
      explanation:
        "The posting explicitly indicates that sponsorship is unavailable or existing unrestricted work rights are required.",
      disclaimer: DISCLAIMER,
    };
  if (source.sponsorshipAvailable === true)
    return {
      status: "likely-compatible",
      sponsorshipRequired: true,
      sponsorshipMentioned: true,
      relocationMentioned: source.relocationMentioned,
      explicitRestrictions: source.restrictions,
      positiveEvidence: source.evidenceText,
      missingInformation: [
        "Final eligibility and role-specific sponsorship terms",
      ],
      explanation:
        "The posting contains positive sponsorship evidence, subject to employer confirmation.",
      disclaimer: DISCLAIMER,
    };
  return {
    status: historical ? "possibly-compatible" : "unknown",
    sponsorshipRequired: true,
    sponsorshipMentioned: source.sponsorshipMentioned,
    relocationMentioned: source.relocationMentioned,
    explicitRestrictions: source.restrictions,
    positiveEvidence: historical
      ? [
          "The company registry contains non-role-specific sponsorship evidence.",
        ]
      : [],
    missingInformation: [
      "Role-specific sponsorship availability",
      "Candidate-specific eligibility",
    ],
    explanation:
      "The posting does not provide enough evidence to determine sponsorship compatibility.",
    disclaimer: DISCLAIMER,
  };
}
