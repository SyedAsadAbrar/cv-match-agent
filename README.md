# cv-match-agent

`cv-match-agent` is a local-first personal job copilot. It keeps the original CV-to-job analysis CLI and adds an autonomous discovery workflow: upload and review a CV, configure role/location preferences and official company sources, then press **Find New Jobs** without pasting job URLs. Jobs are verified, normalised, consolidated, filtered, deterministically ranked, analysed selectively with local AI, and shown in a responsive dashboard. Applications are always submitted manually on the official employer page.

The application is a strict TypeScript modular monolith. A native Node HTTP server hosts the local dashboard and API, `better-sqlite3` stores local state, Zod validates trust boundaries, and the existing Ollama/provider, CV extraction, evidence preservation, matching, and benchmark modules are reused. Greenhouse, Lever, and Ashby adapters use their public official job-posting endpoints. There is no authentication because the server binds to `127.0.0.1` by default; do not expose it directly to a network.

## Quick Start

Requires Node.js 20 or newer, npm, and (for AI extraction/analysis) a locally running [Ollama](https://ollama.com/).

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run companies:import
npm run companies:normalise
npm run web
```

Open `http://127.0.0.1:4310`. For a no-network fictional walkthrough:

```bash
npm run demo
```

Every demo company and job is labelled fictional. The fixture includes a strong React/TypeScript job, backend-heavy stretch, explicit no-sponsorship blocker, unknown sponsorship, disclosed and undisclosed salary, a cross-source duplicate, closed job, suspicious posting, and isolated connector failure.

## Architecture

- `src/ai`, `src/services`: existing provider abstractions, JSON repair/validation, CV parsing, matching, and generated application assets.
- `src/domain`: validated discovery/profile/job/application schemas.
- `src/db`: ordered SQLite migrations and transaction-oriented repository.
- `src/company`: source import, name normalisation, conservative duplicate detection, official-link resolution, ATS detection, verification, auditing, reporting, and the bounded careers crawler.
- `src/discovery`: source contracts, ATS/careers adapters, normalisation, deduplication, filters, scoring, trust, sponsorship, salary, and orchestration.
- `src/security`: URL/SSRF controls, bounded fetches, upload validation, and HTML-to-text sanitisation.
- `src/web` and `public`: local HTTP API and responsive dashboard.
- `src/demo`: deterministic fictional product demonstration.

The original discovery design is in [`docs/autonomous-job-discovery-plan.md`](docs/autonomous-job-discovery-plan.md). The Version 1 registry inspection, source strategy, migration plan, and limitations are in [`docs/version-1-company-registry-plan.md`](docs/version-1-company-registry-plan.md).

## Local Profile Workflow

1. Open **Profile** and upload a text-based PDF, Markdown, or plain-text CV (maximum 5 MB).
2. Ollama extracts a structured profile with one repair attempt and Zod validation. Uploaded CVs and the database stay in ignored `data/` paths.
3. Review/edit the location, work-permit flag, role targets, countries, exclusions, maximum age, skills, and evidence. CV-derived claims are counted separately.
4. The initial editable context is Dubai, United Arab Emirates; Pakistani citizenship; European work permit required; and AED 22,000 monthly gross/net unknown. It is a comparison baseline, never an automatic rejection threshold. No desired salary is required.

## Free Version 1 Discovery

> Version 1 does not search the entire internet.
>
> It automatically monitors a large, maintained registry of known employers using official career pages and public job feeds.

No paid search service, search-engine scraping, authenticated job-platform scraping, proxy service, or API key is used for discovery. Pressing **Find New Jobs** checks only enabled companies whose source has already reached `source-verified` or `monitored`. One company failure is retained in the run summary and does not discard successful sources. Applications always happen manually through the preserved official URL.

Active ingestion is implemented for:

- Greenhouse Job Board API board tokens.
- Lever Postings API site identifiers.
- Ashby public Job Postings API board names.
- Conservative same-domain official careers crawling, including `JobPosting` JSON-LD and sitemap-discovered job pages.

Workable, SmartRecruiters, Workday, Personio, Recruitee, SAP SuccessFactors, and Oracle Recruiting are detected and stored, but are detection-only in this version.

The crawler starts only from a reviewed official careers URL. It checks `robots.txt`, follows declared or conventional sitemaps, stays on the official domain, and enforces depth, page, redirect, response-size, content-type, timeout, retry, and optional delay limits. It does not execute third-party JavaScript, bypass login or CAPTCHA controls, or operate as a general crawler.

### Registry provenance and statuses

Every imported record contains a source record ID, type, title, official URL, retrieval date, country, and the original structured evidence. Refresh runs are recorded, and changed source evidence is appended to observation history rather than silently replacing the previous version.

The lifecycle is `candidate` → `domain-resolved` → `careers-page-found` → `source-verified` → `monitored`. `temporarily-failing`, `inactive`, and `rejected` preserve operational and review outcomes. Only `source-verified` and `monitored` companies are active sources; a previously verified enabled source may remain `temporarily-failing` while it is retried.

Being listed as a recognised sponsor or having historical permit activity is positive evidence, not a guarantee that a specific vacancy offers sponsorship. Sponsorship is still assessed at vacancy level, and missing evidence remains unknown.

### Source data and maintenance

Small, reviewable structured derivatives live under `data/company-sources/`. They currently cover the official Netherlands IND recognised-sponsor register, official Irish permit-history material, Hub71 ecosystem companies, and directly verified official company pages across Saudi Arabia, Germany, and other target EU countries. These seed derivatives are representative, not a fabricated attempt to hit the soft scale targets. The Netherlands importer can refresh the full official HTML register when network access is available and refuses suspiciously small parses.

```bash
npm run companies:import -- --dry-run
npm run companies:import
npm run companies:normalise -- --dry-run
npm run companies:normalise
npm run companies:resolve -- --limit 25
npm run companies:verify -- --limit 25
npm run companies:audit
npm run companies:stats
npm run companies:refresh -- --official --dry-run
npm run jobs:discover
```

`companies:resolve` never guesses a missing domain. Export unresolved records from **Sources** or `/api/companies/unresolved.csv`, review the official domain, careers URL, provider/identifier, evidence URL, and notes, then import the CSV in the UI or with `npm run dev -- companies import-resolutions --file reviewed.csv`. After saving, verify the source before enabling it. The company table is server-paginated and supports country, status, ATS, sponsorship, enabled, and text filters through the API.

To add another maintained source, create a validated JSON derivative under the relevant country directory, run the import in dry-run mode, then normalise, resolve, verify, audit, and regenerate reports. The repository-local Codex maintenance skill packages that workflow:

```text
$company-source-onboarding Import and verify new Irish employers from the latest official employment-permit company listing.
$company-source-onboarding Audit UAE sources not checked in the last 30 days.
$company-source-onboarding Add German technology employers without inventing unsupported ATS IDs.
```

The skill lives in `.agents/skills/company-source-onboarding/`; it is a project-maintenance workflow, not the runtime engine.

## Ollama Models

Install the configured models yourself; the application never downloads models:

```bash
ollama pull qwen3:8b
ollama pull deepseek-r1:8b
ollama pull qwen3-embedding:0.6b
```

- `OLLAMA_EXTRACTION_MODEL`: candidate/job extraction and structured classification.
- `OLLAMA_REASONING_MODEL`: detailed analysis for the strongest configurable shortlist only.
- `OLLAMA_EMBEDDING_MODEL`: similarity and duplicate-support embeddings.

If Ollama is unavailable during discovery, official source collection and deterministic scoring still work; jobs remain flagged for detailed analysis. Existing `OLLAMA_MODEL` CLI behavior remains compatible.

## Environment

```env
DATABASE_URL=file:./data/job-copilot.db
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EXTRACTION_MODEL=qwen3:8b
OLLAMA_REASONING_MODEL=deepseek-r1:8b
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:0.6b
WEB_SEARCH_PROVIDER=none
GREENHOUSE_ENABLED=true
LEVER_ENABLED=true
ASHBY_ENABLED=true
CAREERS_CRAWLER_ENABLED=true
DETAILED_ANALYSIS_LIMIT=25
MAX_JOB_AGE_DAYS=30
JOB_DISCOVERY_CONCURRENCY=4
JOB_FETCH_TIMEOUT_MS=15000
JOB_FETCH_RETRY_LIMIT=2
JOB_FETCH_MAX_RESPONSE_BYTES=5000000
CAREERS_CRAWLER_MAX_DEPTH=2
CAREERS_CRAWLER_MAX_PAGES_PER_COMPANY=100
CAREERS_CRAWLER_CONCURRENCY=3
CAREERS_CRAWLER_DELAY_MS=250
HOST=127.0.0.1
PORT=4310
```

## Database and Commands

The default database is `data/job-copilot.db`. Migrations are idempotent and applied automatically when the store opens; they can also be run explicitly:

```bash
npm run db:migrate
npm run companies:import
npm run companies:normalise
npm run companies:resolve
npm run companies:detect-sources
npm run companies:verify
npm run companies:enable-verified -- --dry-run
npm run companies:onboard -- --country "Germany" --limit 25
npm run companies:audit
npm run companies:stats
npm run web
npm run jobs:discover
npm run demo
npm run typecheck
npm run lint
npm test
npm run build
```

`companies:onboard` imports, normalises, resolves, detects, verifies, and reports without enabling by default. Pass `--enable-verified` explicitly to enable only sources verified as active with jobs or valid but empty. The Sources screen exposes the same guarded enablement.

Verification distinguishes active boards with jobs, valid empty boards, temporary failures, invalid identifiers, wrong-company boards, unsupported providers, and blocked pages. Corporate pages may hand off to recognised ATS hosts, but an identifier is persisted only after official relationship evidence and successful live Greenhouse, Lever, or Ashby verification.

Scheduling is intentionally not required in this milestone. `npm run jobs:discover` is the manual worker entry point and can later be called by an OS-local scheduler.

## Ranking, Salary, and Eligibility

Hard filters and deterministic components run before any detailed reasoning. Scores cover required skills, relevant experience, seniority, role alignment, domain evidence, relocation feasibility, language, and preferences. Salary is not included when evidence is absent, and local-AI analysis never changes the score.

Salary priority is: vacancy disclosure, same-company comparable, same-market comparable, official statistics, and reputable guides. Stored comparable jobs must share a usable currency/period group and similar role/location; obvious outliers are removed. Foreign gross annual pay is not presented as directly comparable with AED 22,000 monthly when gross/net, tax, benefits, exchange rate, and cost of living are unknown.

Missing sponsorship text means **unknown**, not incompatible. Explicit no-sponsorship or unrestricted-work-right wording creates a blocker. Company sponsorship history is positive evidence, not proof for a specific vacancy. This is preliminary evidence, not legal advice.

## Security and Privacy

- CVs, fetched descriptions, and model inputs are untrusted data; extraction prompts reject embedded instructions.
- Only HTTP(S) public URLs may be fetched. Local/private/link-local/metadata addresses, credentials in URLs, excessive redirects, unsupported content, oversized bodies, and timeouts are rejected.
- Executable HTML is discarded and fetched HTML is never rendered.
- CV upload extensions and size are validated; private uploads and SQLite/WAL files are gitignored.
- The dashboard returns configuration status, never API-key values.
- Full CV content is not logged. Remote AI is only used if explicitly selected through the preserved provider configuration.
- The local server includes same-origin state-change checks and restrictive browser security headers.

## Known Limitations and Troubleshooting

- Only Greenhouse, Lever, Ashby, and conservative official careers pages have active ingestion. Workable, SmartRecruiters, Workday, Personio, Recruitee, SAP SuccessFactors, and Oracle remain detection-only.
- Requested employers are committed as attributable candidates. A candidate domain or careers URL is not a verified source; run reviewed onboarding and inspect evidence before enabling. Current counts are reported honestly in `reports/`.
- Domain-less companies require manual resolution. JavaScript-only career sites may need a future dedicated public connector.
- No automatic applications, LinkedIn scraping, browser automation, CAPTCHA bypass, authentication bypass, or always-on scheduler is included.
- CV PDFs must contain extractable text; scanned PDFs need OCR before upload.
- Salary has no tax/cost-of-living model. Immigration rules are not a comprehensive legal rules engine.
- If the feed is empty, import the registry, resolve and verify official sources, then enable the source. If extraction fails, confirm Ollama is running and the extraction model is installed. Source failures appear under **Sources** and in the latest discovery run.
- If SQLite cannot open, ensure the process can write `data/` and that `DATABASE_URL` points to a local writable file.

## Roadmap

1. More active ATS connectors.
2. More authorised official register and ecosystem importers.
3. Versioned immigration rules.
4. Tax and cost-of-living comparison.
5. Automated local scheduling.
6. Email or desktop summaries.
7. Multiple CV variants.
8. Application-answer assistance.
9. Optional cloud deployment.

## What It Does

- Reads CVs from Markdown, plain text, or text-based PDF files.
- Splits the CV into semantic sections before asking an AI model to build the profile.
- Extracts a structured profile with summary, location, education, skills, companies, work experience, projects, and achievements.
- Preserves work experience bullets so later analysis is grounded in the original CV.
- Extracts job requirements, including role, company, location, skills, responsibilities, education requirements, and keywords.
- Compares the profile against the job and produces a realistic match report.
- Generates CV improvements, a formal LinkedIn outreach message, a cover letter, and interview preparation notes.
- Reviews generated outputs for unsupported claims, missing calls to action, preference mismatches, and contradictions.
- Stores debug artifacts so model failures, JSON repair attempts, and prompt responses can be inspected.

## Context Saved By Default

When you pass `--cv`, the CLI reads and extracts that CV, uses the fresh profile for the current run, and saves the parsed profile to:

```txt
context/profile.json
```

Use `--no-save-context` if you want to analyze a CV without updating the saved profile:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --no-save-context
```

A local context file is supported at:

```txt
context/profile.json
```

That file stores a previously extracted CV profile. It is only used when `analyze` is run without `--cv`. Explicit CLI input always wins: if both `--cv` and `context/profile.json` exist, the CLI uses `--cv`.

## Preferences

The CLI also supports optional local preferences at:

```txt
context/preferences.json
```

If the file does not exist, sensible defaults are used. Preferences can guide output tone, cover letter length, preferred roles, and phrases to avoid:

```json
{
  "linkedinTone": "formal and concise",
  "coverLetterLength": "medium",
  "preferredRoles": [],
  "avoidPhrases": ["excited", "perfect fit"]
}
```

## Install

Requires Node.js 20 or newer.

```bash
npm install
```

Copy the environment template and adjust it:

```bash
cp .env.example .env
```

The default environment looks like:

```env
DEFAULT_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OPENAI_API_KEY=
OPENAI_MODEL=
```

## Run With Ollama

Install and start Ollama, then make sure the model exists locally:

```bash
ollama pull llama3.1:8b
```

List the models already installed in your local Ollama instance:

```bash
npm run dev -- models list
```

The CLI never downloads models automatically. Install any model you want to use with `ollama pull`, for example:

```bash
ollama pull deepseek-r1:8b
```

Run an analysis with an explicit CV:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama
```

Select a specific installed Ollama model for one analysis run:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --model deepseek-r1:8b
```

CV input can be Markdown, plain text, or a text-based PDF:

```bash
npm run dev -- analyze --cv ./private/resume.pdf --job ./examples/job.txt --provider ollama
```

The Ollama provider uses:

```env
DEFAULT_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

For Ollama, model selection uses this precedence: `--model`, then `OLLAMA_MODEL`, then `llama3.1:8b`. Existing commands without `--model` therefore continue to use the configured environment value or the default. `--model` is only for Ollama; it is rejected with `--provider openai`.

## Benchmark Local Ollama Models

The local benchmark compares installed Ollama generation models on three synthetic tasks taken from this application's real workflow:

- Job-requirement extraction using the production prompt and schema.
- Profile-to-job matching using the production prompt and pre-generated structured inputs.
- Bounded, grounded application writing with three CV recommendations and a short recruiter message.

The fixtures contain synthetic candidate and employer data only. Models run sequentially to avoid GPU contention, misleading timing, and memory exhaustion. Benchmarking can be computationally expensive: the default is three runs for each of three tasks per model.

Benchmark every compatible installed model:

```bash
npm run dev -- models benchmark
```

Benchmark selected models and repeat each task three times:

```bash
npm run dev -- models benchmark --model deepseek-r1:8b --model qwen3:14b --runs 3
```

Use `--runs 1` for a quicker but less representative check, up to a maximum of 10. Use `--force` to bypass otherwise valid cached results:

```bash
npm run dev -- models benchmark --model deepseek-r1:8b --runs 1
npm run dev -- models benchmark --force
```

Models must already be installed. The benchmark never downloads models, never calls OpenAI, sends no external telemetry, and does not upload reports. A model without reported Ollama capability metadata is tested by the first generation as a compatibility probe; embedding-only models are excluded when Ollama reports that capability clearly.

Benchmark requests use JSON mode, temperature `0`, seed `42`, and a 1,500-token output limit. Reports mark these settings as requested but unverified because Ollama does not return per-option acceptance metadata; a model that ignores an option is not falsely reported as having confirmed it.

### Deterministic Scoring

Each task produces a 0–100 score with machine-readable deductions. Task scoring is 45% factual grounding, 35% completeness, and 20% final schema validity. Missing requirements, wrong required/preferred classification, omitted genuine gaps, unsupported experience, fabricated employers, technologies, certifications, metrics, or years all produce explicit deductions. Invalid final JSON receives a severe failure result. No LLM judge is used.

The aggregate quality score is independent of speed:

- Grounding: 40%
- Completeness: 30%
- Schema reliability: 20%
- Semantic consistency across runs: 10%

Consistency compares stable facts such as detected requirements, gaps, and forbidden claims; it does not compare exact prose. A model is eligible only when it has at least one successful run for every task, at least 80% overall task success, at least 80% final schema success, a grounding score of at least 75, a quality score of at least 70, and no catastrophic fabricated claims. Thresholds are never lowered merely to produce a winner.

The recommendations are calculated as follows:

- `quality`: highest eligible quality score, with grounding, schema reliability, completeness, duration, and model name as deterministic tie-breakers.
- `fast`: lowest average duration among eligible models only.
- `balanced`: 70% quality and 30% speed normalized relative to the eligible model set.

Grounding therefore gates every recommendation, while speed affects only `fast` and `balanced`. Parameter count and file size never determine quality.

### Cache And Reports

Detailed JSON, Markdown, and raw synthetic model responses are saved under the platform application-data directory, not the Git repository. Set `CV_MATCH_AGENT_DATA_DIR` to override the root. Cache identity includes model name, model digest, benchmark version, fixture version, prompt version, schema version, and requested run count. A change to any of those values invalidates reuse. Corrupt cache files are ignored safely, and `--force` always reruns selected models.

View the latest cached recommendations without starting a benchmark:

```bash
npm run dev -- models recommendations
```

The command verifies that each recommended model is still installed, its digest has not changed, it remains eligible, and the benchmark versions are current.

### Use A Recommendation

Use a valid cached recommendation for analysis:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --mode fast
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --mode balanced
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --mode quality
```

`--model` and `--mode` cannot be combined. `--mode` works only with Ollama and never starts a benchmark automatically. Explicit `--model` selection remains available and existing commands without either option continue to use `OLLAMA_MODEL` or the default. Analysis metadata records whether selection was explicit, environment/default based, or a digest-validated benchmark recommendation.

These results measure suitability for this repository's CV extraction, matching, and grounded-writing tasks on the current machine and Ollama build. They are not general-purpose model rankings, hardware benchmarks, or claims that the largest model is best.

## Run With OpenAI

Set both OpenAI variables in `.env` or your shell:

```env
OPENAI_API_KEY=
OPENAI_MODEL=<your-openai-model>
```

Then run:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider openai
```

The OpenAI provider uses the official OpenAI TypeScript SDK and the Responses API. The model is intentionally not hard-coded; configure `OPENAI_MODEL` yourself.

You can also set OpenAI as the default provider:

```env
DEFAULT_PROVIDER=openai
```

## Build A Profile Context

You can create or replace `context/profile.json` directly:

```bash
npm run dev -- profile build --cv ./examples/cv.md --provider ollama
```

To build profile context with a particular installed Ollama model:

```bash
npm run dev -- profile build --cv ./examples/cv.md --provider ollama --model deepseek-r1:8b
```

PDF CVs are also supported:

```bash
npm run dev -- profile build --cv ./private/resume.pdf --provider ollama
```

Show the saved profile:

```bash
npm run dev -- profile show
```

Delete it:

```bash
npm run dev -- profile reset
```

## Analyze Using Context

Once `context/profile.json` exists, you can analyze a job without passing `--cv`:

```bash
npm run dev -- analyze --job ./examples/job.txt --provider ollama
```

To analyze an explicit CV without saving it to context:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --no-save-context
```

## Example Output

`analyze` writes a new run folder using the parsed candidate name and local timestamp:

```txt
output/Alex_Morgan_2026-06-16_14-30-05/match-report.md
output/Alex_Morgan_2026-06-16_14-30-05/cv-improvements.md
output/Alex_Morgan_2026-06-16_14-30-05/linkedin-message.txt
output/Alex_Morgan_2026-06-16_14-30-05/cover-letter.txt
output/Alex_Morgan_2026-06-16_14-30-05/interview-prep.md
output/Alex_Morgan_2026-06-16_14-30-05/cv-profile.json
output/Alex_Morgan_2026-06-16_14-30-05/semantic-cv.json
output/Alex_Morgan_2026-06-16_14-30-05/review.json
output/Alex_Morgan_2026-06-16_14-30-05/raw-analysis.json
output/Alex_Morgan_2026-06-16_14-30-05/debug/01-CV_profile.json
```

`semantic-cv.json` is the deterministic sectioned CV object extracted before the AI profile step. `cv-profile.json` is the standalone parsed CV profile, including structured skills, education, work experience, projects, companies, and achievements. `review.json` stores the AI review of generated outputs. `raw-analysis.json` includes the semantic CV, parsed profile, job requirements, match analysis, application assets, and review.

`raw-analysis.json` also records the exact provider, model, and model-selection source. Recommendation-based runs include the benchmark mode, version, and model digest used for validation.

The `debug/` folder stores request/response artifacts for each structured AI step and any repair attempt. This is useful when a local model returns invalid JSON or drops evidence from the CV.

The terminal progress looks like:

```txt
Reading CV...
Reading job description...
Loading preferences...
Extracting CV profile...
Extracting job requirements...
Comparing profile to job...
Generating application assets...
Reviewing application output...
Writing output files...

Done.
Generated:
- output/Alex_Morgan_2026-06-16_14-30-05/match-report.md
- output/Alex_Morgan_2026-06-16_14-30-05/cv-improvements.md
- output/Alex_Morgan_2026-06-16_14-30-05/linkedin-message.txt
- output/Alex_Morgan_2026-06-16_14-30-05/cover-letter.txt
- output/Alex_Morgan_2026-06-16_14-30-05/interview-prep.md
- output/Alex_Morgan_2026-06-16_14-30-05/cv-profile.json
- output/Alex_Morgan_2026-06-16_14-30-05/raw-analysis.json
- output/Alex_Morgan_2026-06-16_14-30-05/semantic-cv.json
- output/Alex_Morgan_2026-06-16_14-30-05/review.json
- output/Alex_Morgan_2026-06-16_14-30-05/debug/01-CV_profile.json
```

## Workflow

At a high level, `analyze` runs this flow:

```txt
CV file or saved profile
  -> semantic CV sections
  -> structured CV profile
  -> job requirements
  -> match analysis
  -> application assets
  -> output review
  -> files in output/
```

The semantic CV step keeps the workflow more grounded in the original document. The profile extraction step turns those sections into structured data, and deterministic checks make sure important employment bullets are not dropped before later AI calls spend more tokens.

## Is It An AI Agent?

This is a bounded AI agent workflow rather than an open-ended autonomous agent. The program has a goal, local state, model calls, tools, validation, repair attempts, memory through context files, debug traces, and a review step. It does not dynamically decide arbitrary new tools or run an unbounded planning loop.

That design is intentional: code handles structure, validation, file IO, privacy boundaries, and evidence preservation, while AI handles interpretation, comparison, writing, and review.

## Architecture

```txt
src/
  index.ts
  commands/
    analyze.ts
    profile.ts
    models.ts
  ai/
    ollamaClient.ts
    providers/
      types.ts
      ollamaProvider.ts
      openaiProvider.ts
    prompts.ts
    schemas.ts
    json.ts
  benchmark/
    benchmarkRunner.ts
    cache.ts
    constants.ts
    fixtures.ts
    recommendations.ts
    scoring/
  services/
    runAnalysisWorkflow.ts
    readCvFile.ts
    cvSectionParser.ts
    cvProfileEvidence.ts
    extractCvProfile.ts
    extractJobRequirements.ts
    compareCvToJob.ts
    generateApplicationAssets.ts
    reviewApplicationOutput.ts
    profileContext.ts
    preferencesContext.ts
    validateCvProfile.ts
    cvSections.ts
  utils/
    file.ts
    logger.ts
    output.ts
```

The provider interface returns plain text, so the workflow stays provider-agnostic. Zod schemas validate every structured AI response. If the model wraps JSON in markdown fences or extra prose, the JSON helper attempts to extract and repair a valid object, then validates it again.

## Generated Files

- `match-report.md`: score, summary, strong matches, partial matches, gaps, risks, positioning, and keywords to add.
- `cv-improvements.md`: suggested CV bullet rewrites, skills to emphasize, experience to rewrite, and missing keywords.
- `linkedin-message.txt`: formal outreach message with salutation, relevance points, and a call to action.
- `cover-letter.txt`: role-specific cover letter with a professional closing.
- `interview-prep.md`: likely topics, technical questions, behavioral questions, and suggested talking points.
- `cv-profile.json`: parsed candidate profile used for matching.
- `semantic-cv.json`: sectioned CV evidence used to build the profile.
- `raw-analysis.json`: full structured run data.
- `review.json`: quality review of the generated application assets.
- `debug/*.json`: AI request, response, validation error, and repair artifacts.

## Privacy Notes

- Do not commit real CVs.
- Do not commit `.env`.
- `context/profile.json` is gitignored.
- `context/preferences.json` is gitignored.
- `private/` is gitignored for personal CVs and other local inputs.
- `output/` is gitignored.
- Ollama keeps model calls local to your machine.
- OpenAI mode sends the supplied CV/job content to the OpenAI API.

## Build

```bash
npm run build
npm start -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama
```

## Future Improvements

- Claude provider
- Gemini provider
- DOCX CV parsing
- Job tracker
- Evaluation tests
- Streaming output
- Side-by-side model comparison
- Optional hardware-aware benchmark annotations
- Additional versioned CV-workflow benchmark fixtures
- Local vector search for larger profile/document context
