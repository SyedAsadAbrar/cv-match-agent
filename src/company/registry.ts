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
  type CompanySourceVerificationResult,
  type CompanyImportRun,
  type CompanySourceRecord,
  type TargetCompany,
} from "../domain/schemas";
import { safeFetch } from "../security/safeFetch";
import { htmlToSafeText } from "../security/content";
import { JobCopilotStore } from "../db/store";
import { findCompanyDuplicates } from "./deduplicate";
import {
  detectCareerSource,
  findCareerLink,
  type DetectedCareerSource,
} from "./detection";
import { crawlOfficialCareersSite } from "./crawler";
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
  sourceVerifiedWithJobs: number;
  sourceVerifiedEmpty: number;
  monitored: number;
  temporarilyFailing: number;
  temporarilyUnavailable: number;
  blockedOrUnsupported: number;
  invalidSources: number;
  inactive: number;
  byCountry: Record<string, number>;
  verifiedByCountry: Record<string, number>;
  monitoredByCountry: Record<string, number>;
  unresolvedByCountry: Record<string, number>;
  byStatus: Record<string, number>;
  byAtsProvider: Record<string, number>;
  byBoardState: Record<string, number>;
  byHiringSourceClassification: Record<string, number>;
  byIndustry: Record<string, number>;
  bySponsorshipEvidence: Record<string, number>;
  bySource: Record<string, number>;
  enabled: number;
  unresolved: number;
  rejected: number;
  duplicates: number;
  verificationFailures: number;
  sharedCareerBoards: number;
};

export type CompanySourceDetection = {
  detection?: DetectedCareerSource;
  detections: DetectedCareerSource[];
  evidence: string[];
  checkedAt: string;
};

