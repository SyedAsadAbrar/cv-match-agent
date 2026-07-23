# Autonomous job discovery plan

## Existing architecture

The repository is a strict TypeScript/CommonJS Node 20+ command-line application managed with npm. Commander provides routing for `analyze`, `profile`, and local-model benchmark commands. There was no frontend, HTTP server, database, ORM, scheduler, or authentication layer.

The existing AI layer exposes `LlmProvider` with Ollama and opt-in OpenAI adapters. `generateJsonWithSchema` requests JSON, validates it with Zod, retries once with a repair prompt, and reports useful final failures. CV input accepts text, Markdown, and text-based PDF files. It is split into semantic sections, extracted to a validated profile, checked for preservation of employment evidence, and saved as JSON context. Existing job extraction, match analysis, application-asset generation, model benchmarking, and debug artifact support are reusable.

Baseline on 2026-07-22: `npm run build` passed. `npm test` could not start inside the restricted sandbox because `tsx` was denied creation of its IPC socket (`listen EPERM`); this is recorded separately from implementation failures and will be retried with the required permission. No lint or formatting command existed.

## Components reused

- CV file reading, semantic section parsing, profile extraction, evidence preservation, and validation.
- Zod validation and the JSON repair-once AI workflow.
- Ollama/OpenAI provider interface and Ollama model inspection.
- Existing job-requirement extraction, CV comparison, generated assets, and benchmark tooling.
- Commander CLI and current npm package layout.

## Components modified

- CV extraction prompts explicitly mark documents as untrusted and reject embedded instructions.
- Ollama requests gain timeouts and role-specific model configuration while retaining `OLLAMA_MODEL` compatibility.
- The CLI gains `serve`, `jobs discover`, and `db migrate` commands.
- Profile context can be upgraded to the richer editable discovery profile and stored in SQLite.
- Package scripts add web, worker, migration, lint, type-check, and test entry points.

## New modules

- `domain`: Zod schemas and types for profiles, jobs, matching, trust, salary, discovery, and applications.
- `db`: ordered SQL migrations and a transaction-oriented SQLite repository.
- `discovery`: search-plan generation, connector contracts, Greenhouse/Lever/Ashby public adapters, optional web search, normalisation, deduplication, filters, scoring, trust, salary analysis, and orchestration.
- `security`: URL/SSRF validation, bounded safe HTTP fetching, HTML-to-text sanitisation, upload validation, and sensitive-log avoidance.
- `web`: native Node HTTP API plus a responsive local dashboard. A framework is deliberately not introduced because the existing repository has none; domain logic remains outside UI code.

## Database strategy

Use one local `better-sqlite3` database at `data/job-copilot.db` (or `DATABASE_URL`) with foreign keys, WAL mode, explicit migrations, transactions for discovery imports, and indexes for feed queries and deduplication. JSON columns retain validated domain objects while relational columns and supporting tables make important states queryable. The database and uploads are gitignored. No credentials are stored in browser-visible settings.

## Job-discovery strategy

Enabled company records with verified ATS identifiers are polled through official public read endpoints. Greenhouse uses its Job Board API, Lever its Postings API, and Ashby its public Job Postings API. Broad discovery is optional behind a server-side web-search adapter; the app remains useful with company feeds and without a search key. Search plans contain only roles, skills, locations, and public preference data.

Each source is isolated and bounded by timeout, retry, concurrency, response-size, and URL controls. Results are converted to plain text, validated, normalised, verified, deduplicated by strong deterministic signals, prefiltered, scored, assigned evidence-based trust/work-authorisation/salary assessments, and persisted. Reasoning-model analysis is limited to the strongest configurable shortlist and never changes deterministic scores.

## AI-model strategy

- `OLLAMA_EXTRACTION_MODEL`: structured candidate/job extraction and classification.
- `OLLAMA_REASONING_MODEL`: optional detailed shortlist explanation only.
- `OLLAMA_EMBEDDING_MODEL`: optional similarity and duplicate support through Ollama `/api/embed`.

All saved structured output must pass Zod. Extraction inputs are explicitly untrusted. Invalid JSON is repaired once. Network/model/timeout/abort/empty-output errors are surfaced and recorded at source or run level. If Ollama is unavailable, deterministic discovery and ranking continue and jobs are marked as needing detailed analysis.

## Known limitations

- A local language model does not browse the internet. New URLs require configured company/ATS sources or a web-search provider.
- This milestone supports manual runs, not an always-running scheduler.
- Work-authorisation output is preliminary evidence, not legal advice; missing sponsorship language remains unknown.
- Salary comparisons do not model tax, benefits, or cost of living and do not directly equate UAE net/gross-unknown monthly pay with foreign gross annual pay.
- Generic company career pages and search-provider results cannot be safely extracted without source-specific structured data; unsupported pages are retained as discoverable references for a later connector.
- The Chrome extension, sponsor-register imports, immigration rule versions, and automatic applications are out of scope.

## Implementation order

1. Preserve and document the baseline.
2. Add validated domain schemas and secure network primitives.
3. Add SQLite migrations/repository and the initial editable profile.
4. Add official ATS connectors and fixture tests.
5. Add deterministic search, normalisation, filtering, matching, work-authorisation, trust, salary, and deduplication.
6. Add discovery orchestration, CLI worker, and optional AI enrichment.
7. Add the local web API/dashboard for profile, feed, sources, settings, and application tracking.
8. Add unit/integration coverage, update documentation, migrate, and run final verification.
