import { z } from "zod";
import type {
  DiscoveredJobReference,
  JobDiscoveryContext,
  JobSourceConnector,
  RawJobPosting,
} from "../types";
import { ConnectorHttpClient, type ConnectorOptions } from "./common";
import { isWorkInDenmarkPortal, WorkInDenmarkConnector } from "./workInDenmark";

const YC_JOBS_URL = "https://www.ycombinator.com/jobs";
const SOURCE_NAME = "Y Combinator Jobs · Work at a Startup";

const ycJobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string().min(1),
  url: z.string().min(1),
  applyUrl: z.string().url(),
  location: z.string().optional(),
  type: z.string().optional(),
  visa: z.string().optional(),
  companyName: z.string().min(1),
  companyOneLiner: z.string().optional(),
  description: z.string().optional(),
  skills: z.array(z.string()).optional(),
});
type YcJob = z.infer<typeof ycJobSchema>;

export function isYcJobsPortal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      ["www.ycombinator.com", "ycombinator.com"].includes(
        parsed.hostname.toLowerCase(),
      ) && parsed.pathname.replace(/\/+$/, "") === "/jobs"
    );
  } catch {
    return false;
  }
}

export class YcJobsConnector implements JobSourceConnector {
  readonly sourceType = "official-job-portal" as const;
  private readonly http: ConnectorHttpClient;

  constructor(options: ConnectorOptions = {}) {
    this.http = new ConnectorHttpClient(options);
  }

  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    if (!isYcJobsPortal(context.company.careersUrl))
      throw new Error("YC Jobs requires https://www.ycombinator.com/jobs.");
    const jobs = parsePageJobs(await this.http.html(YC_JOBS_URL));
    return jobs.slice(0, context.maximumJobs ?? 100).map((job) => ({
      sourceType: this.sourceType,
      sourceName: SOURCE_NAME,
      externalId: String(job.id),
      url: toYcUrl(job.url),
      company: job.companyName,
      title: job.title,
      locationText: job.location,
      raw: job,
    }));
  }

  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    const job = parsePageJob(await this.http.html(reference.url));
    const description = [job.description, job.visa ? `Visa: ${job.visa}` : ""]
      .filter(Boolean)
      .join("\n\n");
    return {
      sourceType: this.sourceType,
      sourceName: SOURCE_NAME,
      externalId: String(job.id),
      canonicalUrl: job.applyUrl,
      discoveredUrl: reference.url,
      company: job.companyName,
      title: job.title,
      locationText: job.location,
      workplaceType: /remote/i.test(job.location ?? "") ? "remote" : "unknown",
      employmentType: job.type,
      description:
        description ||
        job.companyOneLiner ||
        "Job details are available through Y Combinator Jobs.",
      status: "active",
    };
  }
}

export class OfficialJobPortalConnector implements JobSourceConnector {
  readonly sourceType = "official-job-portal" as const;
  private readonly yc: YcJobsConnector;
  private readonly workInDenmark: WorkInDenmarkConnector;

  constructor(options: ConnectorOptions = {}) {
    this.yc = new YcJobsConnector(options);
    this.workInDenmark = new WorkInDenmarkConnector(options);
  }

  discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    if (isYcJobsPortal(context.company.careersUrl))
      return this.yc.discoverJobs(context);
    if (isWorkInDenmarkPortal(context.company.careersUrl))
      return this.workInDenmark.discoverJobs(context);
    throw new Error("No supported official job portal is configured.");
  }

  fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    return new URL(reference.url).hostname.endsWith("ycombinator.com")
      ? this.yc.fetchJob(reference)
      : this.workInDenmark.fetchJob(reference);
  }
}

function parsePageJobs(html: string): YcJob[] {
  const page = parsePage(html);
  const value = page.props.jobPostings;
  return z.array(ycJobSchema).parse(value);
}

function parsePageJob(html: string): YcJob {
  const page = parsePage(html);
  return ycJobSchema.parse(page.props.job);
}

function parsePage(html: string): { props: Record<string, unknown> } {
  const encoded = html.match(/\bdata-page="([^"]+)"/i)?.[1];
  if (!encoded)
    throw new Error("YC Jobs page did not include structured job data.");
  const parsed: unknown = JSON.parse(decodeHtmlAttribute(encoded));
  return z.object({ props: z.record(z.unknown()) }).parse(parsed);
}

function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|apos);/gi, (entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "&quot;") return '"';
    if (normalized === "&amp;") return "&";
    if (normalized === "&apos;") return "'";
    const hex = normalized.startsWith("&#x");
    const code = Number.parseInt(
      normalized.slice(hex ? 3 : 2, -1),
      hex ? 16 : 10,
    );
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function toYcUrl(path: string): string {
  return new URL(path, "https://www.ycombinator.com").toString();
}
