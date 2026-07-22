import { targetCompanySchema, type JobSourceType } from "../domain/schemas";
import type {
  DiscoveredJobReference,
  JobDiscoveryContext,
  JobSourceConnector,
  RawJobPosting,
} from "../discovery/types";

const base = "https://fictional.example/jobs";

export const DEMO_COMPANIES = [
  {
    id: "demo-northstar",
    name: "Northstar Labs (Fictional)",
    companyDomain: "fictional.example",
    careersUrl: base,
    countries: ["United Arab Emirates", "Netherlands", "Germany"],
    atsProvider: "greenhouse",
    atsIdentifier: "fictional-northstar",
    sponsorshipEvidence: "possible",
    sponsorshipEvidenceSources: ["Fictional demo fixture"],
    verificationStatus: "monitored",
    sourceRecords: [
      {
        sourceRecordId: "demo-northstar",
        sourceType: "fictional-demo",
        sourceName: "Fictional demo fixture",
        sourceUrl: "https://fictional.example/source",
        sourceRetrievedAt: new Date(0).toISOString(),
      },
    ],
    enabled: true,
  },
  {
    id: "demo-second-source",
    name: "Northstar duplicate feed (Fictional)",
    companyDomain: "fictional.example",
    careersUrl: base,
    countries: ["United Arab Emirates"],
    atsProvider: "lever",
    atsIdentifier: "fictional-duplicate",
    sponsorshipEvidence: "unknown",
    sponsorshipEvidenceSources: [],
    verificationStatus: "monitored",
    sourceRecords: [
      {
        sourceRecordId: "demo-second-source",
        sourceType: "fictional-demo",
        sourceName: "Fictional demo fixture",
        sourceUrl: "https://fictional.example/source",
        sourceRetrievedAt: new Date(0).toISOString(),
      },
    ],
    enabled: true,
  },
  {
    id: "demo-failing-source",
    name: "Unavailable ATS (Fictional)",
    companyDomain: "fictional.example",
    careersUrl: base,
    countries: [],
    atsProvider: "ashby",
    atsIdentifier: "fictional-failure",
    sponsorshipEvidence: "unknown",
    sponsorshipEvidenceSources: [],
    verificationStatus: "monitored",
    sourceRecords: [
      {
        sourceRecordId: "demo-failing-source",
        sourceType: "fictional-demo",
        sourceName: "Fictional demo fixture",
        sourceUrl: "https://fictional.example/source",
        sourceRetrievedAt: new Date(0).toISOString(),
      },
    ],
    enabled: true,
  },
].map((company) => targetCompanySchema.parse(company));

const jobs: RawJobPosting[] = [
  job(
    "react-strong",
    "Senior React TypeScript Engineer",
    "Dubai, United Arab Emirates",
    "Build customer-facing React and TypeScript products. Lead frontend architecture, testing with Playwright, REST APIs, and mentoring. English required.",
    {
      minimum: 25000,
      maximum: 30000,
      currency: "AED",
      period: "monthly",
      sourceText: "AED 25,000–30,000 monthly",
    },
  ),
  job(
    "backend-stretch",
    "Full-Stack TypeScript Engineer",
    "Dubai, United Arab Emirates",
    "Own backend-heavy TypeScript services using Node.js, PostgreSQL, AWS, Docker, and REST. Some React product work is included.",
  ),
  job(
    "no-sponsor",
    "Senior React Engineer",
    "Amsterdam, Netherlands",
    "Build React and TypeScript interfaces. Candidates must already have unrestricted right to work in the Netherlands. Visa sponsorship is not available.",
  ),
  job(
    "sponsor-unknown",
    "Product Engineer",
    "Berlin, Germany",
    "Develop customer products with TypeScript, React, Node.js, and PostgreSQL. English is required. The posting contains no immigration information.",
  ),
  job(
    "salary-undisclosed",
    "AI Product Engineer",
    "Dubai, United Arab Emirates",
    "Create TypeScript and React experiences powered by LLM and Ollama services. Salary is discussed during interviews.",
  ),
  {
    ...job(
      "closed",
      "Senior TypeScript Engineer",
      "Dubai, United Arab Emirates",
      "Previously open TypeScript and React role using Next.js and Jest.",
    ),
    status: "closed",
  },
  job(
    "suspicious",
    "Frontend-led Full-Stack Engineer",
    "Remote, United Arab Emirates",
    "Use React and TypeScript. Contact us on Telegram only and purchase your own equipment with cryptocurrency before onboarding.",
  ),
  job(
    "remote-no-salary",
    "Hands-on Technical Lead",
    "Remote, United Arab Emirates",
    "Lead a product engineering team using React, TypeScript, Node.js, and AWS. Remote role with no compensation range disclosed.",
  ),
];

export class DemoFixtureConnector implements JobSourceConnector {
  constructor(
    public readonly sourceType: JobSourceType,
    private readonly postings: RawJobPosting[],
    private readonly shouldFail = false,
  ) {}
  async discoverJobs(
    context: JobDiscoveryContext,
  ): Promise<DiscoveredJobReference[]> {
    if (this.shouldFail)
      throw new Error(
        "Fictional connector failure for error-isolation demonstration.",
      );
    return this.postings.map((posting) => ({
      sourceType: this.sourceType,
      sourceName: `${this.sourceType} · fictional fixture`,
      externalId: posting.externalId,
      url: posting.canonicalUrl,
      company: context.company.name,
      title: posting.title,
      locationText: posting.locationText,
      publishedAt: posting.publishedAt,
      raw: { ...posting, company: context.company.name },
    }));
  }
  async fetchJob(reference: DiscoveredJobReference): Promise<RawJobPosting> {
    return reference.raw as RawJobPosting;
  }
}

export function createDemoConnectors(): Partial<
  Record<JobSourceType, JobSourceConnector>
> {
  const duplicate = {
    ...jobs[0],
    sourceType: "lever" as const,
    sourceName: "lever · fictional duplicate fixture",
  };
  return {
    greenhouse: new DemoFixtureConnector("greenhouse", jobs),
    lever: new DemoFixtureConnector("lever", [duplicate]),
    ashby: new DemoFixtureConnector("ashby", [], true),
  };
}

function job(
  id: string,
  title: string,
  locationText: string,
  description: string,
  compensation?: RawJobPosting["compensation"],
): RawJobPosting {
  return {
    sourceType: "greenhouse",
    sourceName: "greenhouse · fictional fixture",
    externalId: id,
    canonicalUrl: `${base}/${id}`,
    company: "Northstar Labs (Fictional)",
    title,
    locationText,
    workplaceType: locationText.startsWith("Remote") ? "remote" : "hybrid",
    description,
    publishedAt: new Date().toISOString(),
    compensation,
  };
}
