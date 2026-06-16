import { generateJsonWithSchema } from "../ai/json";
import { buildComparisonMessages } from "../ai/prompts";
import { matchAnalysisSchema, type CvProfile, type JobRequirements, type MatchAnalysis } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function compareCvToJob(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements
): Promise<MatchAnalysis> {
  return generateJsonWithSchema(provider, buildComparisonMessages(profile, job), matchAnalysisSchema, "match analysis");
}
