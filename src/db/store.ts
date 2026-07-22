import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  applicationSchema,
  candidateProfileSchema,
  createInitialCandidateProfile,
  discoveryRunSchema,
  jobPostingSchema,
  matchResultSchema,
  salaryAnalysisSchema,
  targetCompanySchema,
  trustAssessmentSchema,
  workAuthorizationAssessmentSchema,
  type Application,
  type CandidateProfile,
  type DiscoveryRun,
  type JobPosting,
  type JobTrustAssessment,
  type MatchResult,
  type SalaryAnalysis,
  type TargetCompany,
  type WorkAuthorizationAssessment,
} from "../domain/schemas";
import { openDatabase, type SqliteDatabase } from "./database";

export type RankedJob = {
  job: JobPosting;
  match?: MatchResult;
  trust?: JobTrustAssessment;
  workAuthorization?: WorkAuthorizationAssessment;
  salary?: SalaryAnalysis;
  saved: boolean;
  dismissed: boolean;
  application?: Application;
};

export type RankedJobListOptions = {
  includeDismissed?: boolean;
  includeClosed?: boolean;
};

export class JobCopilotStore {
  public readonly database: SqliteDatabase;

  constructor(database: SqliteDatabase = openDatabase()) {
    this.database = database;
  }

  close(): void {
    this.database.close();
  }

