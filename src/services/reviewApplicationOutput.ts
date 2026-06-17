import { generateJsonWithSchema } from "../ai/json";
import { buildOutputReviewMessages } from "../ai/prompts";
import {
  outputReviewSchema,
  type ApplicationAssets,
  type CvProfile,
  type JobRequirements,
  type MatchAnalysis,
  type OutputReview,
  type UserPreferences
} from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function reviewApplicationOutput(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements,
  analysis: MatchAnalysis,
  assets: ApplicationAssets,
  preferences: UserPreferences
): Promise<OutputReview> {
  return generateJsonWithSchema(
    provider,
    buildOutputReviewMessages(profile, job, analysis, assets, preferences),
    outputReviewSchema,
    "output review"
  );
}
