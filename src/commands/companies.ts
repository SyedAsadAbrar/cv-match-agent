import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  auditCompanyRegistry,
  detectCompanySource,
  enableVerifiedCompanies,
  exportUnresolvedCompanies,
  generateCompanyRegistryStats,
  importCompanyResolutions,
  importCompanySources,
  normaliseCompanyRegistry,
  recordCompanySourceDetection,
  resolveCompany,
  refreshIndSponsorRegister,
  verifyCompanySource,
  writeCompanyRegistryReports,
} from "../company/registry";
import { JobCopilotStore } from "../db/store";
import type { TargetCompany } from "../domain/schemas";
import { logger } from "../utils/logger";

export function createCompaniesCommand(): Command {
  const companies = new Command("companies").description(
    "Maintain the provenance-first company registry.",
  );

  companies
    .command("import")
    .option(
      "--directory <path>",
      "Structured source directory.",
      "data/company-sources",
    )
    .option("--dry-run", "Validate and report without writing.")
    .action(async (options: { directory: string; dryRun?: boolean }) =>
      withStore(async (store) => {
        const runs = await importCompanySources(store, {
          directory: path.resolve(process.cwd(), options.directory),
          dryRun: options.dryRun,
        });
        print(runs);
        if (runs.some((run) => run.status === "failed")) process.exitCode = 1;
      }),
    );

  companies
    .command("normalise")
    .option("--dry-run", "Report changes without writing.")
    .action((options: { dryRun?: boolean }) =>
      withStore((store) =>
        print(normaliseCompanyRegistry(store, options.dryRun)),
      ),
    );

  companies
    .command("resolve")
    .option(
      "--limit <number>",
      "Maximum companies to resolve.",
      parsePositiveInteger,
      25,
    )
    .option("--country <country>", "Only companies operating in a country.")
    .option("--provider <provider>", "Only companies using an ATS provider.")
    .option("--company <idOrName>", "Only one company by ID or exact name.")
    .option("--dry-run", "Resolve without writing changes.")
    .action(
      (options: {
        limit: number;
        country?: string;
        provider?: string;
        company?: string;
        dryRun?: boolean;
      }) =>
        withStore(async (store) => {
          const candidates = filterCompanies(store.listCompanies(), options)
            .filter(
              (company) =>
                ["candidate", "domain-resolved", "careers-page-found"].includes(
                  company.verificationStatus,
                ) && Boolean(company.websiteUrl || company.companyDomain),
            )
            .slice(0, options.limit);
          const results: Array<{
            id: string;
            status: string;
            boardState?: string;
            provider?: string;
            error?: string;
          }> = [];
          for (const company of candidates) {
            try {
              const resolved = await resolveCompany(company);
              if (!options.dryRun) store.saveCompany(resolved);
              results.push({
                id: company.id,
                status: resolved.verificationStatus,
              });
            } catch (error) {
              results.push({
                id: company.id,
                status: "failed",
                error: formatError(error),
              });
            }
          }
          print(results);
          if (results.some((result) => result.error)) process.exitCode = 1;
        }),
    );

  companies
    .command("detect-sources")
    .option(
      "--limit <number>",
      "Maximum companies to inspect.",
      parsePositiveInteger,
      25,
    )
    .option("--country <country>", "Only companies operating in a country.")
    .option("--provider <provider>", "Only companies using an ATS provider.")
    .option("--company <idOrName>", "Only one company by ID or exact name.")
    .option("--dry-run", "Accepted for consistent bulk-command usage.")
    .action(
      (options: {
        limit: number;
        country?: string;
        provider?: string;
        company?: string;
        dryRun?: boolean;
      }) =>
        withStore(async (store) => {
          const results = [];
          for (const company of filterCompanies(
            store.listCompanies(),
            options,
          ).slice(0, options.limit)) {
            try {
              const detection = await detectCompanySource(company);
              if (!options.dryRun)
                store.saveCompany(
                  recordCompanySourceDetection(company, detection),
                );
              results.push({
                id: company.id,
                company: company.displayName,
                detection: detection.detection,
                detections: detection.detections,
              });
            } catch (error) {
              results.push({
                id: company.id,
                company: company.displayName,
                error: formatError(error),
              });
            }
          }
          print(results);
          if (results.some((result) => "error" in result)) process.exitCode = 1;
        }),
    );

  companies
    .command("verify")
    .option(
      "--limit <number>",
      "Maximum companies to verify.",
      parsePositiveInteger,
      25,
    )
    .option("--company <id>", "Verify one company by registry ID.")
    .option("--country <country>", "Only companies operating in a country.")
    .option("--provider <provider>", "Only companies using an ATS provider.")
    .option("--dry-run", "Inspect without persisting verification results.")
    .action(
      (options: {
        limit: number;
        company?: string;
        country?: string;
        provider?: string;
        dryRun?: boolean;
      }) =>
        withStore(async (store) => {
          if (options.dryRun) {
            const candidates = filterCompanies(
              store.listCompanies(),
              options,
            ).slice(0, options.limit);
            print(
              candidates.map((company) => ({
                id: company.id,
                company: company.displayName,
                status: company.verificationStatus,
                provider: company.atsProvider,
              })),
            );
            return;
          }
          const candidates = filterCompanies(store.listCompanies(), options)
            .filter((company) =>
              [
                "careers-page-found",
                "source-verified",
                "monitored",
                "temporarily-failing",
              ].includes(company.verificationStatus),
            )
            .slice(0, options.limit);
          if (options.company && candidates.length === 0)
            throw new Error(`Unknown company ${options.company}.`);
          const results: Array<{
            id: string;
            status: string;
            boardState?: string;
            provider?: string;
            error?: string;
          }> = [];
          for (const company of candidates) {
            try {
              const verified = await verifyCompanySource(store, company);
              results.push({
                id: company.id,
                status: verified.verificationStatus,
                boardState: verified.boardState,
                provider: verified.atsProvider,
              });
            } catch (error) {
              results.push({
                id: company.id,
                status: "temporarily-failing",
                error: formatError(error),
              });
            }
          }
          print(results);
          if (
            results.some(
              (result) =>
                result.error ||
                !["active-with-jobs", "active-empty"].includes(
                  result.boardState ?? "",
                ),
            )
          )
            process.exitCode = 1;
        }),
    );

  companies
    .command("enable-verified")
    .option("--dry-run", "Print changes without writing.")
    .option("--country <country>", "Only companies hiring in a country.")
    .option("--provider <provider>", "Only companies using an ATS provider.")
    .option("--company <idOrName>", "Only one company by ID or exact name.")
    .option(
      "--limit <number>",
      "Maximum companies to enable.",
      parsePositiveInteger,
    )
    .action(
      (options: {
        dryRun?: boolean;
        country?: string;
        provider?: string;
        company?: string;
        limit?: number;
      }) =>
        withStore((store) => {
          const result = enableVerifiedCompanies(store, {
            ...options,
            provider: options.provider as
              | NonNullable<
                  Parameters<typeof enableVerifiedCompanies>[1]
                >["provider"]
              | undefined,
          });
          print(result);
          if (result.errors.length > 0) process.exitCode = 1;
        }),
    );

  companies
    .command("onboard")
    .option("--country <country>", "Only companies operating in a country.")
    .option("--provider <provider>", "Only companies using an ATS provider.")
    .option("--company <idOrName>", "Only one company by ID or exact name.")
    .option(
      "--limit <number>",
      "Maximum companies to resolve and verify.",
      parsePositiveInteger,
      25,
    )
    .option("--dry-run", "Validate and print planned operations only.")
    .option(
      "--enable-verified",
      "Enable valid verified sources after verification.",
    )
    .action(
      (options: {
        country?: string;
        provider?: string;
        company?: string;
        limit: number;
        dryRun?: boolean;
        enableVerified?: boolean;
      }) =>
        withStore(async (store) => {
          const imports = await importCompanySources(store, {
            dryRun: options.dryRun,
          });
          const normalisation = normaliseCompanyRegistry(store, options.dryRun);
          const selected = filterCompanies(
            store.listCompanies(),
            options,
          ).slice(0, options.limit);
          const resolutions: Array<{ id: string; status: string }> = [];
          const detections: Array<{
            id: string;
            detection: Awaited<
              ReturnType<typeof detectCompanySource>
            >["detection"];
          }> = [];
          const verifications: Array<{
            id: string;
            status: string;
            boardState?: string;
            error?: string;
          }> = [];
          for (const company of selected) {
            let current = company;
            try {
              if (
                ["candidate", "domain-resolved", "careers-page-found"].includes(
                  current.verificationStatus,
                ) &&
                (current.websiteUrl || current.companyDomain)
              ) {
                current = await resolveCompany(current);
                if (!options.dryRun) store.saveCompany(current);
              }
              resolutions.push({
                id: current.id,
                status: current.verificationStatus,
              });
              const detection = await detectCompanySource(current);
              if (!options.dryRun) {
                current = recordCompanySourceDetection(current, detection);
                store.saveCompany(current);
              }
              detections.push({
                id: current.id,
                detection: detection.detection,
              });
              if (
                !options.dryRun &&
                current.verificationStatus === "careers-page-found"
              ) {
                current = await verifyCompanySource(store, current);
                verifications.push({
                  id: current.id,
                  status: current.verificationStatus,
                  boardState: current.boardState,
                });
              }
            } catch (error) {
              verifications.push({
                id: current.id,
                status: "failed",
                error: formatError(error),
              });
            }
          }
          const enablement = options.enableVerified
            ? enableVerifiedCompanies(store, {
                ...options,
                dryRun: options.dryRun,
                provider: options.provider as
                  | NonNullable<
                      Parameters<typeof enableVerifiedCompanies>[1]
                    >["provider"]
                  | undefined,
              })
            : { planned: [], changed: [], errors: [] };
          const stats = options.dryRun
            ? generateCompanyRegistryStats(store)
            : await writeCompanyRegistryReports(store);
          print({
            imports,
            normalisation,
            resolutions,
            detections,
            verifications,
            enablement,
            stats,
          });
          if (
            verifications.some((item) => item.error) ||
            enablement.errors.length > 0
          )
            process.exitCode = 1;
        }),
    );

  companies.command("audit").action(() =>
    withStore((store) => {
      const audit = auditCompanyRegistry(store);
      print(audit);
      if (audit.errors.length > 0) process.exitCode = 1;
    }),
  );

  companies
    .command("stats")
    .option(
      "--write-reports",
      "Write JSON, Markdown, and maintenance CSV reports.",
    )
    .action((options: { writeReports?: boolean }) =>
      withStore(async (store) => {
        const stats = options.writeReports
          ? await writeCompanyRegistryReports(store)
          : generateCompanyRegistryStats(store);
        print(stats);
      }),
    );

  companies
    .command("refresh")
    .option(
      "--directory <path>",
      "Structured source directory.",
      "data/company-sources",
    )
    .option("--dry-run", "Validate without writing.")
    .option(
      "--official",
      "Refresh supported live official registers before local snapshots.",
    )
    .action(
      (options: { directory: string; dryRun?: boolean; official?: boolean }) =>
        withStore(async (store) => {
          const officialRuns = options.official
            ? await refreshIndSponsorRegister(store, { dryRun: options.dryRun })
            : [];
          const runs = await importCompanySources(store, {
            directory: path.resolve(process.cwd(), options.directory),
            dryRun: options.dryRun,
          });
          print({
            officialRuns,
            runs,
            stats: generateCompanyRegistryStats(store),
          });
        }),
    );

  companies
    .command("export-unresolved")
    .option(
      "--output <path>",
      "CSV output path.",
      "reports/unresolved-companies.csv",
    )
    .action((options: { output: string }) =>
      withStore(async (store) => {
        const output = path.resolve(process.cwd(), options.output);
        await fs.mkdir(path.dirname(output), { recursive: true });
        await fs.writeFile(output, exportUnresolvedCompanies(store));
        print({ output });
      }),
    );

  companies
    .command("import-resolutions")
    .requiredOption("--file <path>", "Reviewed resolution CSV.")
    .option("--dry-run", "Validate without writing.")
    .action((options: { file: string; dryRun?: boolean }) =>
      withStore(async (store) => {
        const csv = await fs.readFile(
          path.resolve(process.cwd(), options.file),
          "utf8",
        );
        const result = importCompanyResolutions(store, csv, options.dryRun);
        print(result);
        if (result.errors.length) process.exitCode = 1;
      }),
    );

  return companies;
}

async function withStore(
  work: (store: JobCopilotStore) => void | Promise<void>,
): Promise<void> {
  const store = new JobCopilotStore();
  try {
    await work(store);
  } finally {
    store.close();
  }
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error("Expected a positive integer.");
  return parsed;
}

function filterCompanies(
  companies: TargetCompany[],
  options: { country?: string; provider?: string; company?: string },
): TargetCompany[] {
  return companies
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
        company.displayName.localeCompare(options.company, undefined, {
          sensitivity: "accent",
        }) === 0,
    );
}

function print(value: unknown): void {
  logger.info(JSON.stringify(value, null, 2));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
