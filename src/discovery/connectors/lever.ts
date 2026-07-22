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

const leverPostingSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  hostedUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  createdAt: z.number().optional(),
  description: z.string().optional(),
  descriptionPlain: z.string().optional(),
  additional: z.string().optional(),
  categories: z
    .object({
      location: z.string().optional(),
      commitment: z.string().optional(),
      team: z.string().optional(),
      department: z.string().optional(),
      allLocations: z.array(z.string()).optional(),
    })
    .default({}),
});

export class LeverConnector implements JobSourceConnector {
  readonly sourceType = "lever" as const;
  private readonly http: ConnectorHttpClient;
  constructor(options: ConnectorOptions = {}) {
    this.http = new ConnectorHttpClient(options);
  }

  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    const site = assertIdentifier(
      context.company.atsIdentifier ?? "",
      "Lever site identifier",
    );
    const limit = 100;
    const maximum = context.maximumJobs ?? 500;
    const references: DiscoveredJobReference[] = [];
    for (let skip = 0; skip < maximum; skip += limit) {
      const payload = z
        .array(leverPostingSchema)
        .parse(
          await this.http.json(
            `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json&skip=${skip}&limit=${Math.min(limit, maximum - skip)}`,
          ),
        );
      references.push(
        ...payload.map((job) => ({
          sourceType: this.sourceType,
          sourceName: `Lever · ${context.company.name} · ${site}`,
          externalId: job.id,
          url: job.hostedUrl,
          company: context.company.name,
          title: job.text,
          locationText: job.categories.location,
          publishedAt: job.createdAt
            ? new Date(job.createdAt).toISOString()
            : undefined,
          raw: job,
        })),
      );
      if (payload.length < limit) break;
    }
    return references.slice(0, maximum);
  }

  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    const raw = leverPostingSchema.parse(
      reference.raw ?? (await this.http.json(buildApiUrl(reference))),
    );
    return {
      sourceType: this.sourceType,
      sourceName: reference.sourceName,
      externalId: raw.id,
      canonicalUrl: raw.applyUrl ?? raw.hostedUrl,
      discoveredUrl: reference.url,
      company: reference.company,
      title: raw.text,
      locationText: raw.categories.location,
      employmentType: raw.categories.commitment,
      description:
        raw.descriptionPlain?.trim() ||
        htmlToSafeText(
          [raw.description, raw.additional].filter(Boolean).join(" "),
        ),
      publishedAt: raw.createdAt
        ? new Date(raw.createdAt).toISOString()
        : undefined,
    };
  }

  async verifyJobActive(reference: DiscoveredJobReference): Promise<boolean> {
    try {
      leverPostingSchema.parse(await this.http.json(buildApiUrl(reference)));
      return true;
    } catch (error) {
      if (error instanceof Error && /HTTP 404/.test(error.message))
        return false;
      throw error;
    }
  }
}

function buildApiUrl(reference: DiscoveredJobReference): string {
  const site = assertIdentifier(
    reference.sourceName.split(" · ").at(-1) ?? "",
    "Lever site identifier",
  );
  return `https://api.lever.co/v0/postings/${encodeURIComponent(site)}/${encodeURIComponent(reference.externalId)}?mode=json`;
}
