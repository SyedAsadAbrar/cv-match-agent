# Version 1 company-registry review

Reviewed: 2026-07-23

## Scope and method

This review covered the Version 1 registry schemas and migrations, source snapshots, import/normalise/audit/stats commands, store queries and indexes, source verification, ATS/careers connectors, crawler and HTTP safety controls, discovery eligibility, Sources UI/API, generated reports, tests, and the repository-local company-source onboarding policy.

The baseline was clean: `npm install`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (113 tests), and `npm run build` all passed before repairs. The post-repair checks are recorded below.

## Actual registry snapshot and country coverage

The committed data is a small, reproducible seed registry, not the previously committed live IND refresh database. A clean temporary SQLite database imported only from `data/company-sources/` contains:

- 25 source records and 25 unique companies.
- 25 domain-resolved companies; 22 with careers pages.
- 0 candidates, 0 source-verified, 0 monitored, 0 temporarily failing, 0 inactive, 0 rejected, and 0 duplicate candidates.
- 4 confirmed company-level sponsor records (Netherlands), 3 historical permit-evidence records (Ireland), and 18 unknown sponsorship records. These are not vacancy-level eligibility claims.
- 9 of the stated 16 target countries: Netherlands (4), Ireland (3), United Arab Emirates (7), Saudi Arabia (3), Germany (3), Sweden (2), Estonia (1), France (1), and Lithuania (1).

The source provenance is preserved in the structured snapshots: IND Public Register Work (4), Ireland Employment Permit Statistics 2025 (3), Hub71 Job Board Companies (2), Hub71 Market Partners (1), verified EU company pages (5), verified German company pages (3), verified Saudi company pages (3), and one official record each for Dicetek, HCLTech UAE, Discovered, and Nameless Ventures. The seven remaining target countries have no committed source snapshot, so 16-country coverage is not complete.

## Critical

No critical data-loss, migration, secret-exposure, or arbitrary-network-access defect was found.

## High

### Empty source response could be promoted to verified

- Severity: High
- Files: `src/company/registry.ts`, `src/db/store.ts`, `test/companyRegistry.test.ts`
- Why it mattered: successful HTTP/connector completion was treated as proof even when no job reference was parsed. That contradicts the verification policy and could enable a non-operational source.
- User impact: a “verified” or monitored source could silently yield no vacancies.
- Minimal fix: require at least one parsed job reference; store the parsed-count and sample reference in the verification-run evidence.
- Fixed status: Fixed. Empty results now fail verification, are marked `temporarily-failing` and disabled, and successful runs retain evidence metadata.

### Temporarily failing sources could be manually synced

- Severity: High
- Files: `src/web/server.ts`
- Why it mattered: the sync endpoint accepted `temporarily-failing`, while the discovery pipeline correctly excludes it.
- User impact: the UI could report that a source sync started even though it was not eligible for discovery.
- Minimal fix: allow direct sync only for enabled `source-verified` or `monitored` sources.
- Fixed status: Fixed.

### Committed reports described unreproducible live-only data

- Severity: High
- Files: `reports/*`, `src/company/registry.ts`
- Why it mattered: reports claimed 12,897 source records and 12,860 companies although the committed snapshots now contain 25 records. The report database was not part of the repository.
- User impact: operators could mistake a local, transient refresh for a reproducible product data state.
- Minimal fix: rebuild report artifacts from a clean database imported only from committed source files and label distinct count categories precisely.
- Fixed status: Fixed. Reports now describe the 25-record reproducible snapshot and distinguish unique companies, candidates, domain/careers resolution, verification states, and unresolved workflow state.

### Company pagination materialised the full registry before slicing

- Severity: High
- Files: `src/db/store.ts`, `src/web/server.ts`, `test/companyRegistry.test.ts`
- Why it mattered: `listCompaniesPage` deserialised every JSON payload before filtering and pagination despite relational filter columns and indexes already existing.
- User impact: the Sources page would degrade significantly for the previously reported 12k+ registry.
- Minimal fix: perform count, filtering, sort, limit, and offset in SQLite; parse only the selected page.
- Fixed status: Fixed. Search covers legal name, display name, and official domain through stored columns; country, status, ATS, sponsorship, engineering relevance, and enabled filters execute in SQL.