export async function loadCompanySourceRecords(
  directory = path.resolve(process.cwd(), "data/company-sources"),
): Promise<CompanySourceRecord[]> {
  const files = await collectJsonFiles(directory);
  const records: CompanySourceRecord[] = [];
  for (const file of files) {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    const defaults =
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "defaults" in value &&
      (value as { defaults?: unknown }).defaults &&
      typeof (value as { defaults: unknown }).defaults === "object"
        ? ((value as { defaults: Record<string, unknown> }).defaults ?? {})
        : {};
    const entries = Array.isArray(value)
      ? value
      : value && typeof value === "object" && "records" in value
        ? (value as { records: unknown }).records
        : value;
    if (!Array.isArray(entries))
      throw new Error(`${file} must contain a JSON record array.`);
    records.push(
      ...entries.map((entry) => {
        const expanded =
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? { ...defaults, ...entry }
            : entry;
        if (
          expanded &&
          typeof expanded === "object" &&
          !Array.isArray(expanded) &&
          !("sourceUrl" in expanded) &&
          typeof (expanded as { websiteUrl?: unknown }).websiteUrl === "string"
        )
          (expanded as { sourceUrl: string }).sourceUrl = (
            expanded as { websiteUrl: string }
          ).websiteUrl;
        return companySourceRecordSchema.parse(expanded);
      }),
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
  return targetCompanySchema.parse({
    ...company,
    companyDomain: normaliseDomain(websiteUrl),
    websiteUrl,
    careersUrl,
    atsProvider: company.atsProvider ?? (careersUrl ? "custom" : undefined),
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
  const verificationRunId = store.startCompanyVerificationRun(company);
  const checkedAt = new Date().toISOString();
  let working = company;
  try {
    let genericInspection:
      Awaited<ReturnType<typeof crawlOfficialCareersSite>> | undefined;
    if (!working.atsProvider || working.atsProvider === "custom") {
      const directDetection = working.careersUrl
        ? detectCareerSource(working.careersUrl, {
            confidence: "high",
            evidence: [
              "The saved careers URL is a recognised public ATS board.",
            ],
          })
        : undefined;
      if (directDetection?.identifier) {
        working = recordCompanySourceDetection(working, {
          detection: directDetection,
          detections: [directDetection],
          evidence: directDetection.evidence,
          checkedAt,
        });
        working = applyDetectedSource(working, directDetection);
      } else if (working.careersUrl) {
        genericInspection = await crawlOfficialCareersSite(working.careersUrl, {
          maxDepth: 1,
          maxPages: 10,
        });
        const detection = {
          detection: genericInspection.detectedSources.find(
            (item) => item.confidence === "high",
          ),
          detections: genericInspection.detectedSources,
          evidence: genericInspection.detectedSources.flatMap(
            (item) => item.evidence,
          ),
          checkedAt,
        };
        working = recordCompanySourceDetection(working, detection);
        const handoff = selectSupportedCareerHandoff(detection.detections);
        if (handoff.handoff) {
          working = applyDetectedSource(working, handoff.handoff);
        } else if (handoff.ambiguous) {
          const result = verificationResult({
            sourceReachable: true,
            responseValid: true,
            sourceIdentityMatchesCompany: false,
            boardState: "unsupported",
            jobsParsed: 0,
            evidence: [
              "More than one supported ATS board was linked from the official careers page.",
              "A reviewer must select the canonical board before monitoring is enabled.",
              ...handoff.ambiguous.flatMap((item) => item.evidence),
              `Detected at ${checkedAt}.`,
            ],
            checkedAt,
          });
          return persistVerificationResult(
            store,
            verificationRunId,
            working,
            result,
            "Multiple supported ATS boards require manual selection.",
          );
        } else {
          const unsupported = genericInspection.detectedSources.find(
            (item) => item.confidence === "high" && !item.ingestible,
          );
          if (
            unsupported &&
            genericInspection.jobs.length === 0 &&
            genericInspection.discoveredUrls.length === 0
          ) {
            const result = verificationResult({
              sourceReachable: true,
              responseValid: true,
              sourceIdentityMatchesCompany: true,
              boardState: "unsupported",
              jobsParsed: 0,
              evidence: unsupported.evidence,
              checkedAt,
            });
            return persistVerificationResult(
              store,
              verificationRunId,
              working,
              result,
              `${unsupported.provider} is detected but not ingestible.`,
            );
          }
        }
      }
    }

    let references: Awaited<ReturnType<JobSourceConnector["discoverJobs"]>> =
      [];
    let evidence: string[] = [];
    if (working.atsProvider && working.atsProvider !== "custom") {
      const connector =
        connectors[working.atsProvider] ?? defaults[working.atsProvider];
      if (!connector)
        throw new Error(
          `${working.atsProvider} is detection-only and cannot ingest jobs.`,
        );
      if (!working.atsIdentifier)
        throw new Error("A validated ATS identifier is required.");
      references = await connector.discoverJobs({
        profile: store.getProfile(),
        company: working,
        maximumJobs: 1,
      });
      evidence = [
        `Valid ${working.atsProvider} public source response.`,
        `ATS identifier: ${working.atsIdentifier}`,
        ...(working.corporateCareersUrl
          ? [`Linked from ${working.corporateCareersUrl}.`]
          : []),
        ...selectedSourceEvidence(working, checkedAt),
      ];
    } else {
      if (!working.careersUrl)
        throw new Error("A verified official careers URL is required.");
      genericInspection ??= await crawlOfficialCareersSite(working.careersUrl, {
        maxDepth: 1,
        maxPages: 10,
      });
      if (genericInspection.blocked)
        throw new Error(
          "Careers page is blocked by CAPTCHA or bot protection.",
        );
      if (!genericInspection.careersPurposeConfirmed)
        throw new Error(
          "Official page did not contain enough careers-purpose evidence.",
        );
      references = connectors.custom
        ? await connectors.custom.discoverJobs({
            profile: store.getProfile(),
            company: working,
            maximumJobs: 1,
          })
        : genericInspection.jobs.slice(0, 1).map((job) => ({
            sourceType: "company-careers" as const,
            sourceName: `Official careers · ${working.displayName}`,
            externalId: createHash("sha256")
              .update(job.url)
              .digest("hex")
              .slice(0, 24),
            url: job.url,
            company: working.displayName,
            title: job.title,
            locationText: job.locationText,
            publishedAt: job.publishedAt,
            raw: job,
          }));
      evidence = [
        `Official careers page is reachable: ${working.careersUrl}`,
        `${genericInspection.pagesVisited} bounded page(s) inspected.`,
        "Careers-purpose language was confirmed.",
      ];
    }

    const identityMatches = sourceIdentityMatchesCompany(working, references);
    const result = verificationResult({
      sourceReachable: true,
      responseValid: true,
      sourceIdentityMatchesCompany: identityMatches,
      boardState: identityMatches
        ? references.length > 0
          ? "active-with-jobs"
          : "active-empty"
        : "wrong-company",
      jobsParsed: references.length,
      sampleJobUrl: references[0]?.url,
      sampleExternalId: references[0]?.externalId,
      evidence: identityMatches
        ? evidence
        : [
            ...evidence,
            "Source identity did not match the company name or aliases.",
          ],
      checkedAt,
    });
    if (!identityMatches)
      return persistVerificationResult(
        store,
        verificationRunId,
        working,
        result,
        "Source belongs to another company.",
      );
    const verified = targetCompanySchema.parse({
      ...working,
      verificationStatus: working.enabled ? "monitored" : "source-verified",
      boardState: result.boardState,
      lastVerification: result,
      sharedCareerBoardKey: careerBoardKey(working),
      lastCheckedAt: checkedAt,
      verificationFailureCount: 0,
      nextVerificationAt: undefined,
      verificationError: undefined,
    });
    store.saveCompany(verified);
    store.finishCompanyVerificationRun(verificationRunId, verified, undefined, {
      ...result,
    });
    return verified;
  } catch (error) {
    const classified = classifyVerificationError(error, checkedAt);
    return persistVerificationResult(
      store,
      verificationRunId,
      working,
      classified,
      formatError(error),
    );
  }
}

export async function detectCompanySource(
  company: TargetCompany,
  options: {
    fetchImpl?: typeof fetch;
    lookup?: (hostname: string) => Promise<string[]>;
  } = {},
): Promise<CompanySourceDetection> {
  const checkedAt = new Date().toISOString();
  const sourceUrl =
    company.corporateCareersUrl ??
    company.careersUrl ??
    company.websiteUrl ??
    (company.companyDomain ? `https://${company.companyDomain}/` : undefined);
  if (!sourceUrl)
    return {
      detections: [],
      evidence: ["No official or careers URL is available for inspection."],
      checkedAt,
    };
  const direct = detectCareerSource(sourceUrl, {
    confidence: "high",
    evidence: ["The saved careers URL is a recognised ATS URL."],
  });
  if (direct)
    return {
      detection: direct,
      detections: [direct],
      evidence: direct.evidence,
      checkedAt,
    };
  const inspection = await crawlOfficialCareersSite(sourceUrl, {
    ...options,
    maxDepth: 0,
    maxPages: 1,
  });
  const detection = inspection.detectedSources.find(
    (item) => item.confidence === "high",
  );
  return {
    detection,
    detections: inspection.detectedSources,
    evidence: [
      `Inspected official source ${sourceUrl}.`,
      ...(detection?.evidence ?? ["No recognised ATS link was found."]),
    ],
    checkedAt,
  };
}

export function recordCompanySourceDetection(
  company: TargetCompany,
  detection: CompanySourceDetection,
): TargetCompany {
  return targetCompanySchema.parse({
    ...company,
    sourceDetections: detection.detections,
    sourceDetectionCheckedAt: detection.checkedAt,
  });
}

export function selectSupportedCareerHandoff(
  detections: DetectedCareerSource[],
): {
  handoff?: DetectedCareerSource;
  ambiguous?: DetectedCareerSource[];
} {
  const supported = detections.filter(
    (item) =>
      item.confidence === "high" && item.ingestible && Boolean(item.identifier),
  );
  if (supported.length === 1) return { handoff: supported[0] };
  if (supported.length > 1) return { ambiguous: supported };
  return {};
}

export function enableVerifiedCompanies(
  store: JobCopilotStore,
  options: {
    dryRun?: boolean;
    country?: string;
    provider?: TargetCompany["atsProvider"];
    company?: string;
    companyIds?: string[];
    limit?: number;
  } = {},
): {
  planned: Array<{ id: string; company: string; boardState: string }>;
  changed: string[];
  errors: Array<{ id: string; error: string }>;
} {
  const candidates = store
    .listCompanies()
    .filter(
      (company) =>
        company.verificationStatus === "source-verified" &&
        ["active-with-jobs", "active-empty"].includes(
          company.boardState ?? "",
        ) &&
        !company.enabled,
    )
    .filter(
      (company) =>
        !options.country ||
        company.operatingCountries.includes(options.country) ||
        company.hiringCountries.includes(options.country),
    )
    .filter(
      (company) =>
        !options.provider || company.atsProvider === options.provider,
    )
    .filter(
      (company) =>
        !options.company ||
        company.id === options.company ||
        normaliseCompanyName(company.displayName) ===
          normaliseCompanyName(options.company),
    )
    .filter(
      (company) =>
        !options.companyIds ||
        options.companyIds.length === 0 ||
        options.companyIds.includes(company.id),
    )
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
  const planned = candidates.map((company) => ({
    id: company.id,
    company: company.displayName,
    boardState: company.boardState!,
  }));
  const changed: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  if (!options.dryRun) {
    for (const company of candidates) {
      try {
        store.saveCompany({
          ...company,
          enabled: true,
          verificationStatus: "monitored",
        });
        changed.push(company.id);
      } catch (error) {
        errors.push({ id: company.id, error: formatError(error) });
      }
    }
  }
  return { planned, changed, errors };
}

function persistVerificationResult(
  store: JobCopilotStore,
  verificationRunId: string,
  company: TargetCompany,
  result: CompanySourceVerificationResult,
  error?: string,
): TargetCompany {
  const wasVerified = ["source-verified", "monitored"].includes(
    company.verificationStatus,
  );
  const successful = ["active-with-jobs", "active-empty"].includes(
    result.boardState,
  );
  const temporary = result.boardState === "temporarily-unavailable";
  const failureCount = successful ? 0 : company.verificationFailureCount + 1;
  const failed = targetCompanySchema.parse({
    ...company,
    enabled: successful
      ? company.enabled
      : temporary && wasVerified
        ? company.enabled
        : false,
    verificationStatus: successful
      ? company.enabled
        ? "monitored"
        : "source-verified"
      : temporary
        ? wasVerified
          ? company.verificationStatus
          : "temporarily-failing"
        : company.careersUrl
          ? "careers-page-found"
          : company.companyDomain
            ? "domain-resolved"
            : "candidate",
    boardState: result.boardState,
    lastVerification: result,
    lastCheckedAt: result.checkedAt,
    verificationFailureCount: failureCount,
    nextVerificationAt: temporary
      ? verificationRetryAt(failureCount, result.checkedAt)
      : undefined,
    verificationError: error,
  });
  store.saveCompany(failed);
  store.finishCompanyVerificationRun(
    verificationRunId,
    failed,
    successful ? undefined : (error ?? result.boardState),
    { ...result },
  );
  return failed;
}

function verificationResult(
  input: CompanySourceVerificationResult,
): CompanySourceVerificationResult {
  return input;
}

function classifyVerificationError(
  error: unknown,
  checkedAt: string,
): CompanySourceVerificationResult {
  const message = formatError(error);
  const boardState: CompanySourceVerificationResult["boardState"] =
    /(?:captcha|verify you are human|bot protection|access denied|HTTP 403)/i.test(
      message,
    )
      ? "blocked"
      : /(?:detection-only|not ingestible|unsupported content type)/i.test(
            message,
          )
        ? "unsupported"
        : /(?:HTTP 404|invalid .*identifier|unsupported characters|required)/i.test(
              message,
            )
          ? "invalid"
          : "temporarily-unavailable";
  return verificationResult({
    sourceReachable: !/(?:resolve|network|timed out|failed: fetch)/i.test(
      message,
    ),
    responseValid: false,
    sourceIdentityMatchesCompany: false,
    boardState,
    jobsParsed: 0,
    evidence: [message],
    checkedAt,
  });
}

function applyDetectedSource(
  company: TargetCompany,
  detected: DetectedCareerSource,
): TargetCompany {
  return targetCompanySchema.parse({
    ...company,
    corporateCareersUrl:
      company.corporateCareersUrl ??
      (company.careersUrl !== detected.sourceUrl
        ? company.careersUrl
        : undefined),
    atsProvider: detected.provider,
    atsIdentifier: detected.identifier,
    atsBoardUrl: detected.sourceUrl,
    sharedCareerBoardKey: `${detected.provider}:${detected.identifier}`,
  });
}

function selectedSourceEvidence(
  company: TargetCompany,
  checkedAt: string,
): string[] {
  const detection = company.sourceDetections.find(
    (item) =>
      item.confidence === "high" &&
      item.provider === company.atsProvider &&
      item.identifier === company.atsIdentifier &&
      item.sourceUrl === company.atsBoardUrl,
  );
  return detection ? [...detection.evidence, `Detected at ${checkedAt}.`] : [];
}

function sourceIdentityMatchesCompany(
  company: TargetCompany,
  references: Awaited<ReturnType<JobSourceConnector["discoverJobs"]>>,
): boolean {
  const names = [
    company.legalName,
    company.displayName,
    company.name,
    ...company.aliases,
  ].map(normaliseCompanyName);
  const observed = references
    .flatMap((reference) => {
      const raw =
        reference.raw && typeof reference.raw === "object"
          ? (reference.raw as Record<string, unknown>)
          : {};
      return [
        raw.company_name,
        raw.companyName,
        raw.company,
        raw.hiringOrganization &&
        typeof raw.hiringOrganization === "object" &&
        !Array.isArray(raw.hiringOrganization)
          ? (raw.hiringOrganization as Record<string, unknown>).name
          : undefined,
      ];
    })
    .filter((value): value is string => typeof value === "string")
    .map(normaliseCompanyName);
  if (observed.length > 0)
    return observed.some((value) =>
      names.some(
        (name) =>
          value === name ||
          (value.length >= 4 &&
            name.length >= 4 &&
            (value.includes(name) || name.includes(value))),
      ),
    );
  if (
    company.corporateCareersUrl &&
    company.sourceDetections.some(
      (item) =>
        item.confidence === "high" &&
        item.provider === company.atsProvider &&
        item.identifier === company.atsIdentifier &&
        item.sourceUrl === company.atsBoardUrl,
    )
  )
    return true;
  if (!company.careersUrl || !company.companyDomain) return false;
  const careersHost = new URL(company.careersUrl).hostname.replace(
    /^www\./,
    "",
  );
  return (
    careersHost === company.companyDomain ||
    careersHost.endsWith(`.${company.companyDomain}`)
  );
}

function careerBoardKey(company: TargetCompany): string | undefined {
  if (company.atsProvider && company.atsIdentifier)
    return `${company.atsProvider}:${company.atsIdentifier}`;
  return company.careersUrl
    ? `custom:${canonicalisePublicUrl(company.careersUrl)}`
    : undefined;
}

function verificationRetryAt(failureCount: number, checkedAt: string): string {
  const delayMinutes = Math.min(
    24 * 60,
    5 * 2 ** Math.min(8, Math.max(0, failureCount - 1)),
  );
  return new Date(
    new Date(checkedAt).getTime() + delayMinutes * 60_000,
  ).toISOString();
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
    sourceVerifiedWithJobs: companies.filter(
      (company) =>
        ["source-verified", "monitored"].includes(company.verificationStatus) &&
        company.boardState === "active-with-jobs",
    ).length,
    sourceVerifiedEmpty: companies.filter(
      (company) =>
        ["source-verified", "monitored"].includes(company.verificationStatus) &&
        company.boardState === "active-empty",
    ).length,
    monitored: companies.filter(
      (company) => company.verificationStatus === "monitored",
    ).length,
    temporarilyFailing: companies.filter(
      (company) => company.verificationStatus === "temporarily-failing",
    ).length,
    temporarilyUnavailable: companies.filter(
      (company) => company.boardState === "temporarily-unavailable",
    ).length,
    blockedOrUnsupported: companies.filter((company) =>
      ["blocked", "unsupported"].includes(company.boardState ?? ""),
    ).length,
    invalidSources: companies.filter((company) =>
      ["invalid", "wrong-company"].includes(company.boardState ?? ""),
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
    byBoardState: countMany(
      companies.map((company) => company.boardState ?? "not-checked"),
    ),
    byHiringSourceClassification: countMany(
      companies.map((company) => company.hiringSourceClassification),
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
    sharedCareerBoards: countSharedCareerBoards(companies),
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
      path.join(directory, "company-source-repair-summary.json"),
      `${JSON.stringify(stats, null, 2)}\n`,
    ),
    fs.writeFile(
      path.join(directory, "company-source-repair-summary.md"),
      renderStatsMarkdown(stats).replace(
        "# Company registry summary",
        "# Company source repair summary",
      ),
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
      path.join(directory, "verified-company-sources.csv"),
      renderCompanySourceCsv(
        companies.filter((company) =>
          ["source-verified", "monitored"].includes(company.verificationStatus),
        ),
      ),
    ),
    fs.writeFile(
      path.join(directory, "active-empty-company-sources.csv"),
      renderCompanySourceCsv(
        companies.filter((company) => company.boardState === "active-empty"),
      ),
    ),
    fs.writeFile(
      path.join(directory, "unsupported-company-sources.csv"),
      renderCompanySourceCsv(
        companies.filter((company) =>
          ["blocked", "unsupported"].includes(company.boardState ?? ""),
        ),
      ),
    ),
    fs.writeFile(
      path.join(directory, "temporarily-failing-sources.csv"),
      renderCompanySourceCsv(
        companies.filter(
          (company) =>
            company.boardState === "temporarily-unavailable" ||
            company.verificationStatus === "temporarily-failing",
        ),
      ),
    ),
    fs.writeFile(
      path.join(directory, "invalid-ats-identifiers.csv"),
      renderCompanySourceCsv(
        companies.filter((company) =>
          ["invalid", "wrong-company"].includes(company.boardState ?? ""),
        ),
      ),
    ),
    fs.writeFile(
      path.join(directory, "shared-career-boards.csv"),
      renderSharedCareerBoardsCsv(companies),
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
      const updatedCompany = targetCompanySchema.parse({
        ...company,
        companyDomain: domain ?? company.companyDomain,
        websiteUrl: domain ? `https://${domain}/` : company.websiteUrl,
        careersUrl,
        atsProvider:
          row.atsProvider ||
          company.atsProvider ||
          (careersUrl ? "custom" : undefined),
        atsIdentifier: row.atsIdentifier || company.atsIdentifier,
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
    atsProvider: existing?.atsProvider ?? (careersUrl ? "custom" : undefined),
    atsIdentifier: existing?.atsIdentifier,
    atsBoardUrl: existing?.atsBoardUrl ?? record.atsBoardUrl,
    sourceType: existing?.sourceType ?? record.sourceType,
    sourceRecords: [
      ...new Map(
        [...(existing?.sourceRecords ?? []), sourceReference].map((item) => [
          `${item.sourceName}:${item.sourceRecordId}`,
          item,
        ]),
      ).values(),
    ],
    hiringSourceClassification:
      existing?.hiringSourceClassification ??
      record.hiringSourceClassification ??
      inferHiringSourceClassification(record),
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

function inferHiringSourceClassification(
  record: CompanySourceRecord,
): TargetCompany["hiringSourceClassification"] {
  const normalized = normaliseCompanyName(record.legalName);
  if (normalized === "dicetek" || normalized === "hcltech")
    return "staffing-consultancy";
  if (
    normalized === "discovered" ||
    normalized === "discovered mena" ||
    normalized === "nameless ventures"
  )
    return "recruitment-agency";
  if (normalized === "qureos") return "job-platform";
  if (
    [
      "official-sponsor-register",
      "official-permit-list",
      "government-open-data",
    ].includes(record.sourceType)
  )
    return "government-portal";
  if (record.sourceType === "government-startup-ecosystem")
    return "ecosystem-directory";
  if (
    ["official-company-page", "verified-curated-list"].includes(
      record.sourceType,
    )
  )
    return "direct-employer";
  return "unknown";
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

function countSharedCareerBoards(companies: TargetCompany[]): number {
  const counts = countMany(
    companies
      .map((company) => company.sharedCareerBoardKey)
      .filter((value): value is string => Boolean(value)),
  );
  return Object.values(counts).filter((count) => count > 1).length;
}

function renderStatsMarkdown(stats: CompanyRegistryStats): string {
  return `# Company registry summary\n\nGenerated: ${new Date().toISOString()}\n\nCounts describe the database used for this report. A company may appear in more than one country row; headline counts are unique companies. “Unresolved” means the candidate workflow state, not merely a missing domain.\n\n- Source records: ${stats.totalSourceRecords}\n- Unique companies: ${stats.totalCompanies}\n- Candidate companies: ${stats.candidateCompanies}\n- Domain resolved: ${stats.domainResolved}\n- Careers pages found: ${stats.careersPageFound}\n- Source verified: ${stats.sourceVerified}\n- Source verified with jobs: ${stats.sourceVerifiedWithJobs}\n- Source verified but empty: ${stats.sourceVerifiedEmpty}\n- Monitored: ${stats.monitored}\n- Temporarily failing: ${stats.temporarilyFailing}\n- Temporarily unavailable: ${stats.temporarilyUnavailable}\n- Blocked or unsupported: ${stats.blockedOrUnsupported}\n- Invalid or wrong-company: ${stats.invalidSources}\n- Inactive: ${stats.inactive}\n- Unresolved: ${stats.unresolved}\n- Rejected: ${stats.rejected}\n- Shared career boards: ${stats.sharedCareerBoards}\n- Duplicate candidates: ${stats.duplicates}\n\n## Companies by country\n\n${renderCountTable(stats.byCountry)}\n\n## Verified by country\n\n${renderCountTable(stats.verifiedByCountry)}\n\n## Monitored by country\n\n${renderCountTable(stats.monitoredByCountry)}\n\n## Unresolved by country\n\n${renderCountTable(stats.unresolvedByCountry)}\n\n## By verification status\n\n${renderCountTable(stats.byStatus)}\n\n## By board state\n\n${renderCountTable(stats.byBoardState)}\n\n## By ATS provider\n\n${renderCountTable(stats.byAtsProvider)}\n\n## By hiring-source classification\n\n${renderCountTable(stats.byHiringSourceClassification)}\n\n## By industry\n\n${renderCountTable(stats.byIndustry)}\n\n## By sponsorship evidence\n\n${renderCountTable(stats.bySponsorshipEvidence)}\n\n## By source\n\n${renderCountTable(stats.bySource)}\n`;
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

function renderCompanySourceCsv(companies: TargetCompany[]): string {
  return toCsv(
    [
      "id",
      "company",
      "country",
      "classification",
      "provider",
      "identifier",
      "corporateCareersUrl",
      "atsBoardUrl",
      "boardState",
      "status",
      "enabled",
      "lastCheckedAt",
      "error",
    ],
    companies.map((company) => [
      company.id,
      company.displayName,
      company.operatingCountries.join("; "),
      company.hiringSourceClassification,
      company.atsProvider ?? "",
      company.atsIdentifier ?? "",
      company.corporateCareersUrl ?? company.careersUrl ?? "",
      company.atsBoardUrl ?? "",
      company.boardState ?? "",
      company.verificationStatus,
      String(company.enabled),
      company.lastCheckedAt ?? "",
      company.verificationError ?? "",
    ]),
  );
}

function renderSharedCareerBoardsCsv(companies: TargetCompany[]): string {
  const groups = new Map<string, TargetCompany[]>();
  for (const company of companies) {
    if (!company.sharedCareerBoardKey) continue;
    groups.set(company.sharedCareerBoardKey, [
      ...(groups.get(company.sharedCareerBoardKey) ?? []),
      company,
    ]);
  }
  return toCsv(
    ["boardKey", "provider", "identifier", "companies", "countries"],
    [...groups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([key, members]) => [
        key,
        members[0].atsProvider ?? "custom",
        members[0].atsIdentifier ?? "",
        members.map((company) => company.displayName).join("; "),
        [
          ...new Set(members.flatMap((company) => company.operatingCountries)),
        ].join("; "),
      ]),
  );
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
