export type Migration = { version: number; name: string; sql: string };

export const migrations: Migration[] = [
  {
    version: 1,
    name: "autonomous-job-discovery",
    sql: `
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL, source_claims TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidate_experiences (
      id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
      company TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidate_skills (
      profile_id TEXT NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL, proficiency TEXT NOT NULL, confidence REAL NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY (profile_id, name)
    );
    CREATE TABLE IF NOT EXISTS search_preferences (
      profile_id TEXT PRIMARY KEY REFERENCES candidate_profiles(id) ON DELETE CASCADE, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS target_companies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, company_domain TEXT NOT NULL, ats_provider TEXT,
      ats_identifier TEXT, enabled INTEGER NOT NULL, last_checked_at TEXT, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_sources (
      id TEXT PRIMARY KEY, company_id TEXT REFERENCES target_companies(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL, source_identifier TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      last_success_at TEXT, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS discovery_runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, started_at TEXT, completed_at TEXT,
      searches_executed INTEGER NOT NULL DEFAULT 0, sources_checked INTEGER NOT NULL DEFAULT 0,
      jobs_discovered INTEGER NOT NULL DEFAULT 0, jobs_imported INTEGER NOT NULL DEFAULT 0,
      duplicates_found INTEGER NOT NULL DEFAULT 0, jobs_shortlisted INTEGER NOT NULL DEFAULT 0,
      jobs_analysed INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS job_source_sync_runs (
      id TEXT PRIMARY KEY, discovery_run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
      source_id TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
      jobs_found INTEGER NOT NULL DEFAULT 0, error TEXT
    );
    CREATE TABLE IF NOT EXISTS web_search_runs (
      id TEXT PRIMARY KEY, discovery_run_id TEXT REFERENCES discovery_runs(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, plan TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_search_results (
      id TEXT PRIMARY KEY, search_run_id TEXT NOT NULL REFERENCES web_search_runs(id) ON DELETE CASCADE,
      query TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, snippet TEXT
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, external_id TEXT, canonical_url TEXT NOT NULL UNIQUE, source_type TEXT NOT NULL,
      company TEXT NOT NULL, normalized_company TEXT NOT NULL, title TEXT NOT NULL, normalized_title TEXT NOT NULL,
      city TEXT, country TEXT, location_text TEXT, workplace_type TEXT NOT NULL, status TEXT NOT NULL,
      published_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, raw_content_hash TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_source_references (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL, source_name TEXT, external_id TEXT, url TEXT NOT NULL,
      discovered_at TEXT NOT NULL, UNIQUE(job_id, url)
    );
    CREATE TABLE IF NOT EXISTS job_skills (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, skill TEXT NOT NULL, required INTEGER NOT NULL,
      PRIMARY KEY(job_id, skill, required)
    );
    CREATE TABLE IF NOT EXISTS job_embeddings (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, content_hash TEXT NOT NULL,
      model TEXT NOT NULL, embedding TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(job_id, model)
    );
    CREATE TABLE IF NOT EXISTS job_trust_assessments (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, score REAL NOT NULL,
      level TEXT NOT NULL, payload TEXT NOT NULL, assessed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_matches (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, profile_id TEXT NOT NULL,
      score REAL NOT NULL, recommendation TEXT NOT NULL, needs_detailed_analysis INTEGER NOT NULL,
      payload TEXT NOT NULL, analysed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS match_components (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, component TEXT NOT NULL,
      score REAL NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(job_id, component)
    );
    CREATE TABLE IF NOT EXISTS job_gaps (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      type TEXT NOT NULL, severity TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS work_authorization_assessments (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, status TEXT NOT NULL,
      payload TEXT NOT NULL, assessed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS salary_evidence (
      id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      evidence_type TEXT NOT NULL, country TEXT, city TEXT, collected_at TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS salary_analyses (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, confidence TEXT NOT NULL,
      evidence_count INTEGER NOT NULL, payload TEXT NOT NULL, assessed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS saved_jobs (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, saved_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dismissed_jobs (
      job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, dismissed_at TEXT NOT NULL, reason TEXT
    );
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL, applied_at TEXT, payload TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ai_model_runs (
      id TEXT PRIMARY KEY, job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, responsibility TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS application_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_external_source ON jobs(source_type, external_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(normalized_company);
    CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs(country);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_published ON jobs(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_content_identity ON jobs(normalized_company, normalized_title, location_text, raw_content_hash);
    CREATE INDEX IF NOT EXISTS idx_matches_recommendation ON job_matches(recommendation);
    CREATE INDEX IF NOT EXISTS idx_matches_score ON job_matches(score DESC);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
  `,
  },
  {
    version: 2,
    name: "version-1-company-registry",
    sql: `
    ALTER TABLE target_companies ADD COLUMN legal_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE target_companies ADD COLUMN normalized_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE target_companies ADD COLUMN headquarters_country TEXT;
    ALTER TABLE target_companies ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'candidate';
    ALTER TABLE target_companies ADD COLUMN engineering_relevance TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE target_companies ADD COLUMN sponsorship_evidence TEXT NOT NULL DEFAULT 'unknown';
    ALTER TABLE target_companies ADD COLUMN last_successful_sync_at TEXT;

    UPDATE target_companies SET legal_name = name, normalized_name = lower(name),
      verification_status = CASE WHEN enabled = 1 THEN 'source-verified' ELSE 'candidate' END;

    CREATE TABLE IF NOT EXISTS company_source_records (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      source_record_id TEXT NOT NULL, source_type TEXT NOT NULL, source_name TEXT NOT NULL,
      source_url TEXT NOT NULL, source_published_at TEXT, source_retrieved_at TEXT NOT NULL,
      country TEXT NOT NULL, payload TEXT NOT NULL, imported_at TEXT NOT NULL,
      UNIQUE(source_name, source_record_id)
    );
    CREATE TABLE IF NOT EXISTS company_import_runs (
      id TEXT PRIMARY KEY, source_name TEXT NOT NULL, status TEXT NOT NULL, source_url TEXT NOT NULL,
      source_version TEXT, source_published_at TEXT, started_at TEXT NOT NULL, completed_at TEXT,
      records_read INTEGER NOT NULL DEFAULT 0, records_created INTEGER NOT NULL DEFAULT 0,
      records_updated INTEGER NOT NULL DEFAULT 0, duplicates_found INTEGER NOT NULL DEFAULT 0,
      records_rejected INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS company_relationships (
      id TEXT PRIMARY KEY, parent_company_id TEXT REFERENCES target_companies(id) ON DELETE CASCADE,
      subsidiary_company_id TEXT REFERENCES target_companies(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(parent_company_id, subsidiary_company_id, relationship)
    );
    CREATE TABLE IF NOT EXISTS company_verification_runs (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT,
      evidence_url TEXT, detected_provider TEXT, error TEXT, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS company_countries (
      company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      country TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(company_id, country, kind)
    );
    CREATE TABLE IF NOT EXISTS company_cities (
      company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      city TEXT NOT NULL, PRIMARY KEY(company_id, city)
    );
    CREATE TABLE IF NOT EXISTS company_industries (
      company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      industry TEXT NOT NULL, PRIMARY KEY(company_id, industry)
    );

    CREATE INDEX IF NOT EXISTS idx_companies_legal_name ON target_companies(legal_name);
    CREATE INDEX IF NOT EXISTS idx_companies_normalized_name ON target_companies(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_companies_domain ON target_companies(company_domain);
    CREATE INDEX IF NOT EXISTS idx_companies_headquarters ON target_companies(headquarters_country);
    CREATE INDEX IF NOT EXISTS idx_companies_ats ON target_companies(ats_provider);
    CREATE INDEX IF NOT EXISTS idx_companies_verification ON target_companies(verification_status);
    CREATE INDEX IF NOT EXISTS idx_companies_enabled ON target_companies(enabled);
    CREATE INDEX IF NOT EXISTS idx_companies_sponsorship ON target_companies(sponsorship_evidence);
    CREATE INDEX IF NOT EXISTS idx_companies_engineering ON target_companies(engineering_relevance);
    CREATE INDEX IF NOT EXISTS idx_companies_last_sync ON target_companies(last_successful_sync_at DESC);
    CREATE INDEX IF NOT EXISTS idx_company_source_country ON company_source_records(country);
    CREATE INDEX IF NOT EXISTS idx_company_source_name ON company_source_records(source_name);
    CREATE INDEX IF NOT EXISTS idx_company_country ON company_countries(country, kind);
    CREATE INDEX IF NOT EXISTS idx_company_city ON company_cities(city);
    CREATE INDEX IF NOT EXISTS idx_company_industry ON company_industries(industry);
  `,
  },
  {
    version: 3,
    name: "company-source-observations",
    sql: `
    CREATE TABLE IF NOT EXISTS company_source_observations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      source_name TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      UNIQUE(source_name, source_record_id, payload_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_company_source_observation_record
      ON company_source_observations(source_name, source_record_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_company_verification_started
      ON company_verification_runs(started_at DESC);
  `,
  },
  {
    version: 4,
    name: "company-job-snapshot-observations",
    sql: `
    CREATE TABLE IF NOT EXISTS company_job_observations (
      company_id TEXT NOT NULL REFERENCES target_companies(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      consecutive_misses INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      last_successful_snapshot_at TEXT NOT NULL,
      PRIMARY KEY(company_id, job_id)
    );
    CREATE INDEX IF NOT EXISTS idx_company_job_observation_misses
      ON company_job_observations(company_id, consecutive_misses);
  `,
  },
];
