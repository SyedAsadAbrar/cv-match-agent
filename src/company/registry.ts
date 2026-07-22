import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AshbyConnector } from "../discovery/connectors/ashby";
import { CareersPageConnector } from "../discovery/connectors/careersPage";
import { GreenhouseConnector } from "../discovery/connectors/greenhouse";
import { LeverConnector } from "../discovery/connectors/lever";
import type { JobSourceConnector } from "../discovery/types";
import {
  companyImportRunSchema,
  companySourceRecordSchema,
  targetCompanySchema,
  type CompanyImportRun,
  type CompanySourceRecord,
  type TargetCompany,
} from "../domain/schemas";
import { safeFetch } from "../security/safeFetch";
import { htmlToSafeText } from "../security/content";
import { JobCopilotStore } from "../db/store";
import { findCompanyDuplicates } from "./deduplicate";
import { detectCareerSource, findCareerLink } from "./detection";
import {
  canonicalisePublicUrl,
  normaliseCompanyName,
  normaliseDomain,
} from "./normalise";

export type CompanyRegistryStats = {
  totalSourceRecords: number;
  /** All deduplicated registry entities, irrespective of workflow status. */
  totalCompanies: number;
  candidateCompanies: number;
  domainResolved: number;
  careersPageFound: number;
  sourceVerified: number;
  monitored: number;
  temporarilyFailing: number;
  inactive: number;
  byCountry: Record<string, number>;
  verifiedByCountry: Record<string, number>;
  monitoredByCountry: Record<string, number>;
  unresolvedByCountry: Record<string, number>;
  byStatus: Record<string, number>;
  byAtsProvider: Record<string, number>;
  byIndustry: Record<string, number>;
  bySponsorshipEvidence: Record<string, number>;
  bySource: Record<string, number>;
  enabled: number;
  unresolved: number;
  rejected: number;
  duplicates: number;
  verificationFailures: number;
};

export async function loadCompanySourceRecords(
  directory = path.resolve(process.cwd(), "data/company-sources"),
): Promise<CompanySourceRecord[]> {
  const files = await collectJsonFiles(directory);
  const records: CompanySourceRecord[] = [];
  for (const file of files) {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    const entries = Array.isArray(value)
      ? value
      : value && typeof value === "object" && "records" in value
        ? (value as { records: unknown }).records
        : value;
    if (!Array.isArray(entries))
      throw new Error(`${file} must contain a JSON record array.`);
    records.push(
      ...entries.map((entry) => companySourceRecordSchema.parse(entry)),
    );
  }
  return records;
}

export async function importCompanySources(
  store: JobCopilotStore,
  options: { directory?: string; dryRun?: boolean } = {},
): Promise<CompanyImportRun[]> {
  const records = await loadCompanySourceRecords(options.directory);
  return importCompanySourceRecords(store, records, options.dryRun);
}

