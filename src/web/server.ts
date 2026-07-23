import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { z } from "zod";
import { OllamaLocalAIProvider } from "../ai/localAIProvider";
import { updateApplication } from "../applications/tracking";
import {
  detectCompanySource,
  enableVerifiedCompanies,
  exportUnresolvedCompanies,
  generateCompanyRegistryStats,
  importCompanyResolutions,
  recordCompanySourceDetection,
  verifyCompanySource,
} from "../company/registry";
import { canonicalisePublicUrl, normaliseDomain } from "../company/normalise";
import { JobCopilotStore } from "../db/store";
import {
  applicationStatusSchema,
  atsProviderSchema,
  candidateProfileSchema,
  companyBoardStateSchema,
  companyVerificationStatusSchema,
  hiringSourceClassificationSchema,
  targetCompanySchema,
} from "../domain/schemas";
import { runDiscovery } from "../discovery/pipeline";
import { createConfiguredWebSearchProvider } from "../discovery/webSearch";
import { validateCvUpload } from "../security/content";
import { readCvFile } from "../services/readCvFile";

export type WebServerOptions = {
  host?: string;
  port?: number;
  store?: JobCopilotStore;
};

let activeDiscovery: Promise<unknown> | undefined;

export function startWebServer(
  options: WebServerOptions = {},
): Promise<Server> {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? readPort(process.env.PORT, 4310);
  const store = options.store ?? new JobCopilotStore();
  const server = createServer((request, response) => {
    void route(request, response, store).catch((error) => {
      sendJson(response, error instanceof z.ZodError ? 400 : 500, {
        error: formatError(error),
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  store: JobCopilotStore,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  );
  if (method !== "GET" && method !== "HEAD") assertSameOrigin(request);

  if (url.pathname === "/api/dashboard" && method === "GET") {
    const jobs = store.listRankedJobs();
    const today = new Date().toISOString().slice(0, 10);
    return sendJson(response, 200, {
      lastRun: store.getLatestDiscoveryRun(),
      jobsFoundToday: jobs.filter((item) =>
        item.job.firstSeenAt.startsWith(today),
      ).length,
      recommendationCounts: countBy(
        jobs.map((item) => item.match?.recommendation ?? "unanalysed"),
      ),
      jobsNeedingAnalysis: jobs.filter(
        (item) =>
          item.match?.needsDetailedAnalysis && !item.match.detailedAnalysis,
      ).length,
      sourceFailures: store.getLatestDiscoveryRun()?.errors.length ?? 0,
      discoveryRunning: activeDiscovery !== undefined,
    });
  }

  if (url.pathname === "/api/profile" && method === "GET") {
    const profile = store.getProfile();
    return sendJson(response, 200, {
      profile,
      sourceClaims: store.getProfileClaims(profile.id),
    });
  }
  if (url.pathname === "/api/profile" && method === "PUT") {
    const profile = candidateProfileSchema.parse(await readJson(request));
    return sendJson(response, 200, { profile: store.saveProfile(profile) });
  }
  if (url.pathname === "/api/profile/upload" && method === "POST") {
    const input = z
      .object({
        filename: z.string().min(1).max(180),
        dataBase64: z.string().min(1),
      })
      .parse(await readJson(request));
    if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(input.dataBase64))
      throw new Error("CV upload is not valid base64 data.");
    const data = Buffer.from(input.dataBase64, "base64");
    validateCvUpload(input.filename, data.byteLength);
    const extension = path.extname(input.filename).toLowerCase();
    const uploadsDir = path.resolve(process.cwd(), "data/uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const savedPath = path.join(uploadsDir, `${randomUUID()}${extension}`);
    await fs.writeFile(savedPath, data, { mode: 0o600 });
    const text = await readCvFile(savedPath);
    const provider = new OllamaLocalAIProvider();
    const extracted = await provider.extractCandidateProfile(
      text,
      store.getProfile(),
    );
    store.saveProfile(extracted.profile, extracted.sourceClaims);
    return sendJson(response, 200, {
      profile: extracted.profile,
      sourceClaims: extracted.sourceClaims,
    });
  }

  if (url.pathname === "/api/jobs" && method === "GET")
    return sendJson(
      response,
      200,
      store.listRankedJobs({
        includeDismissed: url.searchParams.get("includeDismissed") === "true",
        includeClosed: url.searchParams.get("includeClosed") === "true",
      }),
    );
  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && method === "GET") {
    const job = store.getRankedJob(decodeURIComponent(jobMatch[1]));
    return job
      ? sendJson(response, 200, job)
      : sendJson(response, 404, { error: "Job not found." });
  }
  const jobAction = url.pathname.match(
    /^\/api\/jobs\/([^/]+)\/(save|dismiss|application)$/,
  );
  if (jobAction && method === "POST") {
    const jobId = decodeURIComponent(jobAction[1]);
    const job = store.getRankedJob(jobId);
    if (!job) return sendJson(response, 404, { error: "Job not found." });
    if (jobAction[2] === "save") {
      const { saved } = z
        .object({ saved: z.boolean() })
        .parse(await readJson(request));
      store.setSaved(jobId, saved);
    } else if (jobAction[2] === "dismiss") {
      const { dismissed, reason } = z
        .object({
          dismissed: z.boolean(),
          reason: z.string().max(500).optional(),
        })
        .parse(await readJson(request));
      store.setDismissed(jobId, dismissed, reason);
    } else {
      const update = applicationUpdateSchema.parse(await readJson(request));
      store.saveApplication(
        updateApplication(job.application, jobId, update, job.job.canonicalUrl),
      );
    }
    return sendJson(response, 200, store.getRankedJob(jobId));
  }
  if (url.pathname === "/api/applications" && method === "GET")
    return sendJson(response, 200, store.listApplications());

  if (url.pathname === "/api/sources" && method === "GET")
    return sendJson(response, 200, {
      sourceStatuses: store.listSourceStatuses(),
      registryStats: generateCompanyRegistryStats(store),
      importRuns: store.listCompanyImportRuns(),
      verificationRuns: store.listCompanyVerificationRuns(),
      lastRun: store.getLatestDiscoveryRun(),
    });
  if (url.pathname === "/api/companies" && method === "GET") {
    const status = url.searchParams.get("status") || undefined;
    const atsProvider = url.searchParams.get("atsProvider") || undefined;
    return sendJson(
      response,
      200,
      store.listCompaniesPage({
        page: Number(url.searchParams.get("page") ?? 1),
        pageSize: Number(url.searchParams.get("pageSize") ?? 25),
        country: url.searchParams.get("country") || undefined,
        status: status
          ? companyVerificationStatusSchema.parse(status)
          : undefined,
        atsProvider: atsProvider
          ? atsProviderSchema.parse(atsProvider)
          : undefined,
        sponsorshipEvidence:
          (url.searchParams.get("sponsorshipEvidence") as
            | "confirmed"
            | "historical"
            | "possible"
            | "unknown"
            | "unlikely"
            | null) ?? undefined,
        engineeringRelevance: z
          .enum(["high", "medium", "low", "unknown"])
          .optional()
          .parse(url.searchParams.get("engineeringRelevance") || undefined),
        enabled: url.searchParams.has("enabled")
          ? url.searchParams.get("enabled") === "true"
          : undefined,
        boardState: url.searchParams.has("boardState")
          ? companyBoardStateSchema.parse(url.searchParams.get("boardState"))
          : undefined,
        hiringSourceClassification: url.searchParams.has(
          "hiringSourceClassification",
        )
          ? hiringSourceClassificationSchema.parse(
              url.searchParams.get("hiringSourceClassification"),
            )
          : undefined,
        search: url.searchParams.get("search") || undefined,
      }),
    );
  }
  if (url.pathname === "/api/companies/enable-verified" && method === "POST") {
    const body = z
      .object({
        companyIds: z.array(z.string()).default([]),
        country: z.string().optional(),
        provider: atsProviderSchema.optional(),
        dryRun: z.boolean().default(false),
      })
      .parse(await readJson(request));
    const result = enableVerifiedCompanies(store, body);
    return sendJson(response, result.errors.length ? 409 : 200, result);
  }
  if (url.pathname === "/api/companies/unresolved.csv" && method === "GET") {
    const csv = exportUnresolvedCompanies(store);
    response.writeHead(
      200,
      securityHeaders({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="unresolved-companies.csv"',
        "Content-Length": String(Buffer.byteLength(csv)),
      }),
    );
    response.end(csv);
    return;
  }
  if (url.pathname === "/api/companies/resolutions" && method === "POST") {
    const { csv } = z
      .object({ csv: z.string().max(5_000_000) })
      .parse(await readJson(request));
    const result = importCompanyResolutions(store, csv);
    return sendJson(response, result.errors.length ? 400 : 200, result);
  }
  if (url.pathname === "/api/companies" && method === "POST") {
    const body = z
      .object({
        name: z.string().trim().min(1),
        companyDomain: z.string().trim().min(1).optional(),
        careersUrl: z.string().url().optional(),
        countries: z.array(z.string()).default([]),
        industries: z.array(z.string()).default([]),
        atsProvider: atsProviderSchema.optional(),
        atsIdentifier: z.string().trim().min(1).optional(),
        evidenceUrl: z.string().url(),
        notes: z.string().max(5_000).optional(),
      })
      .parse(await readJson(request));
    const now = new Date().toISOString();
    const company = targetCompanySchema.parse({
      id: randomUUID(),
      ...body,
      companyDomain: normaliseDomain(body.companyDomain),
      websiteUrl: body.companyDomain
        ? `https://${normaliseDomain(body.companyDomain)}/`
        : undefined,
      atsProvider: body.atsProvider ?? (body.careersUrl ? "custom" : undefined),
      atsIdentifier: body.atsIdentifier,
      sourceType: "manual-resolution",
      sourceRecords: [
        {
          sourceRecordId: randomUUID(),
          sourceType: "manual-resolution",
          sourceName: "Manual company entry",
          sourceUrl: body.evidenceUrl,
          sourceRetrievedAt: now,
        },
      ],
      sponsorshipEvidence: "unknown",
      sponsorshipEvidenceSources: [],
      verificationStatus: body.careersUrl
        ? "careers-page-found"
        : body.companyDomain
          ? "domain-resolved"
          : "candidate",
      enabled: false,
      discoveredAt: now,
    });
    return sendJson(response, 201, store.saveCompany(company));
  }
  const companyMatch = url.pathname.match(/^\/api\/companies\/([^/]+)$/);
  if (companyMatch && method === "PUT") {
    const company = targetCompanySchema.parse(await readJson(request));
    if (company.id !== decodeURIComponent(companyMatch[1]))
      throw new Error("Company ID does not match the URL.");
    return sendJson(response, 200, store.saveCompany(company));
  }
  const companyResolve = url.pathname.match(
    /^\/api\/companies\/([^/]+)\/resolve$/,
  );
  if (companyResolve && method === "POST") {
    const companyId = decodeURIComponent(companyResolve[1]);
    const company = store.listCompanies().find((item) => item.id === companyId);
    if (!company)
      return sendJson(response, 404, { error: "Company not found." });
    const body = z
      .object({
        officialDomain: z.string().trim().min(1).optional(),
        careersUrl: z.string().url().optional(),
        atsProvider: atsProviderSchema.optional(),
        atsIdentifier: z.string().trim().min(1).optional(),
        evidenceUrl: z.string().url(),
        notes: z.string().max(5_000).optional(),
      })
      .parse(await readJson(request));
    const domain =
      normaliseDomain(body.officialDomain) ?? company.companyDomain;
    const careersUrl = body.careersUrl
      ? canonicalisePublicUrl(body.careersUrl)
      : company.careersUrl;
    const updated = targetCompanySchema.parse({
      ...company,
      companyDomain: domain,
      websiteUrl: domain ? `https://${domain}/` : company.websiteUrl,
      careersUrl,
      atsProvider:
        body.atsProvider ??
        company.atsProvider ??
        (careersUrl ? "custom" : undefined),
      atsIdentifier: body.atsIdentifier ?? company.atsIdentifier,
      verificationStatus: careersUrl
        ? "careers-page-found"
        : domain
          ? "domain-resolved"
          : "candidate",
      enabled: false,
      resolvedAt: new Date().toISOString(),
      notes: body.notes ?? company.notes,
      sourceRecords: [
        ...company.sourceRecords,
        {
          sourceRecordId: randomUUID(),
          sourceType: "manual-resolution",
          sourceName: "Manual resolution",
          sourceUrl: body.evidenceUrl,
          sourceRetrievedAt: new Date().toISOString(),
        },
      ],
    });
    return sendJson(response, 200, store.saveCompany(updated));
  }
  const companyVerify = url.pathname.match(
    /^\/api\/companies\/([^/]+)\/verify$/,
  );
  if (companyVerify && method === "POST") {
    const company = store
      .listCompanies()
      .find((item) => item.id === decodeURIComponent(companyVerify[1]));
    if (!company)
      return sendJson(response, 404, { error: "Company not found." });
    return sendJson(response, 200, await verifyCompanySource(store, company));
  }
  const companyDetect = url.pathname.match(
    /^\/api\/companies\/([^/]+)\/detect$/,
  );
  if (companyDetect && method === "POST") {
    const company = store
      .listCompanies()
      .find((item) => item.id === decodeURIComponent(companyDetect[1]));
    if (!company)
      return sendJson(response, 404, { error: "Company not found." });
    const detection = await detectCompanySource(company);
    const persisted = store.saveCompany(
      recordCompanySourceDetection(company, detection),
    );
    return sendJson(response, 200, { ...detection, company: persisted });
  }
  const companyReject = url.pathname.match(
    /^\/api\/companies\/([^/]+)\/reject$/,
  );
  if (companyReject && method === "POST") {
    const company = store
      .listCompanies()
      .find((item) => item.id === decodeURIComponent(companyReject[1]));
    if (!company)
      return sendJson(response, 404, { error: "Company not found." });
    return sendJson(
      response,
      200,
      store.saveCompany({
        ...company,
        enabled: false,
        verificationStatus: "rejected",
      }),
    );
  }
  const companyMerge = url.pathname.match(/^\/api\/companies\/([^/]+)\/merge$/);
  if (companyMerge && method === "POST") {
    const sourceId = decodeURIComponent(companyMerge[1]);
    const { targetCompanyId } = z
      .object({ targetCompanyId: z.string().min(1) })
      .parse(await readJson(request));
    const companies = store.listCompanies();
    const source = companies.find((item) => item.id === sourceId);
    const target = companies.find((item) => item.id === targetCompanyId);
    if (!source || !target)
      return sendJson(response, 404, { error: "Merge company not found." });
    if (source.id === target.id)
      return sendJson(response, 400, {
        error: "A company cannot be merged into itself.",
      });
    const merged = targetCompanySchema.parse({
      ...target,
      aliases: [
        ...new Set([
          ...target.aliases,
          source.displayName,
          source.legalName,
          ...source.aliases,
        ]),
      ],
      operatingCountries: [
        ...new Set([
          ...target.operatingCountries,
          ...source.operatingCountries,
        ]),
      ],
      hiringCountries: [
        ...new Set([...target.hiringCountries, ...source.hiringCountries]),
      ],
      knownCities: [...new Set([...target.knownCities, ...source.knownCities])],
      industries: [...new Set([...target.industries, ...source.industries])],
      sourceRecords: [
        ...new Map(
          [...target.sourceRecords, ...source.sourceRecords].map((item) => [
            `${item.sourceName}:${item.sourceRecordId}`,
            item,
          ]),
        ).values(),
      ],
    });
    store.saveCompany(merged);
    store.saveCompany({
      ...source,
      enabled: false,
      verificationStatus: "rejected",
      notes: [source.notes, `Merged into ${target.id}.`]
        .filter(Boolean)
        .join("\n"),
    });
    return sendJson(response, 200, merged);
  }
  const companySync = url.pathname.match(/^\/api\/companies\/([^/]+)\/sync$/);
  if (companySync && method === "POST") {
    const company = store
      .listCompanies()
      .find((item) => item.id === decodeURIComponent(companySync[1]));
    if (!company)
      return sendJson(response, 404, { error: "Company not found." });
    if (
      !company.enabled ||
      !["source-verified", "monitored"].includes(company.verificationStatus)
    )
      return sendJson(response, 409, {
        error: "Only enabled, verified company sources can be synced.",
      });
    if (activeDiscovery)
      return sendJson(response, 409, {
        error: "A discovery run is already active.",
      });
    activeDiscovery = runDiscovery({
      store,
      companies: [company],
      webSearchProvider: undefined,
      localAI: new OllamaLocalAIProvider(),
    }).finally(() => {
      activeDiscovery = undefined;
    });
    return sendJson(response, 202, {
      status: "running",
      run: store.getLatestDiscoveryRun(),
    });
  }

  if (url.pathname === "/api/discovery" && method === "POST") {
    if (activeDiscovery)
      return sendJson(response, 409, {
        error: "A discovery run is already active.",
      });
    const webSearchProvider = createConfiguredWebSearchProvider();
    activeDiscovery = runDiscovery({
      store,
      webSearchProvider,
      localAI: new OllamaLocalAIProvider(),
    }).finally(() => {
      activeDiscovery = undefined;
    });
    return sendJson(response, 202, {
      status: "running",
      run: store.getLatestDiscoveryRun(),
    });
  }
  if (url.pathname === "/api/settings" && method === "GET")
    return sendJson(response, 200, {
      database: process.env.DATABASE_URL ?? "file:./data/job-copilot.db",
      aiProvider:
        process.env.AI_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? "ollama",
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      extractionModel:
        process.env.OLLAMA_EXTRACTION_MODEL ??
        process.env.OLLAMA_MODEL ??
        "qwen3:8b",
      reasoningModel:
        process.env.OLLAMA_REASONING_MODEL ??
        process.env.OLLAMA_MODEL ??
        "deepseek-r1:8b",
      embeddingModel:
        process.env.OLLAMA_EMBEDDING_MODEL ?? "qwen3-embedding:0.6b",
      detailedAnalysisLimit: Number(process.env.DETAILED_ANALYSIS_LIMIT ?? 25),
      discoveryMode: "maintained-company-registry",
      privacy:
        "CVs, database records, and model calls remain local unless a remote provider is explicitly configured.",
    });

  if (method === "GET" || method === "HEAD")
    return serveAsset(url.pathname, response, method === "HEAD");
  sendJson(response, 404, { error: "Not found." });
}

const applicationUpdateSchema = z
  .object({
    status: applicationStatusSchema.optional(),
    applicationUrl: z.string().url().optional(),
    cvVersion: z.string().trim().max(200).optional(),
    notes: z.string().max(10_000).optional(),
    recruiterDetails: z.string().max(5_000).optional(),
    nextAction: z.string().max(1_000).optional(),
    followUpAt: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/,
      )
      .optional(),
    interviewDates: z.array(z.string().max(100)).max(20).optional(),
  })
  .refine((update) => Object.keys(update).length > 0, {
    message: "At least one application field is required.",
  });

async function serveAsset(
  pathname: string,
  response: ServerResponse,
  head: boolean,
): Promise<void> {
  const assets: Record<string, [string, string]> = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };
  const asset = assets[pathname];
  if (!asset) return sendJson(response, 404, { error: "Not found." });
  const content = await fs.readFile(
    path.resolve(process.cwd(), "public", asset[0]),
  );
  response.writeHead(
    200,
    securityHeaders({
      "Content-Type": asset[1],
      "Content-Length": String(content.byteLength),
    }),
  );
  response.end(head ? undefined : content);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 7 * 1024 * 1024)
      throw new Error("Request body exceeds the 7 MB limit.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function assertSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const hostname = new URL(origin).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname))
    throw new Error("Cross-origin state changes are not allowed.");
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(
    status,
    securityHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(Buffer.byteLength(body)),
    }),
  );
  response.end(body);
}

function securityHeaders(
  extra: Record<string, string>,
): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    "Cache-Control": "no-store",
    ...extra,
  };
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>(
    (counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }),
    {},
  );
}
function readPort(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
