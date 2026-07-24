import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

type JobDetailView = {
  renderJobDetail: (item: Record<string, unknown>) => string;
  normaliseDescription: (description: string) => string[];
};

const requireFromTest = createRequire(__filename);
const view = requireFromTest("../public/job-detail-view.js") as JobDetailView;

function jobDetail(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    job: {
      id: "job-1",
      canonicalUrl: "https://careers.example.com/jobs/1",
      sourceType: "company-careers",
      sourceName: "Example official careers",
      title: "Principal Software Engineer",
      company: "Example Systems",
      locationText: "Kongens Nytorv 1, Copenhagen, Denmark",
      workplaceType: "hybrid",
      employmentType: "Full-time",
      description:
        "Build reliable product features.\n\nResponsibilities\nLead frontend architecture.\n\nRequirements\nReact and TypeScript.",
      firstSeenAt: "2026-07-20T10:00:00.000Z",
      lastVerifiedAt: "2026-07-23T10:00:00.000Z",
      status: "active",
    },
    match: {
      score: 70,
      recommendation: "apply",
      components: {
        requiredSkills: {
          score: 100,
          evidence: ["React and TypeScript match the profile."],
        },
        seniority: {
          score: 55,
          evidence: ["The vacancy appears one level above the target."],
        },
      },
      matchedSkills: ["React", "TypeScript"],
      transferableSkills: ["Enterprise product engineering"],
      gaps: [
        {
          type: "work-authorization-gap",
          severity: "medium",
          requirement: "Danish work authorisation",
          explanation: "The posting does not mention visa sponsorship.",
          candidateEvidence: ["Candidate needs sponsorship"],
          recommendation: "Ask the recruiter about permit sponsorship.",
        },
      ],
      needsDetailedAnalysis: true,
    },
    trust: {
      level: "verified",
      canonicalCompanyPageFound: true,
      evidence: ["Published through an official job portal."],
      suspiciousSignals: [],
    },
    workAuthorization: {
      status: "unknown",
      sponsorshipRequired: true,
      sponsorshipMentioned: false,
      positiveEvidence: [],
      explicitRestrictions: [],
      missingInformation: ["Whether sponsorship is available"],
      explanation: "The posting does not provide enough sponsorship evidence.",
      disclaimer: "This is a preliminary assessment, not legal advice.",
    },
    salary: {
      confidence: "low",
      evidenceCount: 0,
      evidence: [],
      explanation:
        "The posting does not disclose compensation, and no comparable salary records have been collected for this role and location.",
    },
    saved: true,
    dismissed: false,
    application: { status: "applied" },
    ...overrides,
  };
}

test("job detail shows compact identity, recommendation, score, and current action states", () => {
  const html = view.renderJobDetail(jobDetail());

  assert.match(html, /Principal Software Engineer/);
  assert.match(html, /Example Systems/);
  assert.match(html, /Copenhagen, Denmark/);
  assert.match(html, /70%/);
  assert.match(html, />Apply</);
  assert.match(html, />Saved</);
  assert.match(html, />Applied</);
  assert.match(html, /href="https:\/\/careers\.example\.com\/jobs\/1"/);
  assert.match(html, /Open official application/);
  assert.doesNotMatch(html, /Back to Discover Jobs/);
});

test("match components use readable labels and accessible score bars", () => {
  const html = view.renderJobDetail(jobDetail());

  assert.match(html, /Required skills/);
  assert.match(html, /Relevant experience|Seniority/);
  assert.doesNotMatch(html, />requiredSkills</);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-label="Required skills: 100 out of 100"/);
  assert.match(html, />Strong</);
  assert.match(html, />Moderate</);
});

test("unknown work authorisation and absent salary evidence render concise states", () => {
  const html = view.renderJobDetail(jobDetail());

  assert.match(html, /Work authorisation/);
  assert.match(html, /Eligibility unclear/);
  assert.match(html, /Sponsorship required[\s\S]*Yes/);
  assert.match(html, /Sponsorship mentioned[\s\S]*No/);
  assert.match(html, /No reliable estimate yet/);
  assert.match(html, /Current baseline: AED 22,000 \/ monthly in the UAE/);
  assert.equal((html.match(/No reliable estimate yet/g) ?? []).length, 1);
});