export async function importCompanySourceRecords(
  store: JobCopilotStore,
  records: CompanySourceRecord[],
  dryRun = false,
): Promise<CompanyImportRun[]> {
  const groups = new Map<string, CompanySourceRecord[]>();
  for (const record of records) {
    const key = `${record.sourceName}\u0000${record.sourceUrl}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const runs: CompanyImportRun[] = [];
  const importIndex = createImportIndex(store.listCompanies());
  for (const [key, sourceRecords] of groups) {
    const [sourceName, sourceUrl] = key.split("\u0000");
    const startedAt = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let duplicates = 0;
    let rejected = 0;
    const errors: CompanyImportRun["errors"] = [];
    const processRecords = () => {
      for (const record of sourceRecords) {
        try {
          const match = findImportMatch(importIndex, record);
          if (match.ambiguous) {
            duplicates += 1;
            continue;
          }
          const company = buildCompany(record, match.company);
          if (!dryRun) {
            store.saveCompany(company);
            store.saveCompanySourceRecord(company.id, record);
          }
          addCompanyToImportIndex(importIndex, company);
          if (match.company) updated += 1;
          else created += 1;
        } catch (error) {
          rejected += 1;
          errors.push({
            recordId: record.sourceRecordId,
            message: formatError(error),
          });
        }
      }
    };
    if (dryRun) processRecords();
    else store.database.transaction(processRecords)();
    const run = companyImportRunSchema.parse({
      id: randomUUID(),
      sourceName,
      status: errors.length
        ? created + updated > 0
          ? "partially-completed"
          : "failed"
        : "completed",
      sourceUrl,
      sourcePublishedAt: sourceRecords[0]?.sourcePublishedAt,
      startedAt,
      completedAt: new Date().toISOString(),
      recordsRead: sourceRecords.length,
      recordsCreated: created,
      recordsUpdated: updated,
      duplicatesFound: duplicates,
      recordsRejected: rejected,
      errors,
    });
    if (!dryRun) store.saveCompanyImportRun(run);
    runs.push(run);
  }
  return runs;
}

export async function refreshIndSponsorRegister(
  store: JobCopilotStore,
  options: {
    dryRun?: boolean;
    fetchImpl?: typeof fetch;
    lookup?: (hostname: string) => Promise<string[]>;
    retrievedAt?: string;
  } = {},
): Promise<CompanyImportRun[]> {
  const sourceUrl =
    "https://ind.nl/en/public-register-recognised-sponsors/public-register-work";
  const response = await safeFetch(sourceUrl, {
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
    timeoutMs: 30_000,
    maxBytes: 10_000_000,
    maxRedirects: 3,
    retries: 2,
    allowedContentTypes: ["text/html", "application/xhtml+xml"],
  });
  if (!response.ok)
    throw new Error(`IND sponsor register returned HTTP ${response.status}.`);
  const records = parseIndSponsorRegisterHtml(
    await response.text(),
    options.retrievedAt ?? new Date().toISOString(),
  );
  if (records.length < 100)
    throw new Error(
      `IND sponsor register parser found only ${records.length} rows; refusing a suspicious refresh.`,
    );
  return importCompanySourceRecords(store, records, options.dryRun);
}

export function parseIndSponsorRegisterHtml(
  html: string,
  retrievedAt: string,
): CompanySourceRecord[] {
  const sourceUrl =
    "https://ind.nl/en/public-register-recognised-sponsors/public-register-work";
  const published = html.match(
    /(?:last updated|updated on)[^0-9]{0,30}(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
  )?.[1];
  const records: CompanySourceRecord[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [
      ...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
    ].map((cell) => htmlToPlainText(cell[1]));
    if (cells.length < 2) continue;
    const kvk = cells[1].replace(/\D/g, "");
    const legalName = cells[0].trim();
    if (!legalName || !/^\d{8}$/.test(kvk)) continue;
    records.push(
      companySourceRecordSchema.parse({
        sourceRecordId: `kvk-${kvk}`,
        legalName,
        aliases: [],
        sourceType: "official-sponsor-register",
        sourceName: "IND Public Register Work",
        sourceUrl,
        sourcePublishedAt: published,
        sourceRetrievedAt: retrievedAt,
        country: "Netherlands",
        cities: [],
        industries: [],
        sponsorshipEvidence: {
          level: "confirmed-register",
          countries: ["Netherlands"],
          sourceUrls: [sourceUrl],
          observedAt: retrievedAt,
        },
      }),
    );
  }
  return records;
}

export function normaliseCompanyRegistry(
  store: JobCopilotStore,
  dryRun = false,
): { updated: number; duplicateCandidates: number } {
  const companies = store.listCompanies();
  let updated = 0;
  for (const company of companies) {
    const normalized = targetCompanySchema.parse({
      ...company,
      aliases: [
        ...new Set(
          company.aliases.map((value) => value.trim()).filter(Boolean),
        ),
      ],
      operatingCountries: [...new Set(company.operatingCountries)],
      hiringCountries: [...new Set(company.hiringCountries)],
      knownCities: [...new Set(company.knownCities)],
      industries: [
        ...new Set(company.industries.map((value) => value.toLowerCase())),
      ],
      companyDomain: normaliseDomain(company.companyDomain),
    });
    if (JSON.stringify(normalized) !== JSON.stringify(company)) {
      updated += 1;
      if (!dryRun) store.saveCompany(normalized);
    }
  }
  return {
    updated,
    duplicateCandidates: findCompanyDuplicates(companies).length,
  };
}

export async function resolveCompany(
  company: TargetCompany,
  options: {
    fetchImpl?: typeof fetch;
    lookup?: (hostname: string) => Promise<string[]>;
  } = {},
): Promise<TargetCompany> {
  if (!company.websiteUrl && !company.companyDomain)
    return { ...company, verificationStatus: "candidate" };
  const websiteUrl = canonicalisePublicUrl(
    company.websiteUrl ?? `https://${company.companyDomain}`,
  );
  const response = await safeFetch(websiteUrl, {
    ...options,
    timeoutMs: 15_000,
    maxBytes: 5_000_000,
    maxRedirects: 3,
    retries: 1,
    allowedContentTypes: ["text/html", "application/xhtml+xml"],
  });
  if (!response.ok)
    throw new Error(`Official homepage returned HTTP ${response.status}.`);
  const html = await response.text();
  const careersUrl = company.careersUrl ?? findCareerLink(websiteUrl, html);
  const detected = careersUrl ? detectCareerSource(careersUrl) : undefined;
  return targetCompanySchema.parse({
    ...company,
    companyDomain: normaliseDomain(websiteUrl),
    websiteUrl,
    careersUrl,
    atsProvider:
      company.atsProvider ??
      detected?.provider ??
      (careersUrl ? "custom" : undefined),
    atsIdentifier: company.atsIdentifier ?? detected?.identifier,
    verificationStatus: careersUrl ? "careers-page-found" : "domain-resolved",
    resolvedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    verificationError: undefined,
  });
}

