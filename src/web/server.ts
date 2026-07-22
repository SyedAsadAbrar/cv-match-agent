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
import { JobCopilotStore } from "../db/store";
import {
  applicationStatusSchema,
  candidateProfileSchema,
  targetCompanySchema,
} from "../domain/schemas";
import { runDiscovery } from "../discovery/pipeline";
import { createConfiguredWebSearchProvider } from "../discovery/webSearch";
import { seedDemo } from "../demo/seed";
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
      companies: store.listCompanies(),
      sourceStatuses: store.listSourceStatuses(),
      webSearchProvider: process.env.WEB_SEARCH_PROVIDER || null,
      webSearchConfigured: Boolean(
        process.env.WEB_SEARCH_PROVIDER && process.env.WEB_SEARCH_API_KEY,
      ),
      lastRun: store.getLatestDiscoveryRun(),
    });
  if (url.pathname === "/api/companies" && method === "POST") {
    const body = z
      .object({
        name: z.string().trim().min(1),
        companyDomain: z.string().trim().min(1),
        careersUrl: z.string().url().optional(),
        countries: z.array(z.string()).default([]),
        atsProvider: z.enum(["greenhouse", "lever", "ashby"]).optional(),
        atsIdentifier: z.string().trim().min(1).optional(),
        enabled: z.boolean().default(true),
      })
      .parse(await readJson(request));
    const company = targetCompanySchema.parse({
      id: randomUUID(),
      ...body,
      sponsorshipEvidence: "unknown",
      sponsorshipEvidenceSources: [],
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
  const companySync = url.pathname.match(/^\/api\/companies\/([^/]+)\/sync$/);
  if (companySync && method === "POST") {
    const company = store
      .listCompanies()
      .find((item) => item.id === decodeURIComponent(companySync[1]));
    if (!company)
      return sendJson(response, 404, { error: "Company not found." });
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
  if (url.pathname === "/api/demo" && method === "POST") {
    if (activeDiscovery)
      return sendJson(response, 409, {
        error: "A discovery run is already active.",
      });
    activeDiscovery = seedDemo(store).finally(() => {
      activeDiscovery = undefined;
    });
    return sendJson(response, 202, { status: "running", fictional: true });
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
      webSearchProvider: process.env.WEB_SEARCH_PROVIDER || null,
      webSearchApiKeyConfigured: Boolean(process.env.WEB_SEARCH_API_KEY),
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
