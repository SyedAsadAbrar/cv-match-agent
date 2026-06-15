# cv-match-agent

`cv-match-agent` is a production-oriented TypeScript CLI for matching a CV against a job description with an AI workflow. It extracts structured CV and job data, scores the match, and generates practical application assets from the terminal.

There is no frontend, database, authentication, or remote app server. The tool is local-first: files are read from your machine, outputs are written to `output/`, and you can use a local Ollama model when you do not want CV content sent to a cloud provider.

## Stateless By Default

Version 1 is stateless by default. When you pass `--cv`, the CLI reads and extracts that CV for the current run only.

An optional local context file is supported at:

```txt
context/profile.json
```

That file stores a previously extracted CV profile. It is only used when `analyze` is run without `--cv`. Explicit CLI input always wins: if both `--cv` and `context/profile.json` exist, the CLI uses `--cv`.

The app does not automatically save parsed CV data during `analyze`. Use `--save-context` or `profile build` when you want to write `context/profile.json`.

## Install

```bash
npm install
```

Copy the environment template and adjust it:

```bash
cp .env.example .env
```

## Run With Ollama

Install and start Ollama, then make sure the model exists locally:

```bash
ollama pull llama3.1:8b
```

Run an analysis with an explicit CV:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama
```

The Ollama provider uses:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

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

## Build A Profile Context

Create or replace `context/profile.json`:

```bash
npm run dev -- profile build --cv ./examples/cv.md --provider ollama
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

To save context while analyzing an explicit CV:

```bash
npm run dev -- analyze --cv ./examples/cv.md --job ./examples/job.txt --provider ollama --save-context
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
output/Alex_Morgan_2026-06-16_14-30-05/raw-analysis.json
```

`cv-profile.json` is the standalone parsed CV object. `raw-analysis.json` includes the parsed CV, job requirements, match analysis, and generated application assets.

The terminal progress looks like:

```txt
Reading CV...
Reading job description...
Extracting CV profile...
Extracting job requirements...
Comparing profile to job...
Generating application assets...
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
```

## Architecture

```txt
src/
  index.ts
  commands/
    analyze.ts
    profile.ts
  ai/
    providers/
      types.ts
      ollamaProvider.ts
      openaiProvider.ts
    prompts.ts
    schemas.ts
    json.ts
  services/
    extractCvProfile.ts
    extractJobRequirements.ts
    compareCvToJob.ts
    generateApplicationAssets.ts
    profileContext.ts
  utils/
    file.ts
    logger.ts
    output.ts
```

The provider interface returns plain text, so the workflow stays provider-agnostic. Zod schemas validate every structured AI response. If the model wraps JSON in markdown fences or extra prose, the JSON helper attempts to extract a valid object and validates it again.

## Privacy Notes

- Do not commit real CVs.
- Do not commit `.env`.
- `context/profile.json` is gitignored.
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
- PDF CV parsing
- DOCX CV parsing
- Job tracker
- Evaluation tests
- Streaming output
- Side-by-side model comparison
- Local vector search for larger profile/document context
