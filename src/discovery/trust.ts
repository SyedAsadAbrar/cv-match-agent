import type {
  JobPosting,
  JobTrustAssessment,
  TargetCompany,
} from "../domain/schemas";

const ATS_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "jobs.ashbyhq.com",
]);

export function assessJobTrust(
  job: JobPosting,
  company?: TargetCompany,
): JobTrustAssessment {
  const hostname = new URL(job.canonicalUrl).hostname.toLowerCase();
  const recognisedAtsHost =
    ATS_HOSTS.has(hostname) ||
    ["greenhouse", "lever", "ashby", "official-job-portal"].includes(
      job.sourceType,
    );
  const officialDomainMatch = Boolean(
    company &&
    (hostname === company.companyDomain ||
      hostname.endsWith(`.${company.companyDomain}`)),
  );
  const text = `${job.title} ${job.description}`.toLowerCase();
  const suspiciousSignals = [
    [
      /pay (?:a |the )?(?:fee|deposit)|payment required|processing fee/,
      "Requests payment or a fee",
    ],
    [
      /purchase (?:your own )?equipment|buy equipment/,
      "Requests an equipment purchase",
    ],
    [/cryptocurrency|bitcoin|usdt/, "Mentions cryptocurrency payment"],
    [/telegram|whatsapp only|signal app/, "Uses messaging-app-only contact"],
  ].flatMap(([pattern, label]) =>
    pattern instanceof RegExp && pattern.test(text) ? [String(label)] : [],
  );
  let score = 25;
  const evidence: string[] = [];
  if (recognisedAtsHost) {
    score += 35;
    evidence.push(
      job.sourceType === "official-job-portal"
        ? "Posting was published through a verified official job portal."
        : "Posting uses a recognised public ATS source.",
    );
  }
  if (officialDomainMatch) {
    score += 25;
    evidence.push("Posting domain matches the configured company domain.");
  }
  if (job.status === "active" && job.lastVerifiedAt) {
    score += 15;
    evidence.push("Posting was active when last checked.");
  }
  score = Math.max(0, score - suspiciousSignals.length * 35);
  const level =
    suspiciousSignals.length > 0
      ? "suspicious"
      : score >= 80
        ? "verified"
        : score >= 55
          ? "likely-legitimate"
          : "unverified";
  return {
    score,
    level,
    canonicalCompanyPageFound: officialDomainMatch || recognisedAtsHost,
    officialDomainMatch,
    recognisedAtsHost,
    activePostingVerified:
      job.status === "active" && Boolean(job.lastVerifiedAt),
    suspiciousSignals,
    evidence,
  };
}
