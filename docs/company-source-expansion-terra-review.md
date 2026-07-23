# Company source expansion — Terra review

Review date: 2026-07-23

## Scope and outcome

This review audited the uncommitted company-source expansion, source-verification workflow, discovery handoff, reports, commands, and registry UI/API contract. It used a fresh isolated SQLite database for all import, verification, enablement, and discovery checks. The repository database was not enabled or otherwise mutated.

The clean baseline imports 449 provenance-bearing source records into 373 deduplicated companies. It passes the registry audit with no errors, warnings, or duplicate candidates. All imported sources remain disabled until source verification succeeds.

## Critical

None found.

## High

### Fixed — ambiguous ATS handoffs were silently auto-selected

- Files: `src/company/registry.ts`, `src/domain/schemas.ts`, `test/companyRegistry.test.ts`
- Impact: an official careers page that linked to multiple supported boards could select the first result and eventually enable a non-canonical source.
- Fix: all detected boards are now persisted with provider, identifier, URL, confidence, link evidence, and detection timestamp. A single high-confidence supported board can be selected; multiple supported boards are retained and the company is marked `unsupported` pending manual selection.
- Verification: Mistral AI’s official careers page currently links to both Ashby (`mistral.ai`) and Lever (`mistral`). The audit preserved both and did not enable either.

### Fixed — detected handoff evidence was not retained in verification history

- Files: `src/company/registry.ts`, `src/commands/companies.ts`, `src/web/server.ts`, `src/domain/schemas.ts`
- Impact: a successful verification did not fully retain the official source page, link text, ATS URL, and discovery time needed to audit the company-to-board relationship.
- Fix: `sourceDetections` and `sourceDetectionCheckedAt` are stored on the company payload. CLI detection and the UI/API detection endpoint persist their results; successful verification copies the selected handoff evidence into `lastVerification`.
- Verification: Pleo now records its corporate page, “See open roles” link text, Ashby URL, identifier, and detection timestamp before being eligible for enablement.

### Fixed — committed report state reflected an ephemeral live test

- Files: `reports/company-registry-summary.*`, `reports/company-source-repair-summary.*`, maintenance CSV reports
- Impact: repository reports claimed live verification results that were only present in a temporary test database.
- Fix: reports were regenerated from a clean isolated import. They now accurately show 0 verified and 0 enabled sources in the committed data baseline.

## Medium

### Fixed — newly added organisations lacked explicit hiring-source classification

- File: `data/company-sources/uae/official-company-pages.records.json`
- Impact: UI filtering and discovery policy could not reliably distinguish employers from recruitment intermediaries.
- Fix: Dicetek is `staffing-consultancy`; HCLTech is `direct-employer`; Discovered MENA and Nameless Ventures are `recruitment-agency`. Tamara is already a `direct-employer`.
- Verification: a clean import preserves all five classifications.

### Remaining — the broad expansion is a verified-provenance candidate registry, not a verified-source registry

- Files: `data/company-sources/**/*.records.json`, generated reports
- Impact: 373 companies have official-domain or careers-page candidates, but none are pre-verified or enabled. This is safe and intentional, but source coverage should not be described as 373 working job feeds.
- Recommendation: verify in bounded country/provider batches, retain blocked and empty states, and enable only `active-with-jobs` or `active-empty` results.

### Remaining — Discovered MENA is not currently a crawler-ready HTML source

- File: `data/company-sources/uae/official-company-pages.records.json`
- Impact: the root endpoint returned JSON in one check and timed out in a later bounded safe-fetch check. Its public jobs endpoint must be manually confirmed before it is verified or enabled.
- Recommendation: retain it as a disabled recruitment-agency candidate; add a supported public connector only after confirming a stable public endpoint and company identity.

## Low

### Fixed — `detect-sources --dry-run` was misleading once detections became persistent

- File: `src/commands/companies.ts`
- Impact: the option could have implied a dry run while detection persistence was added.
- Fix: the command now honours `--dry-run` and only persists detections on normal runs.

## Verified working

- Database migration, import, normalisation, audit, and report generation complete successfully on a fresh database: 449 records, 373 companies, 45 careers pages, 0 enabled sources, and no audit findings.
- The registry schema keeps independent lifecycle state (`candidate` through `monitored`) and board state (`active-with-jobs`, `active-empty`, temporary, invalid, wrong-company, unsupported, blocked). Empty boards are eligible only after identity and structural validation.
- The source detectors recognise Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Personio, Recruitee, SuccessFactors, and Oracle. Ingestible sources remain restricted to the implemented public connectors.
- Live public API smoke checks succeeded for Greenhouse: Datadog (418), Cloudflare (269), GitLab (181); Lever: Palantir (first page 100), Protolabs (80), Insify (16); Ashby: Pleo (46), Mistral AI (172). Counts are point-in-time observations.
- Valid empty responses were confirmed for Lever Mistral (0) and Ashby Deel (0); this validates the distinction between an empty board and an invalid source.
- Pleo’s official careers page was detected, verified as Ashby `pleo`, enabled only in the isolated audit database, and discovered 46 jobs. The second discovery imported 0 and marked all 46 as duplicates, confirming idempotency.
- Mistral AI’s two supported handoffs were detected from its official page and safely held for manual canonical selection.
- Tamara, Dicetek, HCLTech UAE, Discovered MENA, and Nameless Ventures all responded publicly at least once. Tamara, Dicetek, HCLTech, and Nameless Ventures passed bounded safe-fetch checks; Discovered MENA requires the follow-up described above.
- The UI/API exposes lifecycle and board-state filters, source evidence, bounded bulk verification/enablement, and individual detect/verify/sync actions. The server returned the isolated registry data successfully.
- Existing security controls remain intact: public-URL/SSRF validation on every redirect, response-size and content-type limits, bounded crawler depth/page count, robots handling, private local storage, HTML sanitisation, and no auto-apply behaviour.
- Quality gates pass: `npm test` (132 tests), `npm run typecheck`, `npm run format:check`, `npm run lint`, and `npm run build`.

## Not implemented

- No generic ingestion connector was added for detection-only ATS providers such as Workday, SmartRecruiters, Personio, Recruitee, SuccessFactors, Oracle, or Workable. They are detected and safely classified as unsupported rather than scraped.
- No bulk live verification was run across the full 373-company registry.
- No automated browser end-to-end suite was added; the existing unit/integration coverage and local API check cover the implemented contract.

## Unable to verify

- Visual in-app browser interaction could not run because the browser runtime failed before connection with a sandbox-policy error. This did not affect the local HTTP/API check, but visual layout and click-through behavior should be checked in a normal browser session.
- Discovered MENA did not provide a stable crawler-compatible response during this audit, so its public job endpoint and board identity are unverified.

## Out of scope

- No new web scraping, paid data source, automatic job application, external account action, or production registry enablement was performed.
- The review did not claim sponsorship, relocation, remote-work, or hiring availability beyond the evidence already stored for each source.

## Recommended next steps

1. Manually choose Mistral AI’s canonical regional board, then verify it before enablement.
2. Verify the candidate registry in small country/provider batches and keep reports tied to the database that produced them.
3. Confirm a stable, public, crawler-compatible Discovered MENA jobs endpoint before adding a connector or enabling it.
4. Run the company-registry page once in a normal browser to complete visual interaction coverage.
