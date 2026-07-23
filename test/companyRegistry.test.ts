import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import Database from "better-sqlite3";
import {
  auditCompanyRegistry,
  enableVerifiedCompanies,
  exportUnresolvedCompanies,
  generateCompanyRegistryStats,
  importCompanyResolutions,
  importCompanySourceRecords,
  parseIndSponsorRegisterHtml,
  recordCompanySourceDetection,
  selectSupportedCareerHandoff,
  verifyCompanySource,
} from "../src/company/registry";
import {
  crawlOfficialCareersSite,
  extractJsonLdJobs,
  extractSitemapUrls,
  parseRobotsPolicy,
} from "../src/company/crawler";
import { crawlPinpointBoard } from "../src/discovery/connectors/pinpoint";
import { compareCompanies } from "../src/company/deduplicate";
import {
  detectCareerSource,
  detectCareerSourcesFromPage,
  findCareerLink,
} from "../src/company/detection";
import {
  normaliseCompanyName,
  normaliseDomain,
} from "../src/company/normalise";
import { migrateDatabase } from "../src/db/database";
import { JobCopilotStore } from "../src/db/store";
import {
  companyRelationshipSchema,
  companySourceRecordSchema,
  targetCompanySchema,
  type CompanySourceRecord,
  type TargetCompany,
} from "../src/domain/schemas";
import type { JobSourceConnector } from "../src/discovery/types";
import { runDiscovery } from "../src/discovery/pipeline";

const publicLookup = async () => ["203.0.113.10"];

test("company source records require provenance", () => {
  assert.throws(
    () =>
      companySourceRecordSchema.parse({
        sourceRecordId: "one",
        legalName: "Example B.V.",
        aliases: [],
        sourceType: "official-company-page",
        sourceName: "Missing URL",
        sourceRetrievedAt: new Date().toISOString(),
        country: "Netherlands",
        cities: [],
        industries: [],
      }),
    /sourceUrl/,
  );
  assert.equal(
    companySourceRecordSchema.parse(sourceRecord()).sourceName,
    "Fixture source",
  );
});

test("company name normalisation removes legal suffixes without fuzzy merging", () => {
  assert.equal(
    normaliseCompanyName("Example Technologies B.V."),
    "example technologies",
  );
  assert.notEqual(
    normaliseCompanyName("Example Tech"),
    normaliseCompanyName("Example Technologies"),
  );
});

test("aliases match conservatively while similar companies remain separate", () => {
  const left = company({ aliases: ["Example Cloud"] });
  const aliasMatch = company({
    id: "two",
    legalName: "Example Cloud",
    displayName: "Example Cloud",
  });
  const separate = company({
    id: "three",
    legalName: "Example Cloud Services",
    displayName: "Example Cloud Services",
    companyDomain: "example-services.com",
    websiteUrl: "https://example-services.com/",
    careersUrl: "https://example-services.com/careers",
  });
  assert.ok(compareCompanies(left, aliasMatch));
  assert.equal(compareCompanies(left, separate), undefined);
});

test("parent and subsidiary relationships are explicit", () => {
  assert.equal(
    companyRelationshipSchema.parse({
      parentCompanyId: "parent",
      subsidiaryCompanyId: "child",
      relationship: "subsidiary",
    }).relationship,
    "subsidiary",
  );
});

test("domain validation accepts public hostnames and rejects malformed values", () => {
  assert.equal(normaliseDomain("https://www.example.com/jobs"), "example.com");
  assert.throws(() => normaliseDomain("localhost"), /Invalid public/);
});

test("careers links and supported ATS identifiers are detected from official URLs", () => {
  assert.equal(
    findCareerLink(
      "https://example.com",
      '<a href="/about">About</a><a href="/careers">Join us</a>',
    ),
    "https://example.com/careers",
  );
  assert.deepEqual(detectCareerSource("https://jobs.lever.co/example"), {
    provider: "lever",
    identifier: "example",
    sourceUrl: "https://jobs.lever.co/example",
    confidence: "medium",
    evidence: ["Recognised lever hostname."],
    ingestible: true,
  });
  assert.equal(
    detectCareerSource("https://example.wd3.myworkdayjobs.com/jobs")
      ?.ingestible,
    false,
  );
});

