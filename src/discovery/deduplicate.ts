import type { JobPosting } from "../domain/schemas";

export function areDuplicateJobs(left: JobPosting, right: JobPosting): boolean {
  if (canonical(left.canonicalUrl) === canonical(right.canonicalUrl))
    return true;
  if (
    left.externalId &&
    right.externalId &&
    left.sourceType === right.sourceType &&
    left.externalId === right.externalId
  )
    return true;
  return (
    normalize(left.company) === normalize(right.company) &&
    normalize(left.title) === normalize(right.title) &&
    normalize(left.locationText ?? "") ===
      normalize(right.locationText ?? "") &&
    left.rawContentHash === right.rawContentHash
  );
}

export function deduplicateJobs(jobs: JobPosting[]): {
  jobs: JobPosting[];
  duplicates: number;
} {
  const unique: JobPosting[] = [];
  let duplicates = 0;
  for (const job of jobs) {
    const index = unique.findIndex((candidate) =>
      areDuplicateJobs(candidate, job),
    );
    if (index < 0) unique.push(job);
    else {
      duplicates += 1;
      if (
        sourcePriority(job.sourceType) >
        sourcePriority(unique[index].sourceType)
      )
        unique[index] = job;
    }
  }
  return { jobs: unique, duplicates };
}

function sourcePriority(source: JobPosting["sourceType"]): number {
  return [
    "greenhouse",
    "lever",
    "ashby",
    "company-careers",
    "official-job-portal",
  ].includes(source)
    ? 3
    : source === "web-search"
      ? 1
      : 0;
}

function canonical(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_|source|ref|gh_src|lever-source)/i.test(key))
      parsed.searchParams.delete(key);
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
