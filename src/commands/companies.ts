import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  auditCompanyRegistry,
  exportUnresolvedCompanies,
  generateCompanyRegistryStats,
  importCompanyResolutions,
  importCompanySources,
  normaliseCompanyRegistry,
  resolveCompany,
  refreshIndSponsorRegister,
  verifyCompanySource,
  writeCompanyRegistryReports,
} from "../company/registry";
import { JobCopilotStore } from "../db/store";
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
    .option("--dry-run", "Resolve without writing changes.")
    .action((options: { limit: number; dryRun?: boolean }) =>
      withStore(async (store) => {
        const candidates = store
          .listCompanies()
          .filter(
            (company) =>
              ["candidate", "domain-resolved", "careers-page-found"].includes(
                company.verificationStatus,
              ) && Boolean(company.websiteUrl || company.companyDomain),
          )
          .slice(0, options.limit);
        const results: Array<{ id: string; status: string; error?: string }> =
          [];
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
    .command("verify")
    .option(
      "--limit <number>",
      "Maximum companies to verify.",
      parsePositiveInteger,
      25,
    )
    .option("--company <id>", "Verify one company by registry ID.")
    .action((options: { limit: number; company?: string }) =>
      withStore(async (store) => {
        const candidates = store
          .listCompanies()
          .filter((company) =>
            options.company
              ? company.id === options.company
              : [
                  "careers-page-found",
                  "source-verified",
                  "monitored",
                  "temporarily-failing",
                ].includes(company.verificationStatus),
          )
          .slice(0, options.limit);
        if (options.company && candidates.length === 0)
          throw new Error(`Unknown company ${options.company}.`);
        const results: Array<{ id: string; status: string; error?: string }> =
          [];
        for (const company of candidates) {
          try {
            const verified = await verifyCompanySource(store, company);
            results.push({
              id: company.id,
              status: verified.verificationStatus,
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
        if (results.some((result) => result.error)) process.exitCode = 1;
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

function print(value: unknown): void {
  logger.info(JSON.stringify(value, null, 2));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
