import { generateJsonWithSchema } from "../ai/json";
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
  return generateJsonWithSchema(
    provider,
    buildAssetGenerationMessages(profile, job, analysis),
    applicationAssetsSchema,
    "application assets"
  );
}