test("official careers pages detect supported and detection-only ATS handoffs", () => {
  const page = [
    '<a href="https://boards.eu.greenhouse.io/example">Greenhouse roles</a>',
    '<a href="https://jobs.eu.lever.co/example-emea">Lever EMEA</a>',
    '<a href="https://jobs.ashbyhq.com/example">Ashby jobs</a>',
    '<a href="https://example.wd3.myworkdayjobs.com/jobs">Workday careers</a>',
    '<a href="https://unrelated.example/jobs">Unrelated board</a>',
  ].join("");
  const detected = detectCareerSourcesFromPage(
    "https://example.com/careers",
    page,
  );
  assert.deepEqual(
    detected.map((item) => item.provider),
    ["greenhouse", "lever", "ashby", "workday"],
  );
  assert.ok(detected.every((item) => item.confidence === "high"));
  assert.equal(
    detected.find((item) => item.provider === "workday")?.ingestible,
    false,
  );
  assert.ok(
    detected.every((item) =>
      item.evidence.some((entry) => entry.includes("Link text")),
    ),
  );
});

test("lookalike and unrelated external links are not accepted as ATS sources", () => {
  const detected = detectCareerSourcesFromPage(
    "https://example.com/careers",
    [
      '<a href="https://boards.greenhouse.io.example.net/example">Lookalike</a>',
      '<a href="https://careers.unrelated.example/jobs">Unrelated</a>',
    ].join(""),
  );
  assert.deepEqual(detected, []);
});

test("multiple supported ATS handoffs are retained but never auto-selected", () => {
  const detections = detectCareerSourcesFromPage(
    "https://example.com/careers",
    [
      '<a href="https://jobs.ashbyhq.com/example">Primary jobs</a>',
      '<a href="https://jobs.lever.co/example-emea">EMEA jobs</a>',
    ].join(""),
  );
  const selection = selectSupportedCareerHandoff(detections);
  assert.equal(selection.handoff, undefined);
  assert.equal(selection.ambiguous?.length, 2);

  const persisted = recordCompanySourceDetection(company(), {
    detection: detections[0],
    detections,
    evidence: detections.flatMap((item) => item.evidence),
    checkedAt: "2026-07-23T00:00:00.000Z",
  });
  assert.equal(persisted.sourceDetections.length, 2);
  assert.equal(
    persisted.sourceDetections[0]?.evidence.some((entry) =>
      entry.startsWith("Link text:"),
    ),
    true,
  );
  assert.equal(persisted.sourceDetectionCheckedAt, "2026-07-23T00:00:00.000Z");
});

test("JSON-LD and sitemap extraction preserve official job URLs", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "Senior Engineer",
    description: "Build safe products.",
    url: "https://example.com/jobs/one",
    datePosted: "2026-07-20",
  })}</script>`;
  assert.equal(
    extractJsonLdJobs("https://example.com/careers", html)[0].title,
    "Senior Engineer",
  );
  assert.deepEqual(
    extractSitemapUrls(
      "<urlset><url><loc>https://example.com/jobs/one?a=1&amp;b=2</loc></url></urlset>",
    ),
    ["https://example.com/jobs/one?a=1&b=2"],
  );
  assert.deepEqual(
    parseRobotsPolicy(
      "User-agent: *\nDisallow: /private\nSitemap: https://example.com/jobs.xml",
    ),
    {
      sitemaps: ["https://example.com/jobs.xml"],
      disallowedPaths: ["/private"],
    },
  );
});

test("generic crawler enforces depth and page-count limits", async () => {
  const pages: Record<string, string> = {
    "https://example.com/careers":
      '<a href="/careers/jobs/one">One</a><a href="/careers/jobs/two">Two</a>',
    "https://example.com/careers/jobs/one":
      "<h1>Engineer One</h1><p>Build products with TypeScript and React for customers.</p>",
    "https://example.com/careers/jobs/two":
      "<h1>Engineer Two</h1><p>Build products with TypeScript and React for customers.</p>",
  };
  const result = await crawlOfficialCareersSite("https://example.com/careers", {
    maxDepth: 1,
    maxPages: 2,
    lookup: publicLookup,
    retries: 0,
    fetchImpl: async (input) =>
      new Response(pages[String(input)] ?? "not found", {
        status: pages[String(input)] ? 200 : 404,
        headers: { "Content-Type": "text/html" },
      }),
  });
  assert.equal(result.pagesVisited, 2);
  assert.equal(result.jobs.length, 1);
});

test("generic crawler canonicalises tracking parameters before crawling", async () => {
  const pages: Record<string, string> = {
    "https://example.com/careers":
      '<a href="/careers/jobs/one?utm_source=newsletter">One</a><a href="/careers/jobs/one?fbclid=tracking">Duplicate</a>',
    "https://example.com/careers/jobs/one":
      "<h1>Engineer</h1><p>Build products with TypeScript and React for customers.</p>",
  };
  const result = await crawlOfficialCareersSite("https://example.com/careers", {
    maxDepth: 1,
    maxPages: 2,
    lookup: publicLookup,
    retries: 0,
    fetchImpl: async (input) =>
      new Response(pages[String(input)] ?? "not found", {
        status: pages[String(input)] ? 200 : 404,
        headers: { "Content-Type": "text/html" },
      }),
  });
  assert.equal(result.pagesVisited, 2);
  assert.equal(result.jobs[0]?.url, "https://example.com/careers/jobs/one");
});

test("generic crawler rejects careers listing metadata as a job", async () => {
  const result = await crawlOfficialCareersSite("https://example.com/careers", {
    maxPages: 1,
    lookup: publicLookup,
    retries: 0,
    fetchImpl: async () =>
      new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Open positions at Example",
          description: "Browse the current jobs at Example.",
          url: "https://example.com/careers",
        })}</script>`,
        { headers: { "Content-Type": "text/html" } },
      ),
  });
  assert.deepEqual(result.jobs, []);
});

