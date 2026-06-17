import { generateJsonWithSchema } from "../ai/json";
import { buildCvExtractionMessages } from "../ai/prompts";
import { cvProfileSchema, type CvProfile, type SemanticCv } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";
import {
  assertProfilePreservesEmploymentBullets,
  extractCvSections,
  mergeEmploymentBulletsIntoProfile
} from "./cvSections";

export type ExtractedCvProfile = {
  profile: CvProfile;
  semanticCv: SemanticCv;
};

export async function extractCvProfile(provider: LlmProvider, cvText: string): Promise<ExtractedCvProfile> {
  const semanticCv = extractCvSections(cvText);
  const profile = await generateJsonWithSchema(
    provider,
    buildCvExtractionMessages(semanticCv),
    cvProfileSchema,
    "CV profile"
  );
  const mergedProfile = mergeEmploymentBulletsIntoProfile(profile, semanticCv);

  assertProfilePreservesEmploymentBullets(mergedProfile, semanticCv);

  return { profile: mergedProfile, semanticCv };
}