export async function verifyCompanySource(
  store: JobCopilotStore,
  company: TargetCompany,
  connectors: Partial<Record<string, JobSourceConnector>> = {},
): Promise<TargetCompany> {
  const defaults: Partial<Record<string, JobSourceConnector>> = {
    greenhouse: new GreenhouseConnector(),
    lever: new LeverConnector(),
    ashby: new AshbyConnector(),
    custom: new CareersPageConnector(),
  };
  const connector =
    connectors[company.atsProvider ?? "custom"] ??
    defaults[company.atsProvider ?? "custom"];
  if (!connector)
    throw new Error(
      `${company.atsProvider ?? "Unknown"} is detection-only and cannot ingest jobs.`,
    );
  if (company.atsProvider !== "custom" && !company.atsIdentifier)
    throw new Error("A validated ATS identifier is required.");
  if (company.atsProvider === "custom" && !company.careersUrl)
    throw new Error("A verified official careers URL is required.");
  const verificationRunId = store.startCompanyVerificationRun(company);
  try {
    const references = await connector.discoverJobs({
      profile: store.getProfile(),
      company,
      maximumJobs: 1,
    });
    if (references.length === 0)
      throw new Error(
        "Source returned no current or valid historical job postings; it cannot be source-verified.",
      );
    const verified = targetCompanySchema.parse({
      ...company,
      verificationStatus: company.enabled ? "monitored" : "source-verified",
      lastCheckedAt: new Date().toISOString(),
      verificationError: undefined,
    });
    store.saveCompany(verified);
    store.finishCompanyVerificationRun(verificationRunId, verified, undefined, {
      jobsParsed: references.length,
      sampleJobUrl: references[0]?.url,
      sampleExternalId: references[0]?.externalId,
    });
    return verified;
  } catch (error) {
    const failed = targetCompanySchema.parse({
      ...company,
      enabled: false,
      verificationStatus: "temporarily-failing",
      lastCheckedAt: new Date().toISOString(),
      verificationError: formatError(error),
    });
    store.saveCompany(failed);
    store.finishCompanyVerificationRun(
      verificationRunId,
      failed,
      formatError(error),
    );
    throw error;
  }
}

export function auditCompanyRegistry(store: JobCopilotStore): {
  errors: string[];
  warnings: string[];
  duplicates: ReturnType<typeof findCompanyDuplicates>;
} {
  const companies = store.listCompanies();
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const company of companies) {
    if (company.sourceRecords.length === 0)
      errors.push(`${company.id}: missing source provenance`);
    if (
      company.enabled &&
      !["source-verified", "monitored"].includes(company.verificationStatus)
    )
      errors.push(`${company.id}: enabled without a verified source`);
    if (
      company.atsProvider &&
      company.atsProvider !== "custom" &&
      !company.atsIdentifier
    )
      errors.push(`${company.id}: ATS provider is missing an identifier`);
    if (!company.companyDomain)
      warnings.push(`${company.id}: unresolved official domain`);
    if (company.verificationStatus === "temporarily-failing")
      warnings.push(
        `${company.id}: ${company.verificationError ?? "source verification failed"}`,
      );
  }
  return { errors, warnings, duplicates: findCompanyDuplicates(companies) };
}