  getProfile(): CandidateProfile {
    const row = this.database
      .prepare(
        "SELECT payload FROM candidate_profiles ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as { payload: string } | undefined;
    if (row)
      return parseStored(
        row.payload,
        candidateProfileSchema,
        "candidate profile",
      );
    const profile = createInitialCandidateProfile();
    this.saveProfile(profile, []);
    return profile;
  }

  saveProfile(
    input: CandidateProfile,
    sourceClaims: string[] = [],
  ): CandidateProfile {
    const profile = candidateProfileSchema.parse(input);
    const now = new Date().toISOString();
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `
        INSERT INTO candidate_profiles(id, payload, source_claims, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, source_claims=excluded.source_claims, updated_at=excluded.updated_at
      `,
        )
        .run(
          profile.id,
          JSON.stringify(profile),
          JSON.stringify(sourceClaims),
          now,
          now,
        );
      this.database
        .prepare("DELETE FROM candidate_experiences WHERE profile_id = ?")
        .run(profile.id);
      this.database
        .prepare("DELETE FROM candidate_skills WHERE profile_id = ?")
        .run(profile.id);
      const experienceStatement = this.database.prepare(
        "INSERT INTO candidate_experiences(id, profile_id, company, title, payload) VALUES (?, ?, ?, ?, ?)",
      );
      for (const experience of profile.experience) {
        experienceStatement.run(
          experience.id,
          profile.id,
          experience.company,
          experience.title,
          JSON.stringify(experience),
        );
      }
      const skillStatement = this.database.prepare(
        "INSERT INTO candidate_skills(profile_id, name, proficiency, confidence, payload) VALUES (?, ?, ?, ?, ?)",
      );
      for (const skill of profile.skills) {
        skillStatement.run(
          profile.id,
          skill.name,
          skill.proficiency,
          skill.confidence,
          JSON.stringify(skill),
        );
      }
      this.database
        .prepare(
          `
        INSERT INTO search_preferences(profile_id, payload) VALUES (?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET payload=excluded.payload
      `,
        )
        .run(
          profile.id,
          JSON.stringify({
            targetRoles: profile.targetRoles,
            targetCountries: profile.targetCountries,
            preferences: profile.preferences,
          }),
        );
    });
    save();
    return profile;
  }

  getProfileClaims(profileId: string): string[] {
    const row = this.database
      .prepare("SELECT source_claims FROM candidate_profiles WHERE id = ?")
      .get(profileId) as { source_claims: string } | undefined;
    return row ? parseStringArray(row.source_claims) : [];
  }

  listCompanies(): TargetCompany[] {
    return this.database
      .prepare("SELECT payload FROM target_companies ORDER BY name")
      .all()
      .map((row) =>
        parseStored(
          (row as { payload: string }).payload,
          targetCompanySchema,
          "target company",
        ),
      );
  }

  saveCompany(input: TargetCompany): TargetCompany {
    const company = targetCompanySchema.parse(input);
    this.database
      .prepare(
        `
      INSERT INTO target_companies(id, name, company_domain, ats_provider, ats_identifier, enabled, last_checked_at, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, company_domain=excluded.company_domain,
        ats_provider=excluded.ats_provider, ats_identifier=excluded.ats_identifier, enabled=excluded.enabled,
        last_checked_at=excluded.last_checked_at, payload=excluded.payload
    `,
      )
      .run(
        company.id,
        company.name,
        company.companyDomain,
        company.atsProvider ?? null,
        company.atsIdentifier ?? null,
        company.enabled ? 1 : 0,
        company.lastCheckedAt ?? null,
        JSON.stringify(company),
      );
    return company;
  }

  startSourceSync(discoveryRunId: string, company: TargetCompany): string {
    this.saveCompany(company);
    const sourceId = `company:${company.id}`;
    const syncId = randomUUID();
    const now = new Date().toISOString();
    const start = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO job_sources(id, company_id, source_type, source_identifier, enabled)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_type=excluded.source_type,
          source_identifier=excluded.source_identifier, enabled=excluded.enabled`,
        )
        .run(
          sourceId,
          company.id,
          company.atsProvider ?? "unknown",
          company.atsIdentifier ?? null,
          company.enabled ? 1 : 0,
        );
      this.database
        .prepare(
          `INSERT INTO job_source_sync_runs(id, discovery_run_id, source_id, status, started_at)
          VALUES (?, ?, ?, 'running', ?)`,
        )
        .run(syncId, discoveryRunId, sourceId, now);
    });
    start();
    return syncId;
  }

  finishSourceSync(
    syncId: string,
    company: TargetCompany,
    jobsFound: number,
    error?: string,
  ): void {
    const now = new Date().toISOString();
    const finish = this.database.transaction(() => {
      this.database
        .prepare(
          "UPDATE job_source_sync_runs SET status = ?, completed_at = ?, jobs_found = ?, error = ? WHERE id = ?",
        )
        .run(
          error ? "failed" : "completed",
          now,
          jobsFound,
          error ?? null,
          syncId,
        );
      this.database
        .prepare(
          `UPDATE job_sources SET last_success_at = CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,
          last_error = ? WHERE company_id = ?`,
        )
        .run(error ?? null, now, error ?? null, company.id);
      this.saveCompany({ ...company, lastCheckedAt: now });
    });
    finish();
  }

  listSourceStatuses(): Array<{
    companyId: string;
    lastSuccessAt?: string;
    lastError?: string;
  }> {
    return (
      this.database
        .prepare(
          "SELECT company_id, last_success_at, last_error FROM job_sources ORDER BY company_id",
        )
        .all() as Array<{
        company_id: string;
        last_success_at: string | null;
        last_error: string | null;
      }>
    ).map((row) => ({
      companyId: row.company_id,
      lastSuccessAt: row.last_success_at ?? undefined,
      lastError: row.last_error ?? undefined,
    }));
  }

  startDiscoveryRun(searchesExecuted: number): DiscoveryRun {
    const run = discoveryRunSchema.parse({
      id: randomUUID(),
      status: "running",
      startedAt: new Date().toISOString(),
      searchesExecuted,
      sourcesChecked: 0,
      jobsDiscovered: 0,
      jobsImported: 0,
      duplicatesFound: 0,
      jobsShortlisted: 0,
      jobsAnalysed: 0,
      errors: [],
    });
    this.writeDiscoveryRun(run);
    return run;
  }

  writeDiscoveryRun(input: DiscoveryRun): DiscoveryRun {
    const run = discoveryRunSchema.parse(input);
    this.database
      .prepare(
        `
      INSERT INTO discovery_runs(
        id, status, started_at, completed_at, searches_executed, sources_checked, jobs_discovered,
        jobs_imported, duplicates_found, jobs_shortlisted, jobs_analysed, errors
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, completed_at=excluded.completed_at,
        sources_checked=excluded.sources_checked, jobs_discovered=excluded.jobs_discovered,
        jobs_imported=excluded.jobs_imported, duplicates_found=excluded.duplicates_found,
        jobs_shortlisted=excluded.jobs_shortlisted, jobs_analysed=excluded.jobs_analysed, errors=excluded.errors
    `,
      )
      .run(
        run.id,
        run.status,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.searchesExecuted,
        run.sourcesChecked,
        run.jobsDiscovered,
        run.jobsImported,
        run.duplicatesFound,
        run.jobsShortlisted,
        run.jobsAnalysed,
        JSON.stringify(run.errors),
      );
    return run;
  }

  getLatestDiscoveryRun(): DiscoveryRun | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM discovery_runs ORDER BY COALESCE(started_at, '') DESC LIMIT 1",
      )
      .get() as DiscoveryRunRow | undefined;
    return row ? mapDiscoveryRun(row) : undefined;
  }

  saveSearchPlan(
    runId: string,
    provider: string,
    plan: unknown,
    results: Array<{
      query: string;
      title: string;
      url: string;
      snippet?: string;
    }> = [],
  ): void {
    const id = randomUUID();
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO web_search_runs(id, discovery_run_id, provider, plan, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          id,
          runId,
          provider,
          JSON.stringify(plan),
          new Date().toISOString(),
        );
      const statement = this.database.prepare(
        "INSERT INTO web_search_results(id, search_run_id, query, title, url, snippet) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const result of results)
        statement.run(
          randomUUID(),
          id,
          result.query,
          result.title,
          result.url,
          result.snippet ?? null,
        );
    });
    save();
  }

  importJob(input: JobPosting): { jobId: string; duplicate: boolean } {
    const job = jobPostingSchema.parse(input);
    const existing = this.database
      .prepare(
        `
      SELECT id FROM jobs WHERE canonical_url = ?
      OR (external_id IS NOT NULL AND external_id = ? AND source_type = ?)
      OR (normalized_company = ? AND normalized_title = ? AND COALESCE(location_text, '') = ? AND raw_content_hash = ?)
      LIMIT 1
    `,
      )
      .get(
        job.canonicalUrl,
        job.externalId ?? null,
        job.sourceType,
        normalize(job.company),
        normalize(job.title),
        job.locationText ?? "",
        job.rawContentHash,
      ) as { id: string } | undefined;
    const jobId = existing?.id ?? job.id;
    const storedJob = { ...job, id: jobId };
    const save = this.database.transaction(() => {
      if (existing) {
        this.database
          .prepare(
            "UPDATE jobs SET last_seen_at = ?, status = ?, payload = ? WHERE id = ?",
          )
          .run(job.lastSeenAt, job.status, JSON.stringify(storedJob), jobId);
      } else {
        this.database
          .prepare(
            `
          INSERT INTO jobs(id, external_id, canonical_url, source_type, company, normalized_company, title,
            normalized_title, city, country, location_text, workplace_type, status, published_at,
            first_seen_at, last_seen_at, raw_content_hash, payload)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            jobId,
            job.externalId ?? null,
            job.canonicalUrl,
            job.sourceType,
            job.company,
            normalize(job.company),
            job.title,
            normalize(job.title),
            job.city ?? null,
            job.country ?? null,
            job.locationText ?? null,
            job.workplaceType,
            job.status,
            job.publishedAt ?? null,
            job.firstSeenAt,
            job.lastSeenAt,
            job.rawContentHash,
            JSON.stringify(storedJob),
          );
      }
      this.database
        .prepare(
          `
        INSERT OR IGNORE INTO job_source_references(id, job_id, source_type, source_name, external_id, url, discovered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          randomUUID(),
          jobId,
          job.sourceType,
          job.sourceName ?? null,
          job.externalId ?? null,
          job.discoveredUrl ?? job.canonicalUrl,
          job.firstSeenAt,
        );
      if (!existing) {
        const skillStatement = this.database.prepare(
          "INSERT OR IGNORE INTO job_skills(job_id, skill, required) VALUES (?, ?, ?)",
        );
        for (const skill of job.requiredSkills)
          skillStatement.run(jobId, skill, 1);
        for (const skill of job.preferredSkills)
          skillStatement.run(jobId, skill, 0);
      }
    });
    save();
    return { jobId, duplicate: existing !== undefined };
  }

  saveEvaluation(
    jobId: string,
    matchInput: MatchResult,
    trustInput: JobTrustAssessment,
    authorizationInput: WorkAuthorizationAssessment,
    salaryInput: SalaryAnalysis,
  ): void {
    const match = matchResultSchema.parse({ ...matchInput, jobId });
    const trust = trustAssessmentSchema.parse(trustInput);
    const authorization =
      workAuthorizationAssessmentSchema.parse(authorizationInput);
    const salary = salaryAnalysisSchema.parse(salaryInput);
    const now = new Date().toISOString();
    const save = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO job_matches(job_id, profile_id, score, recommendation, needs_detailed_analysis, payload, analysed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET score=excluded.score,
        recommendation=excluded.recommendation, needs_detailed_analysis=excluded.needs_detailed_analysis,
        payload=excluded.payload, analysed_at=excluded.analysed_at`,
        )
        .run(
          jobId,
          "local-user",
          match.score,
          match.recommendation,
          match.needsDetailedAnalysis ? 1 : 0,
          JSON.stringify(match),
          now,
        );
      this.database
        .prepare("DELETE FROM match_components WHERE job_id = ?")
        .run(jobId);
      const componentStatement = this.database.prepare(
        "INSERT INTO match_components(job_id, component, score, evidence) VALUES (?, ?, ?, ?)",
      );
      for (const [name, component] of Object.entries(match.components)) {
        componentStatement.run(
          jobId,
          name,
          component.score,
          JSON.stringify(component.evidence),
        );
      }
      this.database.prepare("DELETE FROM job_gaps WHERE job_id = ?").run(jobId);
      const gapStatement = this.database.prepare(
        "INSERT INTO job_gaps(id, job_id, type, severity, payload) VALUES (?, ?, ?, ?, ?)",
      );
      for (const gap of match.gaps)
        gapStatement.run(
          randomUUID(),
          jobId,
          gap.type,
          gap.severity,
          JSON.stringify(gap),
        );
      this.database
        .prepare(
          `INSERT INTO job_trust_assessments(job_id, score, level, payload, assessed_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET score=excluded.score, level=excluded.level,
        payload=excluded.payload, assessed_at=excluded.assessed_at`,
        )
        .run(jobId, trust.score, trust.level, JSON.stringify(trust), now);
      this.database
        .prepare(
          `INSERT INTO work_authorization_assessments(job_id, status, payload, assessed_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,
        payload=excluded.payload, assessed_at=excluded.assessed_at`,
        )
        .run(jobId, authorization.status, JSON.stringify(authorization), now);
      this.database
        .prepare("DELETE FROM salary_evidence WHERE job_id = ?")
        .run(jobId);
      const evidenceStatement = this.database
        .prepare(`INSERT INTO salary_evidence(id, job_id, evidence_type, country, city, collected_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const evidence of salary.evidence)
        evidenceStatement.run(
          evidence.id,
          jobId,
          evidence.evidenceType,
          evidence.country ?? null,
          evidence.city ?? null,
          evidence.collectedAt,
          JSON.stringify(evidence),
        );
      this.database
        .prepare(
          `INSERT INTO salary_analyses(job_id, confidence, evidence_count, payload, assessed_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET confidence=excluded.confidence,
        evidence_count=excluded.evidence_count, payload=excluded.payload, assessed_at=excluded.assessed_at`,
        )
        .run(
          jobId,
          salary.confidence,
          salary.evidenceCount,
          JSON.stringify(salary),
          now,
        );
    });
    save();
  }

  listRankedJobs(options: RankedJobListOptions = {}): RankedJob[] {
    const rows = this.database
      .prepare(
        `
      SELECT j.payload AS job_payload, m.payload AS match_payload, t.payload AS trust_payload,
        w.payload AS authorization_payload, s.payload AS salary_payload,
        CASE WHEN sj.job_id IS NULL THEN 0 ELSE 1 END AS saved,
        CASE WHEN dj.job_id IS NULL THEN 0 ELSE 1 END AS dismissed,
        a.payload AS application_payload
      FROM jobs j
      LEFT JOIN job_matches m ON m.job_id = j.id
      LEFT JOIN job_trust_assessments t ON t.job_id = j.id
      LEFT JOIN work_authorization_assessments w ON w.job_id = j.id
      LEFT JOIN salary_analyses s ON s.job_id = j.id
      LEFT JOIN saved_jobs sj ON sj.job_id = j.id
      LEFT JOIN dismissed_jobs dj ON dj.job_id = j.id
      LEFT JOIN applications a ON a.job_id = j.id
      WHERE (? = 1 OR dj.job_id IS NULL)
        AND (? = 1 OR j.status <> 'closed')
      ORDER BY COALESCE(m.score, 0) DESC, j.first_seen_at DESC
    `,
      )
      .all(
        options.includeDismissed ? 1 : 0,
        options.includeClosed ? 1 : 0,
      ) as RankedJobRow[];
    return rows.map(mapRankedJob);
  }

  getRankedJob(jobId: string): RankedJob | undefined {
    return this.listRankedJobs({
      includeDismissed: true,
      includeClosed: true,
    }).find(({ job }) => job.id === jobId);
  }

  setSaved(jobId: string, saved: boolean): void {
    if (saved)
      this.database
        .prepare(
          "INSERT OR REPLACE INTO saved_jobs(job_id, saved_at) VALUES (?, ?)",
        )
        .run(jobId, new Date().toISOString());
    else
      this.database
        .prepare("DELETE FROM saved_jobs WHERE job_id = ?")
        .run(jobId);
  }

  setDismissed(jobId: string, dismissed: boolean, reason?: string): void {
    if (dismissed)
      this.database
        .prepare(
          "INSERT OR REPLACE INTO dismissed_jobs(job_id, dismissed_at, reason) VALUES (?, ?, ?)",
        )
        .run(jobId, new Date().toISOString(), reason ?? null);
    else
      this.database
        .prepare("DELETE FROM dismissed_jobs WHERE job_id = ?")
        .run(jobId);
  }

  saveApplication(input: Application): Application {
    const application = applicationSchema.parse(input);
    this.database
      .prepare(
        `INSERT INTO applications(id, job_id, status, applied_at, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,
      applied_at=excluded.applied_at, payload=excluded.payload, updated_at=excluded.updated_at`,
      )
      .run(
        application.id,
        application.jobId,
        application.status,
        application.appliedAt ?? null,
        JSON.stringify(application),
        application.updatedAt,
      );
    return application;
  }

  listApplications(): Application[] {
    return this.database
      .prepare("SELECT payload FROM applications ORDER BY updated_at DESC")
      .all()
      .map((row) =>
        parseStored(
          (row as { payload: string }).payload,
          applicationSchema,
          "application",
        ),
      );
  }

  getComparableSalaryJobs(
    job: JobPosting,
    maximumEvidenceAgeDays = 180,
  ): JobPosting[] {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - maximumEvidenceAgeDays);
    const rows = this.database
      .prepare(
        `SELECT payload FROM jobs WHERE id <> ? AND country = ? AND status = 'active'
      AND published_at IS NOT NULL AND published_at >= ?
      AND payload LIKE '%"compensation"%' ORDER BY published_at DESC LIMIT 50`,
      )
      .all(job.id, job.country ?? "", cutoff.toISOString()) as {
      payload: string;
    }[];
    return rows.map((row) => parseStored(row.payload, jobPostingSchema, "job"));
  }

  getJobEmbedding(
    jobId: string,
    contentHash: string,
    model: string,
  ): number[] | undefined {
    const row = this.database
      .prepare(
        "SELECT embedding FROM job_embeddings WHERE job_id = ? AND content_hash = ? AND model = ?",
      )
      .get(jobId, contentHash, model) as { embedding: string } | undefined;
    if (!row) return undefined;
    const value = JSON.parse(row.embedding) as unknown;
    return Array.isArray(value) &&
      value.every((item) => typeof item === "number")
      ? value
      : undefined;
  }

  saveJobEmbedding(
    jobId: string,
    contentHash: string,
    model: string,
    embedding: number[],
  ): void {
    if (embedding.length === 0 || !embedding.every(Number.isFinite))
      throw new Error("Cannot save an empty or invalid embedding.");
    this.database
      .prepare(
        `INSERT INTO job_embeddings(job_id, content_hash, model, embedding, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(job_id, model) DO UPDATE SET
        content_hash=excluded.content_hash, embedding=excluded.embedding, created_at=excluded.created_at`,
      )
      .run(
        jobId,
        contentHash,
        model,
        JSON.stringify(embedding),
        new Date().toISOString(),
      );
  }
}

type DiscoveryRunRow = {
  id: string;
  status: DiscoveryRun["status"];
  started_at: string | null;
  completed_at: string | null;
  searches_executed: number;
  sources_checked: number;
  jobs_discovered: number;
  jobs_imported: number;
  duplicates_found: number;
  jobs_shortlisted: number;
  jobs_analysed: number;
  errors: string;
};

type RankedJobRow = {
  job_payload: string;
  match_payload: string | null;
  trust_payload: string | null;
  authorization_payload: string | null;
  salary_payload: string | null;
  saved: number;
  dismissed: number;
  application_payload: string | null;
};

function mapDiscoveryRun(row: DiscoveryRunRow): DiscoveryRun {
  return discoveryRunSchema.parse({
    id: row.id,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    searchesExecuted: row.searches_executed,
    sourcesChecked: row.sources_checked,
    jobsDiscovered: row.jobs_discovered,
    jobsImported: row.jobs_imported,
    duplicatesFound: row.duplicates_found,
    jobsShortlisted: row.jobs_shortlisted,
    jobsAnalysed: row.jobs_analysed,
    errors: JSON.parse(row.errors) as unknown,
  });
}

function mapRankedJob(row: RankedJobRow): RankedJob {
  return {
    job: parseStored(row.job_payload, jobPostingSchema, "job"),
    match: row.match_payload
      ? parseStored(row.match_payload, matchResultSchema, "match")
      : undefined,
    trust: row.trust_payload
      ? parseStored(
          row.trust_payload,
          trustAssessmentSchema,
          "trust assessment",
        )
      : undefined,
    workAuthorization: row.authorization_payload
      ? parseStored(
          row.authorization_payload,
          workAuthorizationAssessmentSchema,
          "work authorization",
        )
      : undefined,
    salary: row.salary_payload
      ? parseStored(row.salary_payload, salaryAnalysisSchema, "salary analysis")
      : undefined,
    saved: row.saved === 1,
    dismissed: row.dismissed === 1,
    application: row.application_payload
      ? parseStored(row.application_payload, applicationSchema, "application")
      : undefined,
  };
}

function parseStored<TSchema extends z.ZodTypeAny>(
  json: string,
  schema: TSchema,
  label: string,
): z.infer<TSchema> {
  const result = schema.safeParse(JSON.parse(json) as unknown);
  if (!result.success)
    throw new Error(`Stored ${label} is invalid: ${result.error.message}`);
  return result.data as z.infer<TSchema>;
}

function parseStringArray(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
