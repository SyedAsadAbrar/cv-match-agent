import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { cvProfileSchema } from "../src/ai/schemas";
import { transitionApplication } from "../src/applications/tracking";
import { migrateDatabase } from "../src/db/database";
import { JobCopilotStore } from "../src/db/store";
import type { TargetCompany } from "../src/domain/schemas";
import { runDiscovery } from "../src/discovery/pipeline";
import type { JobSourceConnector } from "../src/discovery/types";
import { convertCvProfile } from "../src/services/discoveryProfile";

test("integration: extracted CV profile is converted and saved with source claims", () => {
  const store = memoryStore();
  const extracted = convertCvProfile(
    cvProfileSchema.parse({
      summary: "Senior frontend engineer building TypeScript products.",
      skills: ["React", "TypeScript"],
      industries: [],
      companies: ["Example"],
      workExperience: [
        {
          company: "Example",
          role: "Senior Engineer",
          responsibilities: ["Built React products"],
          technologies: ["React"],
          achievements: ["Improved performance"],
        },
      ],
      education: [],
      projects: [],
      achievements: [],
    }),
    store.getProfile(),
  );
  store.saveProfile(extracted.profile, extracted.sourceClaims);
  assert.equal(store.getProfile().skills[0].name, "React");
  assert.ok(store.getProfileClaims("local-user").includes("summary"));
  store.close();
});

test("integration: discovery run with mocked source imports and evaluates a job", async () => {
  const store = memoryStore();
  const run = await discover(store);
  assert.equal(run.jobsImported, 1);
  assert.ok(store.listRankedJobs()[0].match);
  store.close();
});

test("integration: imported job appears in deterministic ranked feed", async () => {
  const store = memoryStore();
  await discover(store);
  const dashboardFeed = store.listRankedJobs();
  assert.equal(dashboardFeed.length, 1);
  assert.equal(dashboardFeed[0].job.title, "Senior React Engineer");
  assert.equal(typeof dashboardFeed[0].match?.score, "number");
  store.close();
});

test("integration: resetting jobs preserves the candidate profile", async () => {
  const store = memoryStore();
  const profile = store.getProfile();
  await discover(store);

  const result = store.resetJobData();

  assert.equal(result.jobsRemoved, 1);
  assert.equal(store.listRankedJobs().length, 0);
  assert.equal(store.getLatestDiscoveryRun(), undefined);
  assert.equal(store.getProfile().id, profile.id);
  store.close();
});

test("integration: job can be saved and then marked as manually applied", async () => {
  const store = memoryStore();
  await discover(store);
  const job = store.listRankedJobs()[0];
  store.setSaved(job.job.id, true);
  store.saveApplication(
    transitionApplication(
      undefined,
      job.job.id,
      "applied",
      job.job.canonicalUrl,
    ),
  );
  const updated = store.getRankedJob(job.job.id);
  assert.equal(updated?.saved, true);
  assert.equal(updated?.application?.status, "applied");
  store.close();
});

test("integration: rerunning discovery consolidates rather than duplicates a job", async () => {
  const store = memoryStore();
  await discover(store);
  const rerun = await discover(store);
  assert.equal(rerun.duplicatesFound, 1);
  assert.equal(store.listRankedJobs().length, 1);
  store.close();
});

async function discover(store: JobCopilotStore) {
  return runDiscovery({
    store,
    companies: [company],
    connectors: { greenhouse: connector },
    analyse: false,
    verify: false,
  });
}

const company: TargetCompany = {
  id: "fixture-company",
  name: "Fixture Co",
  companyDomain: "example.com",
  countries: ["United Arab Emirates"],
  atsProvider: "greenhouse",
  atsIdentifier: "fixture",
  sponsorshipEvidence: "unknown",
  sponsorshipEvidenceSources: [],
  enabled: true,
};

const connector: JobSourceConnector = {
  sourceType: "greenhouse",
  async discoverJobs() {
    return [
      {
        sourceType: "greenhouse",
        sourceName: "fixture",
        externalId: "role-1",
        url: "https://example.com/jobs/role-1",
        company: "Fixture Co",
      },
    ];
  },
  async fetchJob(reference) {
    return {
      sourceType: "greenhouse",
      sourceName: "fixture",
      externalId: reference.externalId,
      canonicalUrl: reference.url,
      company: "Fixture Co",
      title: "Senior React Engineer",
      locationText: "Dubai, United Arab Emirates",
      description:
        "Build React and TypeScript product experiences. English required.",
    };
  },
};

function memoryStore(): JobCopilotStore {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return new JobCopilotStore(database);
}
