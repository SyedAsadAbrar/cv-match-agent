import {
  targetCompanySchema,
  type JobSourceType,
  type TargetCompany,
} from "../domain/schemas";
import type { LocalAIProvider } from "../ai/localAIProvider";
import { JobCopilotStore } from "../db/store";
import { AshbyConnector } from "./connectors/ashby";
import { GreenhouseConnector } from "./connectors/greenhouse";
import { LeverConnector } from "./connectors/lever";
import { CareersPageConnector } from "./connectors/careersPage";
import { applyHardFilters } from "./filter";
import { normalizeJob } from "./normalize";
import { generateSearchPlan } from "./searchPlan";
import { analyseSalary } from "./salary";
import { scoreJob } from "./scoring";
import { assessJobTrust } from "./trust";
import type { JobSourceConnector, WebSearchProvider } from "./types";
import { assessWorkAuthorization } from "./workAuthorization";

export type DiscoveryPipelineOptions = {
  store?: JobCopilotStore;
  connectors?: Partial<Record<JobSourceType, JobSourceConnector>>;
  companies?: TargetCompany[];
  webSearchProvider?: WebSearchProvider;
  localAI?: LocalAIProvider;
  analyse?: boolean;
  verify?: boolean;
};

export async function runDiscovery(options: DiscoveryPipelineOptions = {}) {
  const ownsStore = !options.store;
  const store = options.store ?? new JobCopilotStore();
  const profile = store.getProfile();
  const plan = generateSearchPlan(profile);
  const run = store.startDiscoveryRun(plan.queries.length);
  const connectors: Partial<Record<JobSourceType, JobSourceConnector>> =
    options.connectors ?? {
      greenhouse: new GreenhouseConnector(),
      lever: new LeverConnector(),
      ashby: new AshbyConnector(),
      "company-careers": new CareersPageConnector(),
    };
  const companies = (options.companies ?? store.listCompanies())
    .map((company) => targetCompanySchema.parse(company))
    .filter(
      (company) =>
        company.enabled &&
        ["source-verified", "monitored"].includes(company.verificationStatus),
    );
  const errors = [...run.errors];
  const webResults: Array<{
    query: string;
    title: string;
    url: string;
    snippet?: string;
  }> = [];
  let sourcesChecked = 0;
  let jobsDiscovered = 0;
  let jobsImported = 0;
  let duplicatesFound = 0;
  const evaluatedJobIds: string[] = [];
  let candidateEmbeddings: Promise<number[][]> | undefined;
  let embeddingsUnavailable = false;

  try {
    if (options.webSearchProvider) {
      for (const query of plan.queries) {
        try {
          const results = await options.webSearchProvider.search(query, {
            limit: 10,
            recencyDays: profile.preferences.maximumJobAgeDays,
          });
          webResults.push(...results.map((result) => ({ query, ...result })));
        } catch (error) {
          errors.push({
            source: `web-search:${query}`,
            message: formatError(error),
            retryable: true,
          });
        }
      }
    }
    store.saveSearchPlan(
      run.id,
      options.webSearchProvider?.name ?? "not-configured",
      plan,
      webResults,
    );

    const discoveryConcurrency = readPositiveInteger(
      process.env.JOB_DISCOVERY_CONCURRENCY,
      4,
    );
    const sourceResults = await mapWithConcurrency(
      companies,
      discoveryConcurrency,
      async (company) => {
        sourcesChecked += 1;
        const syncId = store.startSourceSync(run.id, company);
        const source = connectorSource(company);
        const connector = source ? connectors[source] : undefined;
        if (
          !connector ||
          (source !== "company-careers" && !company.atsIdentifier)
        ) {
          return {
            company,
            syncId,
            references: [],
            error: new Error(
              "No supported configured ATS connector and identifier.",
            ),
          };
        }
        try {
          const references = await connector.discoverJobs({
            profile,
            company,
            maximumJobs: 500,
          });
          return { company, syncId, connector, references };
        } catch (error) {
          return { company, syncId, connector, references: [], error };
        }
      },
    );

    for (const result of sourceResults) {
      if (result.error) {
        store.finishSourceSync(
          result.syncId,
          result.company,
          0,
          formatError(result.error),
        );
        errors.push({
          source: result.company.name,
          message: formatError(result.error),
          retryable: true,
        });
        continue;
      }
      store.finishSourceSync(
        result.syncId,
        result.company,
        result.references.length,
      );
      jobsDiscovered += result.references.length;
      const seenJobIds: string[] = [];
      let jobErrors = 0;
      await mapWithConcurrency(
        result.references,
        discoveryConcurrency,
        async (reference) => {
          try {
            const raw = await result.connector!.fetchJob(reference);
            if (options.verify !== false && result.connector!.verifyJobActive) {
              const active =
                await result.connector!.verifyJobActive!(reference);
              raw.status = active ? (raw.status ?? "active") : "closed";
            }
            const job = normalizeJob(raw);
            const imported = store.importJob(job);
            seenJobIds.push(imported.jobId);
            if (imported.duplicate) duplicatesFound += 1;
            else jobsImported += 1;
            const storedJob = { ...job, id: imported.jobId };
            const authorization = assessWorkAuthorization(
              profile,
              storedJob,
              result.company,
            );
            const hardFilter = applyHardFilters(
              profile,
              storedJob,
              authorization,
            );
            let embeddingScores = {};
            if (options.localAI && !embeddingsUnavailable) {
              try {
                candidateEmbeddings ??= Promise.all(
                  candidateEmbeddingTexts(profile).map((text) =>
                    options.localAI!.createEmbedding(text),
                  ),
                );
                const candidateVectors = await candidateEmbeddings;
                const jobVectors = await Promise.all(
                  jobEmbeddingTexts(storedJob).map(async (text, index) => {
                    const cacheModel = `${options.localAI!.embeddingModel}:${index}`;
                    const cached = store.getJobEmbedding(
                      imported.jobId,
                      storedJob.rawContentHash,
                      cacheModel,
                    );
                    if (cached) return cached;
                    const embedding =
                      await options.localAI!.createEmbedding(text);
                    store.saveJobEmbedding(
                      imported.jobId,
                      storedJob.rawContentHash,
                      cacheModel,
                      embedding,
                    );
                    return embedding;
                  }),
                );
                embeddingScores = {
                  profileToJob: cosineSimilarity(
                    candidateVectors[0],
                    jobVectors[0],
                  ),
                  experienceToResponsibilities: cosineSimilarity(
                    candidateVectors[1],
                    jobVectors[1],
                  ),
                  skillsToRequirements: cosineSimilarity(
                    candidateVectors[2],
                    jobVectors[2],
                  ),
                  rolesToTitle: cosineSimilarity(
                    candidateVectors[3],
                    jobVectors[3],
                  ),
                };
              } catch (error) {
                embeddingsUnavailable = true;
                errors.push({
                  source: "ollama-embeddings",
                  message: formatError(error),
                  retryable: true,
                });
              }
            }
            let match = scoreJob(
              profile,
              storedJob,
              authorization,
              embeddingScores,
            );
            if (!hardFilter.accepted) {
              match = {
                ...match,
                recommendation: "skip",
                needsDetailedAnalysis: false,
                gaps: [
                  ...match.gaps,
                  ...hardFilter.reasons.map((reason) => ({
                    type: "role-positioning-gap" as const,
                    requirement: reason,
                    severity: "blocker" as const,
                    explanation: reason,
                    candidateEvidence: [],
                    recommendation:
                      "Review or change the relevant hard-filter preference.",
                  })),
                ],
              };
            }
            const trust = assessJobTrust(storedJob, result.company);
            const salary = analyseSalary(
              storedJob,
              store.getComparableSalaryJobs(storedJob),
            );
            store.saveEvaluation(
              imported.jobId,
              match,
              trust,
              authorization,
              salary,
            );
            evaluatedJobIds.push(imported.jobId);
          } catch (error) {
            jobErrors += 1;
            errors.push({
              source: `${result.company.name}:${reference.externalId}`,
              message: formatError(error),
              retryable: true,
            });
          }
        },
      );
      if (jobErrors === 0)
        store.recordSuccessfulCompanyJobSnapshot(result.company.id, seenJobIds);
    }

    const analysisLimit = readPositiveInteger(
      process.env.DETAILED_ANALYSIS_LIMIT,
      25,
    );
    const shortlist = store
      .listRankedJobs()
      .filter(
        (item) =>
          evaluatedJobIds.includes(item.job.id) &&
          item.match?.needsDetailedAnalysis,
      )
      .slice(0, analysisLimit);
    let jobsAnalysed = 0;
    if (options.analyse !== false && options.localAI) {
      for (const item of shortlist) {
        if (
          !item.match ||
          !item.workAuthorization ||
          !item.salary ||
          !item.trust
        )
          continue;
        try {
          const detailedAnalysis = await options.localAI.analyseShortlistedJob({
            profile,
            job: item.job,
            match: item.match,
            workAuthorization: item.workAuthorization,
            salary: item.salary,
          });
          store.saveEvaluation(
            item.job.id,
            { ...item.match, detailedAnalysis },
            item.trust,
            item.workAuthorization,
            item.salary,
          );
          jobsAnalysed += 1;
        } catch (error) {
          errors.push({
            source: `ollama:${item.job.id}`,
            message: formatError(error),
            retryable: true,
          });
        }
      }
    }
    const status =
      errors.length === 0
        ? "completed"
        : jobsImported > 0 || duplicatesFound > 0
          ? "partially-completed"
          : "failed";
    return store.writeDiscoveryRun({
      ...run,
      status,
      completedAt: new Date().toISOString(),
      sourcesChecked,
      jobsDiscovered,
      jobsImported,
      duplicatesFound,
      jobsShortlisted: shortlist.length,
      jobsAnalysed,
      errors,
    });
  } catch (error) {
    return store.writeDiscoveryRun({
      ...run,
      status: "failed",
      completedAt: new Date().toISOString(),
      sourcesChecked,
      jobsDiscovered,
      jobsImported,
      duplicatesFound,
      jobsShortlisted: 0,
      jobsAnalysed: 0,
      errors: [
        ...errors,
        { source: "pipeline", message: formatError(error), retryable: false },
      ],
    });
  } finally {
    if (ownsStore) store.close();
  }
}

