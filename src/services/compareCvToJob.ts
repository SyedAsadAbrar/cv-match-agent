import { parseJsonWithSchema } from "../ai/json";
import { buildComparisonMessages } from "../ai/prompts";
import { matchAnalysisSchema, type CvProfile, type JobRequirements, type MatchAnalysis } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function compareCvToJob(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements
): Promise<MatchAnalysis> {
  const response = await provider.generateText(buildComparisonMessages(profile, job));
  return parseJsonWithSchema(response, matchAnalysisSchema, "match analysis");
}
