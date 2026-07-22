import { z } from "zod";
import { htmlToSafeText } from "../../security/content";
import type {
  DiscoveredJobReference,
  JobDiscoveryContext,
  JobSourceConnector,
  RawJobPosting,
} from "../types";
import {
  assertIdentifier,
  ConnectorHttpClient,
  type ConnectorOptions,
} from "./common";

const ashbyCompensationSchema = z
  .object({
    compensationTierSummary: z.string().optional(),
    scrapeableCompensationSalarySummary: z.string().optional(),
  })
  .passthrough();
const ashbyJobSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().min(1),
    location: z.string().optional(),
    workplaceType: z.string().optional(),
    employmentType: z.string().optional(),
    descriptionHtml: z.string().optional(),
    descriptionPlain: z.string().optional(),
    publishedAt: z.string().optional(),
    jobUrl: z.string().url(),
    applyUrl: z.string().url().optional(),
    isListed: z.boolean().optional(),
    compensation: ashbyCompensationSchema.optional(),
  })
  .passthrough();
const ashbyListSchema = z.object({
  apiVersion: z.string().optional(),
  jobs: z.array(ashbyJobSchema),
});

export class AshbyConnector implements JobSourceConnector {
  readonly sourceType = "ashby" as const;
  private readonly http: ConnectorHttpClient;
  constructor(options: ConnectorOptions = {}) {
    this.http = new ConnectorHttpClient(options);
  }

  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    const board = assertIdentifier(
      context.company.atsIdentifier ?? "",
      "Ashby job-board name",
    );
    const payload = ashbyListSchema.parse(
      await this.http.json(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`,
      ),
    );
    return payload.jobs
      .filter((job) => job.isListed !== false)
      .slice(0, context.maximumJobs ?? 500)
      .map((job) => ({
        sourceType: this.sourceType,
        sourceName: `Ashby · ${context.company.name} · ${board}`,
        externalId: job.id ?? extractAshbyId(job.jobUrl),
        url: job.jobUrl,
        company: context.company.name,
        title: job.title,
        locationText: job.location,
        publishedAt: job.publishedAt,
        raw: job,
      }));
  }

  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    const raw = ashbyJobSchema.parse(reference.raw);
    const compensationText =
      raw.compensation?.scrapeableCompensationSalarySummary ??
      raw.compensation?.compensationTierSummary;
    return {
      sourceType: this.sourceType,
      sourceName: reference.sourceName,
      externalId: reference.externalId,
      canonicalUrl: raw.applyUrl ?? raw.jobUrl,
      discoveredUrl: reference.url,
      company: reference.company,
      title: raw.title,
      locationText: raw.location,
      workplaceType: raw.workplaceType,
      employmentType: raw.employmentType,
      description:
        raw.descriptionPlain?.trim() ||
        htmlToSafeText(
          raw.descriptionHtml ??
            "Job details are available on the official application page.",
        ),
      publishedAt: raw.publishedAt,
      compensation: compensationText
        ? parseCompensation(compensationText)
        : undefined,
    };
  }

  async verifyJobActive(reference: DiscoveredJobReference): Promise<boolean> {
    // The discovery payload is the current public board listing. Re-fetching
    // that same board for every posting causes avoidable N+1 network calls.
    return ashbyJobSchema.parse(reference.raw).isListed !== false;
  }
}

function extractAshbyId(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
}

function parseCompensation(sourceText: string): RawJobPosting["compensation"] {
  const currency = sourceText
    .match(/\b(USD|EUR|GBP|AED|CAD|AUD)\b/i)?.[1]
    ?.toUpperCase();
  const values = [...sourceText.matchAll(/(?:[$€£]\s*)?([0-9][0-9,.]*)(k)?/gi)]
    .map((match) => Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1))
    .filter(Number.isFinite);
  const lower = sourceText.toLowerCase();
  return {
    minimum: values[0],
    maximum: values[1],
    currency,
    period: lower.includes("hour")
      ? "hourly"
      : lower.includes("month")
        ? "monthly"
        : "annual",
    sourceText,
  };
}
