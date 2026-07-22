# Version 1 company-registry implementation plan

Reviewed: 2026-07-23

## Baseline

The repository is already a strict TypeScript modular monolith. It has a Commander CLI, native Node HTTP dashboard, SQLite through `better-sqlite3`, Zod schemas, local Ollama extraction/reasoning/embeddings, deterministic scoring, application tracking, and fixture-tested Greenhouse, Lever, and Ashby connectors. CV upload and extraction, profile persistence, work-authorisation evidence, salary evidence, job normalisation, job deduplication, source-failure isolation, and manual official application links are working and will be reused.

The existing company model is intentionally small: one required domain, optional careers URL and ATS fields, countries, sponsorship classification, enabled state, and a JSON payload. It does not distinguish imported candidates from verified monitored sources, preserve source records, model aliases/relationships, maintain import history, resolve or crawl official careers pages, paginate companies, or generate registry reports.

Baseline verification completed before implementation:

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 94 passed, 0 failed.
- `npm run build`: passed.

There were no pre-existing failures.

## Reuse

- Keep the existing SQLite store and ordered SQL migration approach rather than adding a second ORM abstraction.
- Extend `TargetCompany` compatibly and migrate existing records to the new verification model.
- Reuse public ATS connectors and the bounded, SSRF-safe HTTP client.
- Reuse normalisation, job deduplication, filtering, deterministic scoring, salary analysis, Ollama enrichment, and the existing discovery-run summary.
- Extend the current Sources dashboard into a paginated Companies registry instead of introducing another frontend framework.

## Missing components

1. Provenance-validated company source records and import-run history.
2. Explicit candidate, resolved, verified, monitored, failing, inactive, and rejected states.
3. Company name normalisation, conservative duplicate detection, aliases, and relationships.
4. Deterministic domain/careers resolution for records that already contain official URLs.
5. ATS detection for supported and detection-only providers.
6. Conservative same-domain careers crawling with JSON-LD and sitemap extraction.
7. Verified-only enablement and discovery.
8. Import, normalise, resolve, verify, audit, stats, refresh, resolution CSV, and report commands.
9. Server-side company pagination, filters, manual resolution, and company actions.
10. Repository-local company-source onboarding skill and deterministic maintenance scripts.

## Data-source strategy

Source files live under `data/company-sources/<region>/` as small structured derivatives with source metadata, not copied web pages. Each record retains the source record ID, legal name, source type/name/URL, source dates, geography, official links when explicitly supplied, industries, and sponsorship evidence.

Official sponsor or permit data is imported as candidate evidence only. It does not make a company technology-relevant, source-verified, enabled, or guarantee sponsorship for a vacancy. Official company pages and reviewed curated records may provide domains/careers URLs. Missing domains and ATS identifiers remain unresolved; the application never synthesises them.

Version 1 will ship representative, auditable source snapshots and import mechanics that scale to large official extracts. Actual generated reports will state the real record counts rather than presenting scale targets as achieved.

## Verification strategy

Verification advances monotonically through evidence-backed states:

1. Validate provenance and import as `candidate`.
2. Accept an explicit HTTPS website/domain and mark `domain-resolved` only after safe validation.
3. Find a linked official careers page, supported ATS link, sitemap, or JSON-LD job page and mark `careers-page-found`.
4. Successfully query the public ATS feed or conservative official crawler and mark `source-verified`.
5. Enable only a source-verified company, producing `monitored`.

Previously valid sources that fail become `temporarily-failing`; bad or unsafe matches are rejected. Audit reports flag stale checks, missing provenance, enabled unverified records, conflicting evidence, malformed identifiers, and possible duplicates.

## Database changes

- Extend `target_companies` with normalised name, optional domain, headquarters country, ATS provider, verification status, engineering relevance, sponsorship evidence, and last successful sync columns.
- Add company source records, import runs, relationships, verification runs, and source observations.
- Add indexes for name, domain, geography, ATS, status, enabled, sponsorship, engineering relevance, and sync time.
- Preserve validated JSON payloads while keeping filter/sort fields relational and indexed.

## Implementation order

1. Add schemas, name/domain/duplicate utilities, migrations, and repository APIs.
2. Add structured source snapshots and idempotent import/normalise/audit/stats/report commands.
3. Add ATS detection, official-link resolution, JSON-LD/sitemap extraction, and bounded generic crawler.
4. Enforce verified-only discovery and maintain source verification/sync state.
5. Add paginated Companies APIs, UI, manual resolution, and CSV export/import.
6. Create and validate the repo-local maintenance skill and wrappers around deterministic commands.
7. Generate reports and run fixture, migration, CLI, network smoke, frontend, lint, type-check, test, and build verification.

## Risks and limitations

- Government datasets change formats and publication URLs; refreshes must fail visibly rather than silently reinterpreting data.
- Sponsor-register and permit history are employer-level evidence, not vacancy-level eligibility decisions.
- Custom career sites vary widely. The crawler deliberately skips client-rendered/login-protected sites and never executes third-party JavaScript.
- Detection-only ATS providers remain visible but are not falsely labelled as ingestible.
- Exact scale depends on legally and technically accessible source snapshots. Reports expose actual candidate and monitored counts separately.
- Version 1 monitors maintained official sources; it does not search the entire internet.
