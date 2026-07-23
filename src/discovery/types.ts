import type {
  CandidateProfile,
  HiringSourceClassification,
  JobSourceType,
  TargetCompany,
} from "../domain/schemas";

export type JobDiscoveryContext = {
  profile: CandidateProfile;
  company: TargetCompany;
  maximumJobs?: number;
};

export type DiscoveredJobReference = {
  sourceType: JobSourceType;
  sourceName: string;
  externalId: string;
  url: string;
  company: string;
  title?: string;
  locationText?: string;
  publishedAt?: string;
  raw?: unknown;
};

export type RawJobPosting = {
  sourceType: JobSourceType;
  sourceName: string;
  hiringSourceClassification?: HiringSourceClassification;
  externalId: string;
  canonicalUrl: string;
  discoveredUrl?: string;
  company: string;
  companyDomain?: string;
  title: string;
  locationText?: string;
  workplaceType?: string;
  employmentType?: string;
  description: string;
  publishedAt?: string;
  status?: "active" | "possibly-closed" | "closed" | "verification-failed";
  compensation?: {
    minimum?: number;
    maximum?: number;
    currency?: string;
    period?: "hourly" | "monthly" | "annual";
    sourceText?: string;
  };
};

export interface JobSourceConnector {
  readonly sourceType: JobSourceType;
  discoverJobs(context: JobDiscoveryContext): Promise<DiscoveredJobReference[]>;
  fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting>;
  verifyJobActive?(reference: DiscoveredJobReference): Promise<boolean>;
}

export type WebSearchOptions = { limit?: number; recencyDays?: number };
export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
};

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
}
