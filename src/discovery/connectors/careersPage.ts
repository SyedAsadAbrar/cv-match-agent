import { createHash } from "node:crypto";
import { z } from "zod";
import {
  crawlOfficialCareersSite,
  type CrawledJob,
  type CareersCrawlerOptions,
} from "../../company/crawler";
import { crawlPinpointBoard, isPinpointBoardUrl } from "./pinpoint";
import type {
  DiscoveredJobReference,
  JobDiscoveryContext,
  JobSourceConnector,
  RawJobPosting,
} from "../types";

const rawCareerJobSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  url: z.string().url(),
  publishedAt: z.string().optional(),
  locationText: z.string().optional(),
});

export class CareersPageConnector implements JobSourceConnector {
  readonly sourceType = "company-careers" as const;
  constructor(private readonly options: CareersCrawlerOptions = {}) {}

  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    const careersUrls = [
      context.company.careersUrl,
      ...context.company.additionalCareersUrls,
    ].filter((url): url is string => Boolean(url));
    if (!careersUrls.length)
      throw new Error("A verified official careers URL is required.");
    const jobs = new Map<string, CrawledJob>();
    for (const careersUrl of careersUrls) {
      const result = await crawlOfficialCareersSite(careersUrl, this.options);
      for (const job of result.jobs) jobs.set(job.url, job);
    }
    if (isPinpointBoardUrl(context.company.atsBoardUrl)) {
      for (const job of await crawlPinpointBoard(
        context.company.atsBoardUrl!,
        this.options,
      ))
        jobs.set(job.url, job);
    }
    return [...jobs.values()]
      .slice(0, context.maximumJobs ?? 500)
      .map((job) => ({
        sourceType: this.sourceType,
        sourceName: `Official careers · ${context.company.displayName}`,
        externalId: createHash("sha256")
          .update(job.url)
          .digest("hex")
          .slice(0, 24),
        url: job.url,
        company: context.company.displayName,
        title: job.title,
        locationText: job.locationText,
        publishedAt: job.publishedAt,
        raw: job,
      }));
  }

  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    const raw = rawCareerJobSchema.parse(reference.raw);
    return {
      sourceType: this.sourceType,
      sourceName: reference.sourceName,
      externalId: reference.externalId,
      canonicalUrl: raw.url,
      discoveredUrl: reference.url,
      company: reference.company,
      title: raw.title,
      locationText: raw.locationText,
      description: raw.description,
      publishedAt: raw.publishedAt,
      status: "active",
    };
  }

  async verifyJobActive(reference: DiscoveredJobReference): Promise<boolean> {
    return rawCareerJobSchema.safeParse(reference.raw).success;
  }
}