export function generateCompanyRegistryStats(
  store: JobCopilotStore,
): CompanyRegistryStats {
  const companies = store.listCompanies();
  const duplicates = findCompanyDuplicates(companies);
  return {
    totalSourceRecords: store.countCompanySourceRecords(),
    totalCompanies: companies.length,
    candidateCompanies: companies.filter(
      (company) => company.verificationStatus === "candidate",
    ).length,
    domainResolved: companies.filter((company) =>
      Boolean(company.companyDomain),
    ).length,
    careersPageFound: companies.filter((company) => Boolean(company.careersUrl))
      .length,
    sourceVerified: companies.filter(
      (company) => company.verificationStatus === "source-verified",
    ).length,
    monitored: companies.filter(
      (company) => company.verificationStatus === "monitored",
    ).length,
    temporarilyFailing: companies.filter(
      (company) => company.verificationStatus === "temporarily-failing",
    ).length,
    inactive: companies.filter(
      (company) => company.verificationStatus === "inactive",
    ).length,
    byCountry: countMany(
      companies.flatMap((company) => company.operatingCountries),
    ),
    verifiedByCountry: countMany(
      companies
        .filter((company) =>
          ["source-verified", "monitored"].includes(company.verificationStatus),
        )
        .flatMap((company) => company.operatingCountries),
    ),
    monitoredByCountry: countMany(
      companies
        .filter((company) => company.verificationStatus === "monitored")
        .flatMap((company) => company.operatingCountries),
    ),
    unresolvedByCountry: countMany(
      companies
        .filter((company) => company.verificationStatus === "candidate")
        .flatMap((company) => company.operatingCountries),
    ),
    byStatus: countMany(companies.map((company) => company.verificationStatus)),
    byAtsProvider: countMany(
      companies.map((company) => company.atsProvider ?? "unresolved"),
    ),
    byIndustry: countMany(companies.flatMap((company) => company.industries)),
    bySponsorshipEvidence: countMany(
      companies.map((company) => company.sponsorshipEvidence),
    ),
    bySource: countMany(
      companies.flatMap((company) =>
        company.sourceRecords.map((source) => source.sourceName),
      ),
    ),
    enabled: companies.filter((company) => company.enabled).length,
    unresolved: companies.filter(
      (company) => company.verificationStatus === "candidate",
    ).length,
    rejected: companies.filter(
      (company) => company.verificationStatus === "rejected",
    ).length,
    duplicates: duplicates.length,
    verificationFailures: companies.filter(
      (company) => company.verificationStatus === "temporarily-failing",
    ).length,
  };
}