### IPv4-mapped IPv6 SSRF targets were not recognised as private

- Severity: High
- Files: `src/security/safeFetch.ts`, `test/autonomousDiscovery.test.ts`
- Why it mattered: bracketed or hexadecimal IPv4-mapped IPv6 forms could avoid the IPv4 private-range checks.
- User impact: a crafted company URL could target loopback/private infrastructure.
- Minimal fix: normalise bracketed IPv6 hostnames and evaluate mapped IPv4 forms through the existing private-address policy.
- Fixed status: Fixed and regression-tested.

## Medium

### Sources UI lacked the registry’s useful operational filters and provenance display

- Severity: Medium
- Files: `public/app.js`, `src/web/server.ts`, `src/db/store.ts`
- Why it mattered: ATS, sponsorship, and engineering relevance were stored and indexable but not filterable in the interface; the table did not show source provenance.
- User impact: manual review of a growing registry was slower and less auditable.
- Minimal fix: expose the existing filters through the API/UI and display the stored source names alongside official domain/careers links.
- Fixed status: Fixed.

### Stated 16-country coverage is incomplete

- Severity: Medium
- Files: `data/company-sources/`, `reports/company-registry-summary.*`, `.agents/skills/company-source-onboarding/references/country-source-map.md`
- Why it mattered: the committed registry supplies auditable records for only 9 of 16 target countries.
- User impact: discovery coverage is materially narrower than a 16-country operating claim.
- Minimal fix: source, validate, and import official structured derivatives for the remaining countries under the repository’s source-quality policy; verify their career sources separately.
- Fixed status: Not fixed. This requires new, reviewed country data rather than an implementation repair.

## Low

No additional low-severity defect required a code change in this pass.

## Verified working

- Clean-database import completed for all 11 committed source names; normalisation dry-run made zero changes, registry audit returned no errors/warnings, and no duplicate candidates were found.
- The source onboarding policy is present and requires provenance, official/reviewed URLs, non-invented ATS identifiers, bounded public-source verification, and verified-only enablement.
- Discovery independently filters to enabled `source-verified`/`monitored` companies; sponsor/permit evidence remains company-level rather than vacancy-level.
- Greenhouse, Lever, Ashby, and the conservative same-domain careers crawler are covered by fixtures. The crawler respects robots directives, depth/page/response limits, does not execute page JavaScript or submit forms, and now strips common tracking parameters from canonical URLs.
- `safeFetch` validates HTTP(S), credentials, DNS/IP safety, redirects, response type/size, retries, and timeouts.
- Migration, foreign keys, transactional imports, source observations, duplicate review, unresolved-resolution CSV flow, and source-run history are present.

## Not implemented

- Official-source snapshots for the remaining seven target countries.
- Verification of the 22 committed careers pages into active monitored sources; the reproducible seed has zero verified/monitored sources.
- Ingestion connectors for detection-only ATS products (Workday, Workable, SmartRecruiters, Personio, Recruitee, SuccessFactors, Oracle).
- Generic web-search result ingestion, paid search, broad internet scraping, automated applications, Chrome extension, scheduler, and a full UI redesign.

## Unable to verify

- Live official pages/ATS boards were intentionally not refreshed in this review, so their current availability and current job counts are not asserted.
- Browser interaction could not be completed because the sandbox disallowed binding the local HTTP listener (`EPERM` on loopback). API/UI code was inspected and its server-side filters are covered by tests, but this is not a visual-browser acceptance test.

## Out of scope

- Adding paid providers, scraping protected/login/CAPTCHA sites, bypassing access controls, auto-applying to jobs, new ATS connectors, and a redesign of the application.

## Final recommendation

The registry implementation is now internally consistent and its committed reports are reproducible. It is ready for controlled source verification and incremental country onboarding, but it is not yet ready to claim 16-country coverage or autonomous monitored discovery from the repository snapshot: it currently has zero verified, enabled, or monitored company sources.
