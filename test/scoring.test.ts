import assert from "node:assert/strict";
import test from "node:test";
import type { JobRequirements, MatchAnalysis } from "../src/ai/schemas";
import { loadBenchmarkFixtures } from "../src/benchmark/fixtures";
import type { GroundedWritingOutput } from "../src/benchmark/schemas";
import { scoreGroundedWriting } from "../src/benchmark/scoring/groundedWritingScorer";
import { scoreJobExtraction } from "../src/benchmark/scoring/jobExtractionScorer";
import { scoreProfileMatching } from "../src/benchmark/scoring/profileMatchingScorer";

async function fixtureData() {
  return loadBenchmarkFixtures();
}

function perfectJob(): JobRequirements {
  return {
    roleTitle: "Senior Product Engineer",
    company: "Meridian Systems",
    location: "Austin, Texas, hybrid two days per week",
    seniority: "Senior; 6+ years",
    requiredSkills: ["TypeScript", "React", "Node.js", "REST APIs", "Automated testing with Jest or Playwright"],
    niceToHaveSkills: ["GraphQL", "Kubernetes"],
    educationRequirements: [],
    responsibilities: ["Build accessible features", "Improve performance", "Mentor through code review"],
    domain: "workflow software",
    keywords: []
  };
}

function perfectMatch(): MatchAnalysis {
  return {
    matchScore: 78,
    summary: "Strong grounded product-engineering alignment.",
    strongMatches: [
      "TypeScript and React workflow work",
      "Node.js REST API delivery",
      "Jest and Playwright automated testing",
      "Accessibility work",
      "Mentoring through code review"
    ],
    partialMatches: ["Docker container experience transfers to Kubernetes learning"],
    gaps: ["No GraphQL evidence", "Austin hybrid location availability is unconfirmed"],
    risks: [],
    suggestedPositioning: "Lead with supported workflow evidence.",
    keywordSuggestions: ["GraphQL", "Kubernetes"]
  };
}

function groundedWriting(): GroundedWritingOutput {
  return {
    recommendations: [
      "Lead with the TypeScript and React workflow features at Northwind Studio.",
      "Highlight Node.js REST API delivery and the measured performance improvement.",
      "Emphasize Jest and Playwright testing while presenting Kubernetes and GraphQL as learning gaps."
    ],
    recruiterMessage: "Hello, I am interested in the Senior Product Engineer role. My work at Northwind Studio includes TypeScript and React workflow features, Node.js REST services, accessibility, performance improvements, and Jest and Playwright testing. This evidence aligns with Meridian Systems' product responsibilities, and I would welcome a brief conversation about the role and its Austin hybrid expectations."
  };
}

test("perfect job extraction receives a high score", async () => {
  const fixtures = await fixtureData();
  const score = scoreJobExtraction(perfectJob(), fixtures.jobExtraction.expected);
  assert.ok(score.taskScore >= 95);
});

test("missing required job requirements are penalized", async () => {
  const fixtures = await fixtureData();
  const output = perfectJob();
  output.requiredSkills = output.requiredSkills.filter((skill) => !skill.includes("TypeScript"));
  const score = scoreJobExtraction(output, fixtures.jobExtraction.expected);
  assert.ok(score.reasons.some((reason) => reason.code === "missing-required" && reason.detail === "req-typescript"));
  assert.ok(score.completenessScore < 100);
});

test("invented job requirements are heavily penalized", async () => {
  const fixtures = await fixtureData();
  const output = perfectJob();
  output.requiredSkills.push("Java and AWS");
  const score = scoreJobExtraction(output, fixtures.jobExtraction.expected);
  assert.ok(score.groundingScore <= 40);
  assert.equal(score.catastrophicFabrication, true);
});

test("required and preferred misclassification is penalized", async () => {
  const fixtures = await fixtureData();
  const output = perfectJob();
  output.requiredSkills = output.requiredSkills.filter((skill) => skill !== "React");
  output.niceToHaveSkills.push("React");
  output.niceToHaveSkills = output.niceToHaveSkills.filter((skill) => skill !== "GraphQL");
  output.requiredSkills.push("GraphQL");
  const score = scoreJobExtraction(output, fixtures.jobExtraction.expected);
  assert.ok(score.reasons.some((reason) => reason.code === "required-classified-preferred"));
  assert.ok(score.reasons.some((reason) => reason.code === "preferred-classified-required"));
});

test("correct profile matches, gaps, and evidence score highly", async () => {
  const fixtures = await fixtureData();
  const score = scoreProfileMatching(perfectMatch(), fixtures.profileMatching.expected);
  assert.ok(score.taskScore >= 90);
  assert.equal(score.groundingScore, 100);
});

test("unsupported profile claims are heavily penalized", async () => {
  const fixtures = await fixtureData();
  const output = perfectMatch();
  output.strongMatches.push("The candidate has Kubernetes expertise and GraphQL experience.");
  const score = scoreProfileMatching(output, fixtures.profileMatching.expected);
  assert.ok(score.groundingScore <= 30);
  assert.equal(score.catastrophicFabrication, true);
});

test("grounded bounded writing passes", async () => {
  const fixtures = await fixtureData();
  const score = scoreGroundedWriting(groundedWriting(), fixtures.groundedWriting.expected);
  assert.ok(score.taskScore >= 90);
  assert.equal(score.catastrophicFabrication, false);
});

test("fabricated employment and technologies are heavily penalized", async () => {
  const fixtures = await fixtureData();
  const output = groundedWriting();
  output.recommendations[0] = "Highlight Acme Corporation and production Kubernetes experience.";
  const score = scoreGroundedWriting(output, fixtures.groundedWriting.expected);
  assert.ok(score.groundingScore <= 30);
  assert.equal(score.catastrophicFabrication, true);
});

test("all deterministic task scores remain within zero and one hundred", async () => {
  const fixtures = await fixtureData();
  const outputs = [
    scoreJobExtraction({ ...perfectJob(), requiredSkills: ["Java", "AWS", "Python"] }, fixtures.jobExtraction.expected),
    scoreProfileMatching({ ...perfectMatch(), strongMatches: ["AWS certified with Kubernetes expertise and GraphQL experience"] }, fixtures.profileMatching.expected),
    scoreGroundedWriting({ ...groundedWriting(), recruiterMessage: "World-class Acme engineer with ten years and production Kubernetes experience." }, fixtures.groundedWriting.expected)
  ];
  for (const score of outputs) {
    assert.ok(score.taskScore >= 0 && score.taskScore <= 100);
    assert.ok(score.completenessScore >= 0 && score.completenessScore <= 100);
    assert.ok(score.groundingScore >= 0 && score.groundingScore <= 100);
  }
});

test("score breakdown reasons are deterministic", async () => {
  const fixtures = await fixtureData();
  const output = { ...perfectJob(), requiredSkills: ["Java"] };
  assert.deepEqual(
    scoreJobExtraction(output, fixtures.jobExtraction.expected).reasons,
    scoreJobExtraction(output, fixtures.jobExtraction.expected).reasons
  );
});

export { groundedWriting, perfectJob, perfectMatch };