export async function writeCompanyRegistryReports(
  store: JobCopilotStore,
  directory = path.resolve(process.cwd(), "reports"),
): Promise<CompanyRegistryStats> {
  const stats = generateCompanyRegistryStats(store);
  const companies = store.listCompanies();
  const duplicates = findCompanyDuplicates(companies);
  await fs.mkdir(directory, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(directory, "company-registry-summary.json"),
      `${JSON.stringify(stats, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(directory, "company-registry-summary.md"),
      renderStatsMarkdown(stats),
    ),
    fs.writeFile(
      path.join(directory, "unresolved-companies.csv"),
      toCsv(
        ["id", "legalName", "country", "officialDomain", "status", "source"],
        companies
          .filter((company) => company.verificationStatus === "candidate")
          .map((company) => [
            company.id,
            company.legalName,
            company.headquartersCountry ?? "",
            company.companyDomain ?? "",
            company.verificationStatus,
            company.sourceType,
          ]),
      ),
    ),
    fs.writeFile(
      path.join(directory, "failing-company-sources.csv"),
      toCsv(
        ["id", "company", "careersUrl", "error"],
        companies
          .filter(
            (company) => company.verificationStatus === "temporarily-failing",
          )
          .map((company) => [
            company.id,
            company.displayName,
            company.careersUrl ?? "",
            company.verificationError ?? "",
          ]),
      ),
    ),
    fs.writeFile(
      path.join(directory, "company-duplicates.csv"),
      toCsv(
        ["leftId", "rightId", "confidence", "reasons"],
        duplicates.map((item) => [
          item.leftId,
          item.rightId,
          item.confidence,
          item.reasons.join("; "),
        ]),
      ),
    ),
  ]);
  return stats;
}

export function exportUnresolvedCompanies(store: JobCopilotStore): string {
  return toCsv(
    [
      "id",
      "legalName",
      "officialDomain",
      "careersUrl",
      "atsProvider",
      "atsIdentifier",
      "evidenceUrl",
      "notes",
    ],
    store
      .listCompanies()
      .filter(
        (company) =>
          !company.companyDomain || company.verificationStatus === "candidate",
      )
      .map((company) => [
        company.id,
        company.legalName,
        company.companyDomain ?? "",
        company.careersUrl ?? "",
        company.atsProvider ?? "",
        company.atsIdentifier ?? "",
        "",
        company.notes ?? "",
      ]),
  );
}

export function importCompanyResolutions(
  store: JobCopilotStore,
  csv: string,
  dryRun = false,
): { updated: number; errors: string[] } {
  const rows = parseCsv(csv);
  let updated = 0;
  const errors: string[] = [];
  for (const row of rows) {
    try {
      const company = store.listCompanies().find((item) => item.id === row.id);
      if (!company) throw new Error(`Unknown company ${row.id}.`);
      const domain = normaliseDomain(row.officialDomain);
      const careersUrl = row.careersUrl
        ? canonicalisePublicUrl(row.careersUrl)
        : company.careersUrl;
      const detected = careersUrl ? detectCareerSource(careersUrl) : undefined;
      const updatedCompany = targetCompanySchema.parse({
        ...company,
        companyDomain: domain ?? company.companyDomain,
        websiteUrl: domain ? `https://${domain}/` : company.websiteUrl,
        careersUrl,
        atsProvider:
          row.atsProvider || detected?.provider || company.atsProvider,
        atsIdentifier:
          row.atsIdentifier || detected?.identifier || company.atsIdentifier,
        verificationStatus: careersUrl
          ? "careers-page-found"
          : domain
            ? "domain-resolved"
            : company.verificationStatus,
        notes: row.notes || company.notes,
        enabled: false,
        resolvedAt: new Date().toISOString(),
        sourceRecords: row.evidenceUrl
          ? [
              ...company.sourceRecords,
              {
                sourceRecordId: `manual-${Date.now()}`,
                sourceType: "manual-resolution",
                sourceName: "Reviewed resolution CSV",
                sourceUrl: canonicalisePublicUrl(row.evidenceUrl),
                sourceRetrievedAt: new Date().toISOString(),
              },
            ]
          : company.sourceRecords,
      });
      if (!dryRun) store.saveCompany(updatedCompany);
      updated += 1;
    } catch (error) {
      errors.push(formatError(error));
    }
  }
  return { updated, errors };
}

