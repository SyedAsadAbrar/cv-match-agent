import { z } from "zod";
import type {
  DiscoveredJobReference,
  JobDiscoveryContext,
  JobSourceConnector,
  RawJobPosting,
} from "../types";
import { ConnectorHttpClient, type ConnectorOptions } from "./common";

const PORTAL_HOST = "workindenmark.jobnet.dk";
const SEARCH_PATH = "/bff/FindJob/Search";
const PORTAL_NAME = "Work in Denmark official job portal";

const optionalString = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || undefined);
const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? undefined : value),
  z
    .string()
    .url()
    .nullish()
    .transform((value) => value ?? undefined),
);
const jobSchema = z.object({
  jobAdId: z.string().min(1),
  title: z.string().min(1),
  hiringOrgName: optionalString,
  description: optionalString,
  jobAdUrl: optionalUrl,
  isExternal: z.boolean().optional(),
  country: optionalString,
  postalCode: z.union([z.string(), z.number()]).optional(),
  postalDistrictName: optionalString,
  workPlaceAddress: optionalString,
  workHourPartTime: z.boolean().optional(),
  publicationDate: optionalString,
});
const searchResponseSchema = z.object({
  jobAds: z.array(jobSchema),
  totalJobAdCount: z.number().nonnegative().optional(),
});
type WorkInDenmarkJob = z.infer<typeof jobSchema>;

export function isWorkInDenmarkPortal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.toLowerCase() === PORTAL_HOST;
  } catch {
    return false;
  }
}

export class WorkInDenmarkConnector implements JobSourceConnector {
  readonly sourceType = "official-job-portal" as const;
  private readonly http: ConnectorHttpClient;

  constructor(options: ConnectorOptions = {}) {
    this.http = new ConnectorHttpClient(options);
  }

  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    if (!isWorkInDenmarkPortal(context.company.careersUrl))
      throw new Error("Work in Denmark requires its official job portal URL.");

    const maximumJobs = context.maximumJobs ?? 500;
    const terms = searchTerms(context);
    const jobs = new Map<string, WorkInDenmarkJob>();
    for (const term of terms) {
      const response = searchResponseSchema.parse(
        await this.http.json(buildSearchUrl(term, maximumJobs), {
          headers: {
            "Content-Type": "application/json",
            "x-csrf": "1",
          },
        }),
      );
      for (const job of response.jobAds) jobs.set(job.jobAdId, job);
    }
    return [...jobs.values()].slice(0, maximumJobs).map((job) => ({
      sourceType: this.sourceType,
      sourceName: PORTAL_NAME,
      externalId: job.jobAdId,
      url: canonicalUrl(job),
      company: job.hiringOrgName ?? context.company.displayName,
      title: job.title,
      locationText: locationText(job),
      publishedAt: job.publicationDate,
      raw: job,
    }));
  }

  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    const raw = jobSchema.parse(reference.raw);
    return {
      sourceType: this.sourceType,
      sourceName: reference.sourceName,
      externalId: raw.jobAdId,
      canonicalUrl: canonicalUrl(raw),
      discoveredUrl: reference.url,
      company: raw.hiringOrgName ?? reference.company,
      title: raw.title,
      locationText: locationText(raw),
      employmentType: raw.workHourPartTime ? "Part-time" : "Full-time",
      description:
        raw.description ??
        "Job details are available through the official Work in Denmark portal.",
      publishedAt: raw.publicationDate,
      status: "active",
    };
  }

  async verifyJobActive(reference: DiscoveredJobReference): Promise<boolean> {
    return jobSchema.safeParse(reference.raw).success;
  }
}

function buildSearchUrl(term: string, maximumJobs: number): string {
  const url = new URL(SEARCH_PATH, `https://${PORTAL_HOST}`);
  url.searchParams.set("resultsPerPage", String(Math.min(maximumJobs, 100)));
  url.searchParams.set("pageNumber", "1");
  url.searchParams.set("orderType", "PublicationDate");
  url.searchParams.set("kmRadius", "50");
  if (term) url.searchParams.set("searchString", term);
  return url.toString();
}

function searchTerms(context: JobDiscoveryContext): string[] {
  const roles = context.profile.targetRoles
    .map((role) => role.trim())
    .filter(Boolean)
    .slice(0, 8);
  return roles.length ? [...new Set(roles)] : [""];
}

function canonicalUrl(job: WorkInDenmarkJob): string {
  if (job.isExternal && job.jobAdUrl) return job.jobAdUrl;
  return `https://${PORTAL_HOST}/find-job/${encodeURIComponent(job.jobAdId)}`;
}

function locationText(job: WorkInDenmarkJob): string | undefined {
  return (
    [
      job.workPlaceAddress,
      job.postalCode?.toString(),
      job.postalDistrictName,
      job.country === "Danmark" ? "Denmark" : job.country,
    ]
      .filter(Boolean)
      .join(", ") || undefined
  );
}
