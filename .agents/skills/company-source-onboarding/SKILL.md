---
name: company-source-onboarding
description: Import, normalise, resolve, verify, audit, and document official company career sources for the cv-match-agent registry. Use when adding or refreshing employers, processing sponsor or permit datasets, reviewing unresolved company domains, validating ATS identifiers, auditing stale/failing sources, or generating registry reports.
---

# Company Source Onboarding

Maintain the repository's provenance-first company registry without inventing domains, career URLs, ATS identifiers, or sponsorship claims.

## Workflow

1. Inspect the requested country, source, existing files under `data/company-sources/`, and current registry reports.
2. Read `references/source-quality-policy.md` and the relevant entry in `references/country-source-map.md` before adding data.
3. Prefer official government registers, permit lists, official job portals, ecosystem directories, and direct company pages.
4. Create a small structured derivative that validates against the source-record schema; never commit a full copied web page.
5. Preserve the source title, URL, record identifier, publication/update date, retrieval date, original legal name, and sponsorship evidence date.
6. Run `scripts/import-company-source.sh --dry-run` before importing.
7. Run `scripts/normalise-company-records.sh --dry-run`, inspect duplicate candidates, then run without dry-run when appropriate.
8. Resolve only records with an explicit official URL or a reviewed resolution CSV. Leave unknown domains as `candidate`.
9. Preserve both the corporate careers URL and ATS board URL. Detect ATS providers only from a saved URL, validated redirect, or official-page link/metadata. Never infer an identifier from a company name.
10. Treat a reachable, structurally valid empty board as `active-empty` and source-verified. A 404 is invalid, a timeout is temporary, and CAPTCHA/bot protection is blocked.
11. Hand off only to recognised ATS hosts. Require high-confidence relationship evidence and successful live verification before persisting Greenhouse, Lever, or Ashby details.
12. Represent regional brands as aliases or explicit relationships when one global board covers them. Fetch a shared board once and filter locations afterward.
13. Classify direct employers separately from agencies, staffing consultancies, job platforms, government portals, and ecosystem directories.
14. Never enable a company unless it is source-verified with an `active-with-jobs` or `active-empty` board. Run `companies:enable-verified -- --dry-run` first.
15. Run `scripts/audit-company-registry.sh`, connector tests, and `scripts/generate-company-stats.sh`.
16. Report actual imported, unresolved, rejected, duplicate, verified, monitored, empty, blocked, and failing counts.
17. Update the relevant source documentation and generated reports.

## Required references

- Read `references/company-schema.md` when editing records or migrations.
- Read `references/ats-detection-guide.md` when resolving or verifying career sources.
- Read `references/sponsorship-evidence-policy.md` for sponsor/permit evidence.
- Read `references/verification-checklist.md` before enabling any source.

## Examples

```text
$company-source-onboarding Import and verify new Irish employers from the latest official employment-permit company listing.
```

```text
$company-source-onboarding Audit all UAE companies whose career sources have not been checked in the last 30 days.
```

```text
$company-source-onboarding Add and verify this group of German technology employers without inventing unsupported ATS IDs.
```

```text
$company-source-onboarding Onboard Saudi employers as candidates and leave unsupported Workday sources disabled.
```

```text
$company-source-onboarding Merge Picnic/Picnic Technologies in the Netherlands and keep IND sponsor evidence separate from vacancy sponsorship.
```

```text
$company-source-onboarding Verify a UAE corporate careers page that hands off to Greenhouse and keep a valid empty board monitored.
```

```text
$company-source-onboarding Audit Irish and wider-Europe shared boards, preserving regional hiring countries and direct-employer priority.
```

## Runtime commands

```bash
npm run companies:import -- --dry-run
npm run companies:normalise -- --dry-run
npm run companies:resolve -- --country Germany --limit 25
npm run companies:detect-sources -- --country Germany --limit 25
npm run companies:verify -- --country Germany --limit 25
npm run companies:enable-verified -- --country Germany --dry-run
npm run companies:onboard -- --country Germany --limit 25
npm run companies:audit
npm run companies:stats
npm run jobs:discover -- --no-ai
```

Add `--enable-verified` to onboarding only after reviewing evidence. Normal tests use fixtures and must not require live internet.