function buildCompany(
  record: CompanySourceRecord,
  existing?: TargetCompany,
): TargetCompany {
  const sourceReference = {
    sourceRecordId: record.sourceRecordId,
    sourceType: record.sourceType,
    sourceName: record.sourceName,
    sourceUrl: record.sourceUrl,
    sourcePublishedAt: record.sourcePublishedAt,
    sourceRetrievedAt: record.sourceRetrievedAt,
    originalIdentifier: record.sourceRecordId,
  };
  const websiteUrl = record.websiteUrl ?? existing?.websiteUrl;
  const companyDomain = normaliseDomain(websiteUrl) ?? existing?.companyDomain;
  const careersUrl = record.careersUrl ?? existing?.careersUrl;
  const detected = careersUrl ? detectCareerSource(careersUrl) : undefined;
  const sponsorshipEvidence = strongestSponsorship(
    existing?.sponsorshipEvidence ?? "unknown",
    sourceSponsorship(record),
  );
  return targetCompanySchema.parse({
    ...(existing ?? {}),
    id: existing?.id ?? deterministicCompanyId(record),
    name: record.displayName ?? record.legalName,
    legalName: record.legalName,
    displayName: record.displayName ?? record.legalName,
    aliases: [...new Set([...(existing?.aliases ?? []), ...record.aliases])],
    companyDomain,
    websiteUrl,
    careersUrl,
    headquartersCountry: existing?.headquartersCountry ?? record.country,
    operatingCountries: [
      ...new Set([...(existing?.operatingCountries ?? []), record.country]),
    ],
    hiringCountries: existing?.hiringCountries ?? [],
    countries: [...new Set([...(existing?.countries ?? []), record.country])],
    knownCities: [
      ...new Set([...(existing?.knownCities ?? []), ...record.cities]),
    ],
    industries: [
      ...new Set([...(existing?.industries ?? []), ...record.industries]),
    ],
    atsProvider:
      existing?.atsProvider ??
      detected?.provider ??
      (careersUrl ? "custom" : undefined),
    atsIdentifier: existing?.atsIdentifier ?? detected?.identifier,
    sourceType: existing?.sourceType ?? record.sourceType,
    sourceRecords: [
      ...new Map(
        [...(existing?.sourceRecords ?? []), sourceReference].map((item) => [
          `${item.sourceName}:${item.sourceRecordId}`,
          item,
        ]),
      ).values(),
    ],
    sponsorshipEvidence,
    sponsorshipCountries: [
      ...new Set([
        ...(existing?.sponsorshipCountries ?? []),
        ...(record.sponsorshipEvidence?.countries ?? []),
      ]),
    ],
    sponsorshipEvidenceSources: [
      ...new Set([
        ...(existing?.sponsorshipEvidenceSources ?? []),
        ...(record.sponsorshipEvidence?.sourceUrls ?? []),
      ]),
    ],
    verificationStatus:
      existing?.verificationStatus ??
      (careersUrl
        ? "careers-page-found"
        : companyDomain
          ? "domain-resolved"
          : "candidate"),
    enabled: existing?.enabled ?? false,
    discoveredAt: existing?.discoveredAt ?? new Date().toISOString(),
    notes:
      [existing?.notes, record.notes].filter(Boolean).join("\n") || undefined,
  });
}

type CompanyImportIndex = {
  bySource: Map<string, TargetCompany[]>;
  byNameCountry: Map<string, TargetCompany[]>;
  byDomain: Map<string, TargetCompany[]>;
};

function createImportIndex(companies: TargetCompany[]): CompanyImportIndex {
  const index: CompanyImportIndex = {
    bySource: new Map(),
    byNameCountry: new Map(),
    byDomain: new Map(),
  };
  for (const company of companies) addCompanyToImportIndex(index, company);
  return index;
}

function addCompanyToImportIndex(
  index: CompanyImportIndex,
  company: TargetCompany,
): void {
  for (const source of company.sourceRecords)
    addIndexed(
      index.bySource,
      `${source.sourceName}\u0000${source.sourceRecordId}`,
      company,
    );
  for (const name of [
    company.legalName,
    company.displayName,
    ...company.aliases,
  ])
    for (const country of company.operatingCountries)
      addIndexed(
        index.byNameCountry,
        `${normaliseCompanyName(name)}\u0000${country}`,
        company,
      );
  if (company.companyDomain)
    addIndexed(index.byDomain, company.companyDomain, company);
}

function addIndexed(
  map: Map<string, TargetCompany[]>,
  key: string,
  company: TargetCompany,
): void {
  const values = map.get(key) ?? [];
  map.set(key, [...values.filter((value) => value.id !== company.id), company]);
}

