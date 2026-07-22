# Autonomous job discovery implementation review

Reviewed: 2026-07-23

## Critical

No critical build, migration, data-loss, or direct secret-exposure defect was found during this pass.

## High

### Ashby verification performs an unnecessary board request per job

- Files: `src/discovery/connectors/ashby.ts`, `src/discovery/pipeline.ts`
- Problem: discovery already receives the complete public Ashby board, but `verifyJobActive` fetches that complete board again for every posting. A 100-job board therefore creates 101 list requests.
- User impact: slow syncs and avoidable rate-limit failures.
- Minimal fix: treat an `isListed` job returned by the current public board response as active; preserve the source list as verification evidence.
- Fixed during review: yes.

### Application tracking cannot record the advertised fields

- Files: `src/web/server.ts`, `public/app.js`, `src/applications/tracking.ts`
- Problem: the API only accepts a status and the UI only offers “Mark applied”. Notes, CV version, recruiter details, next action, follow-up date, and interview dates cannot be edited despite being stored in the schema.
- User impact: the application tracker is not genuinely usable beyond a single status change.
- Minimal fix: validate a partial tracking update, merge it into the stored application, enforce status transitions, and add a small edit form to the application/job-detail view.
- Fixed during review: yes.

### Dismissed jobs remain in the default discovery feed and dashboard counts

- Files: `src/db/store.ts`, `src/web/server.ts`, `public/app.js`
- Problem: dismissing changes a flag but the primary query and summary still include the job.
- User impact: roles the user intentionally dismissed continue to look like new recommendations.
- Minimal fix: hide dismissed jobs from normal feed/dashboard queries while retaining an explicit dismissed view/state for recovery.
- Fixed during review: yes.

### Salary outlier handling combines incompatible currencies and periods

- Files: `src/discovery/salary.ts`
- Problem: values such as EUR annual and AED monthly are passed through one IQR calculation before grouping.
- User impact: valid salary evidence can be incorrectly discarded or a misleading market range can be selected.
- Minimal fix: remove outliers only within the same currency, period, and gross/net group; exclude stale comparable vacancies.
- Fixed during review: yes.

## Medium

### Configured discovery concurrency is unused

- Files: `src/discovery/pipeline.ts`, `.env.example`
- Problem: `JOB_DISCOVERY_CONCURRENCY` is documented but connectors/jobs are not bounded through it; source discovery uses unbounded `Promise.all` and job imports are serial.
- User impact: the configured value has no effect and large registries are slower than necessary.
- Minimal fix: use a small bounded mapper for company sources and posting imports.
- Fixed during review: yes.

### Broad web-search results are saved but not promoted into jobs

- Files: `src/discovery/webSearch.ts`, `src/discovery/pipeline.ts`
- Problem: search results are deliberately not scraped, but recognised ATS URLs are not yet converted into configured/safe references either.
- User impact: broad search is useful for diagnostics but does not add vacancies unless company feeds are configured.
- Minimal fix: future focused work should safely promote recognised ATS URLs only. No change in this review because generic result-page extraction is intentionally out of scope.
- Fixed during review: no.

### Dashboard progress is coarse

- Files: `src/web/server.ts`, `public/app.js`
- Problem: the UI can see “running” and the completed run but not live per-source/posting counters.
- User impact: long real-world runs do not expose detailed progress until they finish.
- Minimal fix: update the persisted run counters during the worker loop. Deferred to avoid broad worker/UI changes.
- Fixed during review: no.

## Low

### Tests are combined under one npm command

- Files: `package.json`
- Problem: unit and integration files run together under `npm test`; there are no separate convenience scripts.
- User impact: none for correctness; reporting takes an extra filter step.
- Minimal fix: add separate scripts if CI needs distinct stages.
- Fixed during review: no.

## Verified working

- Strict TypeScript build, ESLint, Prettier check, and the full 94-test suite passed after repair.
- A fresh SQLite database migrated successfully; the fictional demo seeded 8 jobs, detected 1 duplicate, and retained 1 expected isolated source error.
- The local HTTP dashboard served its HTML, security headers, dashboard API, jobs API, and application-tracking update/read-back flow from that isolated demo database.
- Read-only public endpoint smoke checks returned valid non-empty payloads for Greenhouse (22 jobs), Lever (1 job), and Ashby (59 jobs); no live jobs were imported.
- SQLite migrations, foreign keys, WAL mode, gitignore rules, and transactional imports are present.
- CV upload checks extension and 5 MB limit; extraction uses server-side Ollama/Zod JSON repair and untrusted-data prompts.
- Greenhouse, Lever, and Ashby connectors validate fixture responses, bound fetches, sanitise HTML, and isolate source failures.
- Discovery does not need a manually entered job URL and can work from configured ATS/company sources without a web-search key.
- Score calculation is deterministic and detailed AI analysis is separated from the score.
- Missing sponsorship language is represented as unknown; current salary remains a non-filtering AED 22,000 monthly baseline.
- SSRF protections, response limits, redirects, and local-only browser security headers are implemented.

## Not implemented

- Generic web-search result ingestion.
- Scheduler, Chrome extension, LinkedIn scraping, automated applications, immigration-law data, tax/cost-of-living engine, cloud deployment, and multi-user authentication.

## Unable to verify

- Real CV extraction/deep analysis/embeddings because the locally installed Ollama models were not assumed available.
- Visual in-app-browser interaction because the browser runtime could not attach under the environment's missing sandbox policy. Direct local HTTP rendering and API checks completed successfully instead.