test("Pinpoint board crawler maps individual public job records", async () => {
  const jobs = await crawlPinpointBoard(
    "https://indrive.pinpointhq.com/en/postings/",
    {
      lookup: publicLookup,
      retries: 0,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "42",
                title: "Platform Engineer",
                url: "https://indrive.pinpointhq.com/en/postings/42",
                description: "Build reliable systems.",
                key_responsibilities: "Own production services.",
                skills_knowledge_expertise: "TypeScript and Kubernetes.",
                employment_type_text: "Full Time",
                workplace_type_text: "Hybrid",
                location: { city: "Dubai", name: "United Arab Emirates" },
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    },
  );
  assert.deepEqual(jobs, [
    {
      title: "Platform Engineer",
      url: "https://indrive.pinpointhq.com/en/postings/42",
      description:
        "Build reliable systems. Own production services. TypeScript and Kubernetes. Full Time Hybrid",
      locationText: "Dubai, United Arab Emirates",
    },
  ]);
});

test("generic crawler detects a validated redirect from an official page to an ATS", async () => {
  const result = await crawlOfficialCareersSite("https://example.com/careers", {
    maxPages: 1,
    retries: 0,
    lookup: publicLookup,
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt"))
        return new Response("", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
      if (url.includes("example.com"))
        return new Response(null, {
          status: 302,
          headers: { location: "https://jobs.lever.co/example" },
        });
      return new Response("<html><title>Example careers</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });
  assert.equal(result.detectedSources[0]?.provider, "lever");
  assert.equal(result.detectedSources[0]?.confidence, "high");
  assert.match(
    result.detectedSources[0]?.evidence.join(" ") ?? "",
    /redirect/i,
  );
});

test("IND register parser preserves legal name, KvK identity, and sponsor provenance", () => {
  const html = `<p>Last updated on 1 July 2026</p><table><tr><th>Organisation</th><th>KvK</th></tr><tr><th scope="row">Example Tech B.V.</th><td>12345678</td></tr></table>`;
  const records = parseIndSponsorRegisterHtml(html, "2026-07-23T00:00:00.000Z");
  assert.equal(records[0].sourceRecordId, "kvk-12345678");
  assert.equal(records[0].sponsorshipEvidence?.level, "confirmed-register");
});

test("company imports are idempotent and preserve stronger sponsorship evidence", async () => {
  const store = memoryStore();
  const first = sourceRecord();
  const second = {
    ...first,
    sourceRecordId: "permit-2",
    sourceName: "Second source",
    sourceUrl: "https://government.example/permits",
    sponsorshipEvidence: {
      level: "possible" as const,
      countries: ["Netherlands"],
      sourceUrls: ["https://government.example/permits"],
    },
  };
  await importCompanySourceRecords(store, [first]);
  await importCompanySourceRecords(store, [first, second]);
  assert.equal(store.listCompanies().length, 1);
  assert.equal(store.listCompanies()[0].sponsorshipEvidence, "confirmed");
  assert.equal(store.listCompanyImportRuns().length, 3);
  assert.equal(
    (
      store.database
        .prepare("SELECT COUNT(*) AS count FROM company_source_observations")
        .get() as { count: number }
    ).count,
    2,
  );
  store.close();
});

test("unverified companies cannot be enabled", () => {
  const store = memoryStore();
  assert.throws(
    () =>
      store.saveCompany(
        company({ verificationStatus: "candidate", enabled: true }),
      ),
    /source-verified/,
  );
  store.close();
});

test("ATS verification promotes a disabled company to source-verified", async () => {
  const store = memoryStore();
  const candidate = company({
    atsProvider: "greenhouse",
    atsIdentifier: "fixture",
    verificationStatus: "careers-page-found",
  });
  store.saveCompany(candidate);
  const connector: JobSourceConnector = {
    sourceType: "greenhouse",
    async discoverJobs() {
      return [
        {
          sourceType: "greenhouse",
          sourceName: "Greenhouse · Example Technology",
          externalId: "job-1",
          url: "https://boards.greenhouse.io/fixture/jobs/1",
          company: "Example Technology",
          title: "Engineer",
        },
      ];
    },
    async fetchJob() {
      throw new Error("unused");
    },
  };
  const verified = await verifyCompanySource(store, candidate, {
    greenhouse: connector,
  });
  assert.equal(verified.verificationStatus, "source-verified");
  assert.equal(store.listCompanyVerificationRuns()[0].status, "completed");
  assert.equal(store.listCompanyVerificationRuns()[0].payload.jobsParsed, 1);
  store.close();
});

test("valid empty ATS sources are promoted to source-verified", async () => {
  const store = memoryStore();
  const candidate = company({
    atsProvider: "greenhouse",
    atsIdentifier: "fixture",
    verificationStatus: "careers-page-found",
  });
  store.saveCompany(candidate);
  const connector: JobSourceConnector = {
    sourceType: "greenhouse",
    async discoverJobs() {
      return [];
    },
    async fetchJob() {
      throw new Error("unused");
    },
  };
  const verified = await verifyCompanySource(store, candidate, {
    greenhouse: connector,
  });
  assert.equal(verified.verificationStatus, "source-verified");
  assert.equal(verified.boardState, "active-empty");
  assert.equal(store.listCompanies()[0].enabled, false);
  assert.equal(store.listCompanyVerificationRuns()[0].status, "completed");
  store.close();
});

test("invalid ATS identifiers fail verification without enabling the source", async () => {
  const store = memoryStore();
  const candidate = company({
    atsProvider: "greenhouse",
    atsIdentifier: "bad/value",
    verificationStatus: "careers-page-found",
  });
  store.saveCompany(candidate);
  const invalid = await verifyCompanySource(store, candidate);
  assert.equal(invalid.boardState, "invalid");
  assert.equal(invalid.verificationStatus, "careers-page-found");
  assert.equal(invalid.enabled, false);
  assert.equal(store.listCompanyVerificationRuns()[0].status, "failed");
  store.close();
});

test("wrong-company ATS boards are rejected with explicit evidence", async () => {
  const store = memoryStore();
  const candidate = company({
    atsProvider: "greenhouse",
    atsIdentifier: "other",
    verificationStatus: "careers-page-found",
  });
  store.saveCompany(candidate);
  const connector: JobSourceConnector = {
    sourceType: "greenhouse",
    async discoverJobs() {
      return [
        {
          sourceType: "greenhouse",
          sourceName: "Greenhouse · Other Company",
          externalId: "job-1",
          url: "https://boards.greenhouse.io/other/jobs/1",
          company: "Other Company",
          raw: { company_name: "Other Company" },
        },
      ];
    },
    async fetchJob() {
      throw new Error("unused");
    },
  };
  const result = await verifyCompanySource(store, candidate, {
    greenhouse: connector,
  });
  assert.equal(result.boardState, "wrong-company");
  assert.equal(result.enabled, false);
  assert.match(result.verificationError ?? "", /another company/);
  store.close();
});

test("temporary and blocked failures are not treated as invalid identifiers", async () => {
  for (const [message, expected] of [
    ["Request timed out after 15000ms.", "temporarily-unavailable"],
    ["HTTP 429 from boards-api.greenhouse.io.", "temporarily-unavailable"],
    ["CAPTCHA: verify you are human.", "blocked"],
  ] as const) {
    const store = memoryStore();
    const candidate = company({
      atsProvider: "greenhouse",
      atsIdentifier: "fixture",
      verificationStatus: "careers-page-found",
    });
    store.saveCompany(candidate);
    const connector: JobSourceConnector = {
      sourceType: "greenhouse",
      async discoverJobs() {
        throw new Error(message);
      },
      async fetchJob() {
        throw new Error("unused");
      },
    };
    const result = await verifyCompanySource(store, candidate, {
      greenhouse: connector,
    });
    assert.equal(result.boardState, expected);
    assert.equal(result.enabled, false);
    if (expected === "temporarily-unavailable")
      assert.ok(result.nextVerificationAt);
    store.close();
  }
});

test("detection-only ATS providers are reported as unsupported", async () => {
  const store = memoryStore();
  const candidate = company({
    atsProvider: "workday",
    atsIdentifier: "example",
    careersUrl: "https://example.wd3.myworkdayjobs.com/jobs",
  });
  store.saveCompany(candidate);
  const result = await verifyCompanySource(store, candidate);
  assert.equal(result.boardState, "unsupported");
  assert.equal(result.enabled, false);
  store.close();
});

test("active-empty verified sources can be bulk enabled and disabled safely", async () => {
  const store = memoryStore();
  const candidate = company({
    atsProvider: "greenhouse",
    atsIdentifier: "fixture",
  });
  store.saveCompany(candidate);
  const connector: JobSourceConnector = {
    sourceType: "greenhouse",
    async discoverJobs() {
      return [];
    },
    async fetchJob() {
      throw new Error("unused");
    },
  };
  await verifyCompanySource(store, candidate, { greenhouse: connector });
  const dryRun = enableVerifiedCompanies(store, { dryRun: true });
  assert.equal(dryRun.planned.length, 1);
  assert.equal(store.listCompanies()[0].enabled, false);
  const enabled = enableVerifiedCompanies(store);
  assert.equal(enabled.changed.length, 1);
  const monitored = store.listCompanies()[0];
  assert.equal(monitored.verificationStatus, "monitored");
  assert.equal(monitored.enabled, true);
  const disabled = store.saveCompany({ ...monitored, enabled: false });
  assert.equal(disabled.verificationStatus, "source-verified");
  store.close();
});

test("bulk enable never affects unverified or invalid sources", () => {
  const store = memoryStore();
  store.saveCompany(
    company({ id: "candidate", verificationStatus: "candidate" }),
  );
  store.saveCompany(
    company({
      id: "invalid",
      verificationStatus: "careers-page-found",
      boardState: "invalid",
    }),
  );
  const result = enableVerifiedCompanies(store);
  assert.equal(result.changed.length, 0);
  assert.ok(store.listCompanies().every((item) => !item.enabled));
  store.close();
});

test("manual resolution CSV round-trips unresolved companies", () => {
  const store = memoryStore();
  store.saveCompany(
    company({ companyDomain: undefined, websiteUrl: undefined }),
  );
  const exported = exportUnresolvedCompanies(store);
  const reviewed = exported.replace(
    ",,,,,,",
    ",example.com,https://example.com/careers,custom,,https://example.com/about,",
  );
  const result = importCompanyResolutions(store, reviewed);
  assert.equal(result.errors.length, 0);
  assert.equal(
    store.listCompanies()[0].verificationStatus,
    "careers-page-found",
  );
  store.close();
});

test("registry audit and statistics distinguish candidates from monitored sources", () => {
  const store = memoryStore();
  store.saveCompany(
    company({ verificationStatus: "candidate", companyDomain: undefined }),
  );
  store.saveCompany(
    company({ id: "verified", verificationStatus: "source-verified" }),
  );
  const stats = generateCompanyRegistryStats(store);
  assert.equal(stats.totalCompanies, 2);
  assert.equal(stats.byStatus.candidate, 1);
  assert.equal(stats.byStatus["source-verified"], 1);
  assert.ok(
    auditCompanyRegistry(store).warnings.some((warning) =>
      warning.includes("unresolved"),
    ),
  );
  store.close();
});

test("company table pagination is server bounded", () => {
  const store = memoryStore();
  for (let index = 0; index < 31; index += 1)
    store.saveCompany(
      company({
        id: `company-${index}`,
        legalName: `Company ${index}`,
        displayName: `Company ${index}`,
      }),
    );
  const page = store.listCompaniesPage({ page: 2, pageSize: 25 });
  assert.equal(page.total, 31);
  assert.equal(page.items.length, 6);
  assert.equal(store.listCompaniesPage({ search: "example.com" }).total, 31);
  assert.equal(
    store.listCompaniesPage({ engineeringRelevance: "unknown" }).total,
    31,
  );
  store.close();
});

test("jobs missing from three successful company snapshots become possibly closed", () => {
  const store = memoryStore();
  const fixtureCompany = company({
    verificationStatus: "source-verified",
  });
  store.saveCompany(fixtureCompany);
  const now = "2026-07-23T00:00:00.000Z";
  const imported = store.importJob({
    id: "job-one",
    sourceType: "company-careers",
    sourceName: "Official careers · Example Technology",
    externalId: "one",
    canonicalUrl: "https://example.com/jobs/one",
    discoveredUrl: "https://example.com/jobs/one",
    company: fixtureCompany.displayName,
    title: "Senior Engineer",
    description: "Build reliable software products for customers.",
    requiredSkills: [],
    preferredSkills: [],
    responsibilities: [],
    benefits: [],
    workplaceType: "unknown",
    relocationEvidence: [],
    sponsorshipEvidence: [],
    languageRequirements: [],
    workAuthorization: {
      sponsorshipMentioned: false,
      relocationMentioned: false,
      restrictions: [],
      evidenceText: [],
    },
    status: "active",
    firstSeenAt: now,
    lastSeenAt: now,
    rawContentHash: "snapshot-hash",
  });
  store.recordSuccessfulCompanyJobSnapshot(fixtureCompany.id, [imported.jobId]);
  store.recordSuccessfulCompanyJobSnapshot(fixtureCompany.id, []);
  store.recordSuccessfulCompanyJobSnapshot(fixtureCompany.id, []);
  assert.equal(store.getRankedJob(imported.jobId)?.job.status, "active");
  store.recordSuccessfulCompanyJobSnapshot(fixtureCompany.id, []);
  assert.equal(
    store.getRankedJob(imported.jobId)?.job.status,
    "possibly-closed",
  );
  store.close();
});

test("verified generic careers sources do not require a fabricated ATS identifier", async () => {
  const store = memoryStore();
  const genericCompany = company({
    atsProvider: "custom",
    atsIdentifier: undefined,
    verificationStatus: "source-verified",
    enabled: true,
  });
  store.saveCompany(genericCompany);
  const connector: JobSourceConnector = {
    sourceType: "company-careers",
    async discoverJobs() {
      return [];
    },
    async fetchJob() {
      throw new Error("unused");
    },
  };
  const run = await runDiscovery({
    store,
    companies: [genericCompany],
    connectors: { "company-careers": connector },
    analyse: false,
  });
  assert.equal(run.status, "completed");
  assert.equal(run.sourcesChecked, 1);
  store.close();
});

test("company onboarding skill scripts reject invalid arguments deterministically", () => {
  const result = spawnSync(
    "bash",
    [
      ".agents/skills/company-source-onboarding/scripts/import-company-source.sh",
      "--unsupported",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unsupported argument/);
});

function sourceRecord(): CompanySourceRecord {
  return companySourceRecordSchema.parse({
    sourceRecordId: "kvk-12345678",
    legalName: "Example Technology B.V.",
    displayName: "Example Technology",
    aliases: ["Example Tech"],
    sourceType: "official-sponsor-register",
    sourceName: "Fixture source",
    sourceUrl: "https://government.example/register",
    sourceRetrievedAt: "2026-07-23T00:00:00.000Z",
    country: "Netherlands",
    cities: ["Amsterdam"],
    industries: ["enterprise software"],
    sponsorshipEvidence: {
      level: "confirmed-register",
      countries: ["Netherlands"],
      sourceUrls: ["https://government.example/register"],
    },
  });
}

function company(overrides: Record<string, unknown> = {}): TargetCompany {
  return targetCompanySchema.parse({
    id: "one",
    name: "Example Technology",
    legalName: "Example Technology B.V.",
    displayName: "Example Technology",
    companyDomain: "example.com",
    websiteUrl: "https://example.com/",
    careersUrl: "https://example.com/careers",
    countries: ["Netherlands"],
    operatingCountries: ["Netherlands"],
    hiringCountries: ["Netherlands"],
    industries: ["enterprise software"],
    sourceType: "official-company-page",
    sourceRecords: [
      {
        sourceRecordId: "one",
        sourceType: "official-company-page",
        sourceName: "Fixture",
        sourceUrl: "https://example.com/about",
        sourceRetrievedAt: "2026-07-23T00:00:00.000Z",
      },
    ],
    sponsorshipEvidence: "unknown",
    sponsorshipEvidenceSources: [],
    verificationStatus: "careers-page-found",
    enabled: false,
    discoveredAt: "2026-07-23T00:00:00.000Z",
    ...overrides,
  });
}

function memoryStore(): JobCopilotStore {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return new JobCopilotStore(database);
}
