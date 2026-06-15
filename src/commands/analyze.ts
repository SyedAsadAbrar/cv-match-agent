import { Command } from "commander";
import { createProvider } from "../ai/providers";
import type { LlmProvider } from "../ai/providers/types";
import { rawAnalysisSchema, type CvProfile } from "../ai/schemas";
import { compareCvToJob } from "../services/compareCvToJob";
import { extractCvProfile } from "../services/extractCvProfile";
import { extractJobRequirements } from "../services/extractJobRequirements";
import { generateApplicationAssets } from "../services/generateApplicationAssets";
import {
  hasProfileContext,
  loadProfileContext,
  PROFILE_CONTEXT_PATH,
  saveProfileContext
} from "../services/profileContext";
import { readTextFile } from "../utils/file";
import { logger } from "../utils/logger";
import { OUTPUT_FILES, writeAnalysisOutput } from "../utils/output";

type AnalyzeOptions = {
  cv?: string;
  job: string;
  provider?: string;
  saveContext?: boolean;
};

export function createAnalyzeCommand(): Command {
  return new Command("analyze")
    .description("Analyze a CV/profile against a job description and generate application assets.")
    .option("--cv <path>", "Path to a CV/resume text or markdown file.")
    .requiredOption("--job <path>", "Path to a job description text file.")
    .option("--provider <provider>", "LLM provider to use: ollama or openai.")
    .option("--save-context", "Save an extracted --cv profile to context/profile.json.")
    .action(async (options: AnalyzeOptions) => {
      await runAnalyze(options);
    });
}

async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  let cvText: string | undefined;
  let profile: CvProfile;
  let provider: LlmProvider | undefined;

  if (options.cv) {
    logger.info("Reading CV...");
    cvText = await readTextFile(options.cv);
  }

  logger.info("Reading job description...");
  const jobText = await readTextFile(options.job);

  if (cvText) {
    provider = createProvider(options.provider);
    logger.info("Extracting CV profile...");
    profile = await extractCvProfile(provider, cvText);

    if (options.saveContext) {
      await saveProfileContext(profile);
      logger.success(`Saved parsed profile to ${PROFILE_CONTEXT_PATH}`);
    }
  } else if (await hasProfileContext()) {
    logger.info(`Loading profile from ${PROFILE_CONTEXT_PATH}...`);
    profile = await loadProfileContext();
  } else {
    throw new Error("No CV provided and no context/profile.json found. Pass --cv or run profile build.");
  }

  provider ??= createProvider(options.provider);

  logger.info("Extracting job requirements...");
  const jobRequirements = await extractJobRequirements(provider, jobText);

  logger.info("Comparing profile to job...");
  const matchAnalysis = await compareCvToJob(provider, profile, jobRequirements);

  logger.info("Generating application assets...");
  const applicationAssets = await generateApplicationAssets(provider, profile, jobRequirements, matchAnalysis);

  const rawAnalysis = rawAnalysisSchema.parse({
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    cvProfile: profile,
    jobRequirements,
    matchAnalysis,
    applicationAssets
  });

  logger.info("Writing output files...");
  const generated = await writeAnalysisOutput(rawAnalysis);

  logger.success("");
  logger.success("Done.");
  logger.success("Generated:");
  for (const filePath of generated ?? OUTPUT_FILES) {
    logger.success(`- ${filePath}`);
  }
}
