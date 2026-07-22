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
9. Detect ATS providers from official links. Never infer an identifier from a company name.
10. Verify the public feed or conservative official crawler before changing a company to `source-verified`.
11. Never enable a company unless its status is `source-verified` or `monitored`.
12. Run `scripts/audit-company-registry.sh`, connector tests, and `scripts/generate-company-stats.sh`.
13. Report actual imported, unresolved, rejected, duplicate, verified, monitored, and failing counts.
14. Update the relevant source documentation and generated reports.

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
