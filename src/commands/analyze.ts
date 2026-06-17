import { Command } from "commander";
import { setAiDebugRecorder, type AiDebugArtifact } from "../ai/json";
import { createProvider } from "../ai/providers";
import type { LlmProvider } from "../ai/providers/types";
import {
  rawAnalysisSchema,
  type ApplicationAssets,
  type CvProfile,
  type JobRequirements,
  type MatchAnalysis,
  type OutputReview,
  type SemanticCv,
  type UserPreferences
} from "../ai/schemas";
import { compareCvToJob } from "../services/compareCvToJob";
import { extractCvProfile } from "../services/extractCvProfile";
import { extractJobRequirements } from "../services/extractJobRequirements";
import { generateApplicationAssets } from "../services/generateApplicationAssets";
import { loadUserPreferences } from "../services/preferencesContext";
import {
  hasProfileContext,
  loadProfileContext,
  PROFILE_CONTEXT_PATH,
  saveProfileContext
} from "../services/profileContext";
import { readCvFile } from "../services/readCvFile";
import { reviewApplicationOutput } from "../services/reviewApplicationOutput";
import { assertUsableCvProfile } from "../services/validateCvProfile";
import { readTextFile } from "../utils/file";
import { logger } from "../utils/logger";
import { writeAnalysisOutput } from "../utils/output";

type AnalyzeOptions = {
  cv?: string;
  job: string;
  provider?: string;
  saveContext?: boolean;
};

type AnalyzeState = {
  provider?: LlmProvider;
  cvText?: string;
  jobText?: string;
  profile?: CvProfile;
  semanticCv?: SemanticCv;
  preferences?: UserPreferences;
  jobRequirements?: JobRequirements;
  matchAnalysis?: MatchAnalysis;
  applicationAssets?: ApplicationAssets;
  review?: OutputReview;
  debugArtifacts: AiDebugArtifact[];
};

export function createAnalyzeCommand(): Command {
  return new Command("analyze")
    .description("Analyze a CV/profile against a job description and generate application assets.")
    .option("--cv <path>", "Path to a CV/resume PDF, text, or markdown file.")
    .requiredOption("--job <path>", "Path to a job description text file.")
    .option("--provider <provider>", "LLM provider to use: ollama or openai.")
    .option("--no-save-context", "Do not save an extracted --cv profile to context/profile.json.")
    .action(async (options: AnalyzeOptions) => {
      await runAnalyze(options);
    });
}

async function runAnalyze(options: AnalyzeOptions): Promise<void> {
  const state: AnalyzeState = { debugArtifacts: [] };
  setAiDebugRecorder((artifact) => state.debugArtifacts.push(artifact));

  try {
    if (options.cv) {
      logger.info("Reading CV...");
      state.cvText = await readCvFile(options.cv);
    }

    logger.info("Reading job description...");
    state.jobText = await readTextFile(options.job);

    logger.info("Loading preferences...");
    state.preferences = await loadUserPreferences();

    if (state.cvText) {
      state.provider = createProvider(options.provider);
      logger.info("Extracting CV profile...");
      const extracted = await extractCvProfile(state.provider, state.cvText);
      state.profile = extracted.profile;
      state.semanticCv = extracted.semanticCv;
      assertUsableCvProfile(state.profile);

      if (options.saveContext !== false) {
        await saveProfileContext(state.profile);
        logger.success(`Saved parsed profile to ${PROFILE_CONTEXT_PATH}`);
      }
    } else if (await hasProfileContext()) {
      logger.info(`Loading profile from ${PROFILE_CONTEXT_PATH}...`);
      state.profile = await loadProfileContext();
      assertUsableCvProfile(state.profile);
    } else {
      throw new Error("No CV provided and no context/profile.json found. Pass --cv or run profile build.");
    }

    state.provider ??= createProvider(options.provider);

    logger.info("Extracting job requirements...");
    state.jobRequirements = await extractJobRequirements(state.provider, state.jobText);

    logger.info("Comparing profile to job...");
    state.matchAnalysis = await compareCvToJob(state.provider, state.profile, state.jobRequirements);

    logger.info("Generating application assets...");
    state.applicationAssets = await generateApplicationAssets(
      state.provider,
      state.profile,
      state.jobRequirements,
      state.matchAnalysis,
      state.preferences
    );

    logger.info("Reviewing application output...");
    state.review = await reviewApplicationOutput(
      state.provider,
      state.profile,
      state.jobRequirements,
      state.matchAnalysis,
      state.applicationAssets,
      state.preferences
    );

    const rawAnalysis = rawAnalysisSchema.parse({
      provider: state.provider.name,
      generatedAt: new Date().toISOString(),
      semanticCv: state.semanticCv,
      cvProfile: state.profile,
      jobRequirements: state.jobRequirements,
      matchAnalysis: state.matchAnalysis,
      applicationAssets: state.applicationAssets,
      review: state.review
    });

    logger.info("Writing output files...");
    const generated = await writeAnalysisOutput(rawAnalysis, state.debugArtifacts);

    logger.success("");
    logger.success("Done.");
    logger.success("Generated:");
    for (const filePath of generated) {
      logger.success(`- ${filePath}`);
    }
  } finally {
    setAiDebugRecorder(undefined);
  }
}
