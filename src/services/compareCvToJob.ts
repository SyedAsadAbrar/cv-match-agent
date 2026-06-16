import { generateJsonWithSchema } from "../ai/json";
import { buildComparisonMessages } from "../ai/prompts";
import { matchAnalysisSchema, type CvProfile, type JobRequirements, type MatchAnalysis } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";
import { logger } from "../utils/logger";
import { buildFallbackMatchAnalysis } from "./fallbackMatchAnalysis";

export async function compareCvToJob(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements
): Promise<MatchAnalysis> {
  try {
    return await generateJsonWithSchema(provider, buildComparisonMessages(profile, job), matchAnalysisSchema, "match analysis");
  } catch (error) {
    logger.warn(
      `Could not get valid match analysis JSON from ${provider.name}; using deterministic fallback analysis. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return buildFallbackMatchAnalysis(profile, job);
  }
}
