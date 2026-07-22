import { createHash } from "node:crypto";
import { z } from "zod";
import {
  crawlOfficialCareersSite,
  type CareersCrawlerOptions,
} from "../../company/crawler";
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
    if (!context.company.careersUrl)
      throw new Error("A verified official careers URL is required.");
    const result = await crawlOfficialCareersSite(
      context.company.careersUrl,
      this.options,
    );
    return result.jobs.slice(0, context.maximumJobs ?? 500).map((job) => ({
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