test("salary evidence renders without fabricating a fallback estimate", () => {
  const item = jobDetail({
    salary: {
      advertisedSalary: {
        minimum: 80000,
        maximum: 95000,
        currency: "DKK",
        period: "monthly",
      },
      estimatedMarketRange: {
        minimum: 75000,
        maximum: 100000,
        currency: "DKK",
        period: "monthly",
      },
      recommendedExpectation: {
        amount: 90000,
        currency: "DKK",
        period: "monthly",
      },
      confidence: "medium",
      evidenceCount: 2,
      evidence: [
        {
          sourceName: "Official job posting",
          sourceUrl: "https://careers.example.com/jobs/1",
          amount: 90000,
          currency: "DKK",
          period: "monthly",
        },
      ],
      explanation: "Based on posted and comparable evidence.",
    },
  });
  const html = view.renderJobDetail(item);

  assert.match(html, /Advertised range/);
  assert.match(html, /DKK 80,000–95,000 \/ monthly/);
  assert.match(html, /Estimated market range/);
  assert.match(html, /Recommended expectation/);
  assert.match(html, /2 sources · Medium confidence/);
  assert.doesNotMatch(html, /No reliable estimate yet/);
});

test("detailed local-AI analysis has pending, unavailable, and structured available states", () => {
  const pending = view.renderJobDetail(jobDetail());
  assert.match(pending, /Detailed analysis is pending/);
  assert.match(pending, /configured Ollama model finishes/);

  const unavailable = view.renderJobDetail(
    jobDetail({
      match: {
        ...(jobDetail().match as Record<string, unknown>),
        needsDetailedAnalysis: false,
      },
    }),
  );
  assert.match(unavailable, /Detailed analysis unavailable/);

  const available = view.renderJobDetail(
    jobDetail({
      match: {
        ...(jobDetail().match as Record<string, unknown>),
        detailedAnalysis: {
          summary: "The role fits the structured skills evidence.",
          experiencesToEmphasise: ["Enterprise product delivery"],
          recruiterConcerns: ["Permit support is unconfirmed"],
          transferableSkillReasoning: ["React experience transfers directly"],
          applicationStrategy: ["Lead with frontend architecture outcomes"],
          salaryEvidenceInterpretation:
            "No reliable salary evidence is available.",
        },
      },
    }),
  );
  assert.match(available, /Why this role fits/);
  assert.match(available, /Experience to emphasise/);
  assert.match(available, /Recruiter questions to expect/);
  assert.doesNotMatch(available, /<pre>/);
});

test("original description keeps readable paragraphs and safely collapses long content", () => {
  const paragraphs = view.normaliseDescription(
    "Intro text. Responsibilities Build accessible products. Requirements React and TypeScript.",
  );
  assert.deepEqual(paragraphs, [
    "Intro text.",
    "Responsibilities Build accessible products.",
    "Requirements React and TypeScript.",
  ]);

  const item = jobDetail();
  const job = item.job as Record<string, unknown>;
  job.description = "One.\n\nTwo.\n\nThree.\n\nFour.";
  assert.match(view.renderJobDetail(item), /Show full description/);
});

test("detail header exposes an accessible back action and detail layout stacks on small screens", () => {
  const root = path.resolve(__dirname, "..");
  const index = readFileSync(path.join(root, "public/index.html"), "utf8");
  const styles = readFileSync(path.join(root, "public/styles.css"), "utf8");
  const app = readFileSync(path.join(root, "public/app.js"), "utf8");
  const detailPageRule = styles.match(/\.job-detail-page\s*\{([^}]*)\}/)?.[1];

  assert.match(index, /aria-label="Back to Discover Jobs"/);
  assert.match(app, /history\.pushState\(null, "", "\/discover"\)/);
  assert.match(
    styles,
    /\.job-detail-grid\s*\{[\s\S]*grid-template-columns: minmax\(0, 2fr\) minmax\(290px, 0\.92fr\)/,
  );
  assert.match(
    styles,
    /\.job-detail-page\s*\{[\s\S]*width: 100%;[\s\S]*max-width: none;[\s\S]*margin: 0;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 960px\)[\s\S]*\.job-detail-grid\s*\{\s*grid-template-columns: 1fr/,
  );
  assert.ok(detailPageRule);
  assert.doesNotMatch(detailPageRule, /overflow-x:\s*auto/);
});

test("job detail uses a non-nested main column so the application shell layout cannot constrain it", () => {
  const html = view.renderJobDetail(jobDetail());

  assert.match(html, /<div class="job-detail-main">/);
  assert.doesNotMatch(html, /<main class="job-detail-main">/);
});
