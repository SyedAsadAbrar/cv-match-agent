# Company source repair plan

Reviewed: 2026-07-23

## Baseline and reproduced problems

The clean-install baseline used an isolated SQLite database populated only from
the committed `data/company-sources/` records.

- `npm install`, migration, import, normalisation, audit, formatting, lint,
  type-checking, all 115 tests, and the production build passed.
- The committed registry imports 25 source records into 25 companies. All 25
  have an official domain, 22 have a saved careers URL, and none are verified,
  monitored, or enabled before live resolution.
- All 22 saved career sources are classified as `custom`; none of the supported
  Greenhouse, Lever, or Ashby connectors are attached to a committed company.
- A live resolution pass reached most official pages and increased the
  temporary database to 24 careers URLs, but Discovered returned JSON under the
  fetcher's default content negotiation and Doctolib/Revolut returned HTTP 403.
  These are operational outcomes, not permanent invalid-source decisions.
- The full live verification command produced no result and no database
  change. Real generic crawls can be too broad or encounter unsupported content
  after the initial page, so verification is not operationally bounded enough
  for bulk onboarding.
- `verifyCompanySource()` explicitly throws when `discoverJobs()` returns an
  empty array. A valid empty board is therefore stored as temporarily failing.
- The generic crawler accepts only the original hostname and its subdomains. It
  ignores recognised external ATS links and cannot hand off to a public board.
- Source detection inspects only the supplied URL. It does not use redirects,
  canonical metadata, JSON-LD hiring identity, page metadata, or links found on
  the official careers page.
- Unsupported providers are detected, but their result lacks confidence and
  evidence and their operational state is not distinguished from other
  failures.
- Companies start disabled. The store prevents unverified enablement, but there
  is no safe filtered bulk-enable CLI or frontend workflow.
- Discovery correctly selects only enabled `source-verified`/`monitored`
  companies, which means the committed registry currently yields no jobs.
- Country coverage is small: 25 companies across 9 countries, with most of the
  requested UAE, Saudi, Netherlands, Germany, Ireland, and wider-Europe
  employers absent.

The AED 22,000 monthly compensation value remains a comparison baseline and is
not a minimum filter. The editable Dubai/Pakistani/work-permit defaults and the
configured Ollama extraction, reasoning, and embedding roles remain unchanged.
Applications remain manual.

## Root causes

1. The connector interface conflates board reachability/schema validity with
   the current number of vacancies.
2. Verification persistence records only completed/failed runs and lacks a
   structured board state, identity result, evidence, and retry classification.
3. Careers crawling is an ingestion-only same-origin crawler rather than a
   bounded inspection stage followed by a provider-specific verification stage.
4. ATS detection has no confidence model or relationship evidence and persists
   URL-derived identifiers before live identity verification.
5. The source lifecycle has no separate active-empty, invalid, wrong-company,
   unsupported, or blocked outcome.
6. Source enablement is implemented only one company at a time.
7. Seed data and reports do not model hiring-source classification, shared
   boards, or parent/brand/regional relationships comprehensively.
8. Discovery groups work by company rather than verified board identity, so a
   future expanded regional registry would fetch shared global boards more than
   once.

## Files requiring changes

- Domain and persistence: `src/domain/schemas.ts`, `src/db/migrations.ts`,
  `src/db/store.ts`.
- Detection and verification: `src/company/detection.ts`,
  `src/company/crawler.ts`, `src/company/registry.ts`, and a focused source
  inspection/handoff module if separation improves safety.
- Connectors and discovery: `src/discovery/types.ts`,
  `src/discovery/connectors/*`, `src/discovery/pipeline.ts`.
- Commands: `src/commands/companies.ts`, `src/index.ts`, `package.json`.
- API/UI: `src/web/server.ts`, `public/app.js`, and only the necessary styles.
- Sources and reports: `data/company-sources/**`, `reports/**`, README, and this
  repository's onboarding skill.
- Tests and fixtures: `test/companyRegistry.test.ts`,
  `test/autonomousDiscovery*.test.ts`, plus source-verification fixtures.

## Source state model

Keep the company workflow status for operator actions:

```text
candidate → domain-resolved → careers-page-found → source-verified → monitored
```

Persist a separate latest verification board state:

```text
active-with-jobs
active-empty
temporarily-unavailable
invalid
wrong-company
unsupported
blocked
```

A structured `CompanySourceVerificationResult` records reachability, response
validity, company identity, jobs parsed, sample evidence, checked time, and the
board state. Valid empty boards become `source-verified` and may be monitored.
Timeout/rate-limit outcomes preserve prior successful verification and use
retry/backoff metadata. Invalid, wrong-company, unsupported, and blocked
outcomes remain disabled. A successful refresh, including a valid empty
snapshot, is the only event allowed to increment missing-job observations.