function findImportMatch(
  index: CompanyImportIndex,
  record: CompanySourceRecord,
): { company?: TargetCompany; ambiguous: boolean } {
  const bySource =
    index.bySource.get(`${record.sourceName}\u0000${record.sourceRecordId}`) ??
    [];
  if (bySource.length === 1) return { company: bySource[0], ambiguous: false };
  const normalized = normaliseCompanyName(record.legalName);
  const candidates =
    index.byNameCountry.get(`${normalized}\u0000${record.country}`) ?? [];
  if (candidates.length === 1)
    return { company: candidates[0], ambiguous: false };
  if (candidates.length > 1) return { ambiguous: true };
  if (record.websiteUrl) {
    const probe = targetCompanySchema.parse({
      id: "probe",
      name: record.legalName,
      companyDomain: normaliseDomain(record.websiteUrl),
      countries: [record.country],
      sponsorshipEvidence: "unknown",
      sponsorshipEvidenceSources: [],
      enabled: false,
    });
    const domainMatches = index.byDomain.get(probe.companyDomain ?? "") ?? [];
    if (domainMatches.length === 1)
      return { company: domainMatches[0], ambiguous: false };
    if (domainMatches.length > 1) return { ambiguous: true };
  }
  return { ambiguous: false };
}

async function collectJsonFiles(directory: string): Promise<string[]> {
  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch((error: unknown) => {
      throw new Error(
        `Could not read company source directory ${directory}: ${formatError(error)}`,
      );
    });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectJsonFiles(target)));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target);
  }
  return files.sort();
}

function sourceSponsorship(
  record: CompanySourceRecord,
): TargetCompany["sponsorshipEvidence"] {
  switch (record.sponsorshipEvidence?.level) {
    case "confirmed-register":
    case "company-statement":
      return "confirmed";
    case "permit-history":
    case "historical":
      return "historical";
    case "possible":
      return "possible";
    default:
      return "unknown";
  }
}

function strongestSponsorship(
  left: TargetCompany["sponsorshipEvidence"],
  right: TargetCompany["sponsorshipEvidence"],
): TargetCompany["sponsorshipEvidence"] {
  const order = [
    "unlikely",
    "unknown",
    "possible",
    "historical",
    "confirmed",
  ] as const;
  return order[Math.max(order.indexOf(left), order.indexOf(right))];
}

function deterministicCompanyId(record: CompanySourceRecord): string {
  return `company-${createHash("sha256")
    .update(`${record.sourceName}:${record.sourceRecordId}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function countMany(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function renderStatsMarkdown(stats: CompanyRegistryStats): string {
  return `# Company registry summary\n\nGenerated: ${new Date().toISOString()}\n\nCounts describe the database used for this report. A company may appear in more than one country row; headline counts are unique companies. “Unresolved” means the candidate workflow state, not merely a missing domain.\n\n- Source records: ${stats.totalSourceRecords}\n- Unique companies: ${stats.totalCompanies}\n- Candidate companies: ${stats.candidateCompanies}\n- Domain resolved: ${stats.domainResolved}\n- Careers pages found: ${stats.careersPageFound}\n- Source verified: ${stats.sourceVerified}\n- Monitored: ${stats.monitored}\n- Temporarily failing: ${stats.temporarilyFailing}\n- Inactive: ${stats.inactive}\n- Unresolved: ${stats.unresolved}\n- Rejected: ${stats.rejected}\n- Duplicate candidates: ${stats.duplicates}\n\n## Companies by country\n\n${renderCountTable(stats.byCountry)}\n\n## Verified by country\n\n${renderCountTable(stats.verifiedByCountry)}\n\n## Monitored by country\n\n${renderCountTable(stats.monitoredByCountry)}\n\n## Unresolved by country\n\n${renderCountTable(stats.unresolvedByCountry)}\n\n## By verification status\n\n${renderCountTable(stats.byStatus)}\n\n## By ATS provider\n\n${renderCountTable(stats.byAtsProvider)}\n\n## By industry\n\n${renderCountTable(stats.byIndustry)}\n\n## By sponsorship evidence\n\n${renderCountTable(stats.bySponsorshipEvidence)}\n\n## By source\n\n${renderCountTable(stats.bySource)}\n`;
}

function renderCountTable(values: Record<string, number>): string {
  return [
    "| Value | Count |",
    "| --- | ---: |",
    ...Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => `| ${key.replace(/\|/g, "\\|")} | ${count} |`),
  ].join("\n");
}

function toCsv(headers: string[], rows: string[][]): string {
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseCsv(input: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"' && quoted && input[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    ),
  );
}

function htmlToPlainText(value: string): string {
  return htmlToSafeText(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
