import { parseJsonWithSchema } from "../ai/json";
import { buildAssetGenerationMessages } from "../ai/prompts";
import {
  applicationAssetsSchema,
  type ApplicationAssets,
  type CvProfile,
  type JobRequirements,
  type MatchAnalysis
} from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function generateApplicationAssets(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements,
  analysis: MatchAnalysis
): Promise<ApplicationAssets> {
  const response = await provider.generateText(buildAssetGenerationMessages(profile, job, analysis));
  return parseJsonWithSchema(response, applicationAssetsSchema, "application assets");
}