function connectorSource(company: TargetCompany): JobSourceType | undefined {
  if (
    (company.atsProvider === "greenhouse" &&
      readBoolean(process.env.GREENHOUSE_ENABLED, true)) ||
    (company.atsProvider === "lever" &&
      readBoolean(process.env.LEVER_ENABLED, true)) ||
    (company.atsProvider === "ashby" &&
      readBoolean(process.env.ASHBY_ENABLED, true))
  )
    return company.atsProvider;
  if (
    company.atsProvider === "custom" &&
    company.careersUrl &&
    readBoolean(process.env.CAREERS_CRAWLER_ENABLED, true)
  )
    return "company-careers";
  return undefined;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      () => worker(),
    ),
  );
  return results;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateEmbeddingTexts(
  profile: ReturnType<JobCopilotStore["getProfile"]>,
): string[] {
  return [
    [
      profile.summary,
      ...profile.targetRoles,
      ...profile.skills.map((skill) => skill.name),
    ]
      .filter(Boolean)
      .join("\n"),
    profile.experience
      .map((item) => `${item.title}: ${item.achievements.join(" ")}`)
      .join("\n") || "No experience evidence saved",
    profile.skills
      .map((skill) => `${skill.name}: ${skill.evidence.join(" ")}`)
      .join("\n") || "No skill evidence saved",
    profile.targetRoles.join("\n") || "No target roles saved",
  ];
}

function jobEmbeddingTexts(
  job: Parameters<JobCopilotStore["importJob"]>[0],
): string[] {
  return [
    `${job.title}\n${job.description}`,
    job.responsibilities.join("\n") || job.description,
    [...job.requiredSkills, ...job.preferredSkills].join("\n") ||
      job.description,
    job.title,
  ];
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length)
    throw new Error("Embedding vectors have incompatible dimensions.");
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