## ATS handoff design

1. Fetch an evidence-backed official domain or careers URL through `safeFetch`.
2. Record the final redirect URL, canonical URL, page title/metadata, JSON-LD
   hiring organisation, and all relevant anchor links without executing
   JavaScript.
3. Match external URLs only against recognised ATS host patterns. All DNS,
   redirect, response-size, timeout, and content-type protections still apply.
4. Store source-page URL, external ATS URL, link text, provider, identifier,
   confidence, evidence, and detection time.
5. Extract identifiers only from the observed URL; never derive them from a
   company name.
6. Verify Greenhouse, Lever, and Ashby through their public structured
   endpoints. Match board identity using returned company metadata, official
   page evidence, and conservative name/alias comparison.
7. Persist a handoff automatically only at high confidence after successful
   verification. Preserve the corporate careers URL separately from the ATS
   board URL.
8. Detect Workable, SmartRecruiters, Workday, Personio, Recruitee,
   SuccessFactors, and Oracle, but report them as unsupported until a dedicated
   connector exists.

## Empty-board verification design

Connector verification returns source metadata independently from postings.
Valid provider payloads with an empty jobs array are `active-empty`. A readable
official careers page can be `active-empty` only when its corporate identity
and careers purpose are supported by the official-domain evidence. HTTP 404 or
an invalid identifier is `invalid`; mismatched company evidence is
`wrong-company`; timeouts and rate limits are `temporarily-unavailable`;
CAPTCHA/bot interstitials are `blocked`; detection-only systems are
`unsupported`.

## Company expansion design

- Add structured candidate records grouped by authoritative source and country.
- Preserve direct official URLs only where public evidence has been reviewed.
  Missing URLs remain candidates; missing ATS identifiers are never guessed.
- Merge obvious aliases such as Bird/MessageBird and Picnic/Picnic
  Technologies. Preserve legal entities, subsidiaries, brands, regional hiring
  coverage, and shared boards as explicit relationships.
- Store one verified shared global board and attach country coverage rather
  than creating duplicate fetches for every regional label.
- Classify direct employers, recruitment agencies, staffing consultancies, job
  platforms, government portals, and ecosystem directories. Direct employer
  postings win canonical deduplication.
- Keep IND sponsor and Irish permit evidence separate from vacancy-level
  sponsorship claims.
- Use maintained fixture-backed snapshots/import workflows for Hub71, Fintech
  Saudi, IND, Irish permits, Make it in Germany, and EURES where a stable public
  source exists. Document manual snapshot workflows where a safe feed does not.

Because the requested list contains hundreds of entities, import completeness
and live source verification are reported separately. Candidate inclusion does
not imply a verified source, current hiring, sponsorship, or monitoring.

## Enablement and onboarding workflow

Add filtered `detect-sources`, `enable-verified`, and `onboard` commands.
Relevant bulk commands support dry-run, country, provider, limit, and company
filters. Bulk enable prints every planned change, includes active-empty sources,
enables only verified companies, and exits non-zero on partial write failures.
The frontend uses the same store rules for selected verification, retry,
enablement, and disablement.

## Discovery changes

- Group enabled companies by verified provider/identifier or canonical careers
  URL and fetch each shared board once.
- Apply company/country association after a shared global board is fetched.
- Isolate source failures and preserve source-level retry records.
- Do not close jobs following a failed refresh. Only successful source
  snapshots update missing-job counters.
- Reuse stored embeddings and detailed analysis for unchanged content.
- Prefer direct-employer references when deduplicating an agency/platform copy.

## Test plan

Use deterministic fixtures only for the normal suite:

- Greenhouse, Lever, and Ashby with jobs, empty, invalid, wrong-company,
  rate-limited, and temporary failures.
- Generic official page active-with-jobs and active-empty.
- Corporate handoff to Greenhouse, Lever, Ashby, Workday, redirected and
  regional boards, multiple links, unrelated/lookalike boards, and invalid
  identifiers.
- All enable/disable/bulk-enable invariants.
- Provenance, aliases, relationships, classification, shared boards, regional
  deduplication, and country reports.
- Shared-board single fetch, empty-to-active transition, partial failure,
  idempotency, source precedence, and safe missing-job handling.
- SSRF, redirect-to-private-network, external-host allowlisting, response-size,
  and sanitisation regressions.
- Fixture-based ecosystem importer idempotency.

After fixtures pass, run limited read-only live smoke checks and label their
actual outcomes separately. No report will claim a live verification from a
fixture result.
