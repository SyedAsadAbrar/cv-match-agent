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

const greenhouseJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().min(1),
  location: z.object({ name: z.string().optional() }).optional(),
  absolute_url: z.string().url(),
  content: z.string().optional(),
  first_published: z.string().optional(),
  updated_at: z.string().optional(),
  company_name: z.string().optional(),
});
const greenhouseListSchema = z.object({
  jobs: z.array(greenhouseJobSchema),
  meta: z.object({ total: z.number().optional() }).optional(),
});

export class GreenhouseConnector implements JobSourceConnector {
  readonly sourceType = "greenhouse" as const;
  private readonly http: ConnectorHttpClient;

  constructor(options: ConnectorOptions = {}) {
    this.http = new ConnectorHttpClient(options);
  }

  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    const token = assertIdentifier(
      context.company.atsIdentifier ?? "",
      "Greenhouse board token",
    );
    const payload = greenhouseListSchema.parse(
      await this.http.json(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
      ),
    );
    return payload.jobs.slice(0, context.maximumJobs ?? 500).map((job) => ({
      sourceType: this.sourceType,
      sourceName: `Greenhouse · ${context.company.name} · ${token}`,
      externalId: String(job.id),
      url: job.absolute_url,
      company: context.company.name,
      title: job.title,
      locationText: job.location?.name,
      publishedAt: job.first_published ?? job.updated_at,
      raw: job,
    }));
  }

  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    const raw = greenhouseJobSchema.parse(
      reference.raw ?? (await this.http.json(buildApiUrl(reference))),
    );
    return {
      sourceType: this.sourceType,
      sourceName: reference.sourceName,
      externalId: String(raw.id),
      canonicalUrl: raw.absolute_url,
      discoveredUrl: reference.url,
      company: raw.company_name ?? reference.company,
      title: raw.title,
      locationText: raw.location?.name,
      description: htmlToSafeText(
        raw.content ??
          "Job details are available on the official application page.",
      ),
      publishedAt: raw.first_published ?? raw.updated_at,
    };
  }

  async verifyJobActive(reference: DiscoveredJobReference): Promise<boolean> {
    try {
      greenhouseJobSchema.parse(await this.http.json(buildApiUrl(reference)));
      return true;
    } catch (error) {
      if (error instanceof Error && /HTTP 404/.test(error.message))
        return false;
      throw error;
    }
  }
}

function buildApiUrl(reference: DiscoveredJobReference): string {
  const token = assertIdentifier(
    reference.sourceName.split(" · ").at(-1) ?? "",
    "Greenhouse board token",
  );
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(reference.externalId)}`;
}
