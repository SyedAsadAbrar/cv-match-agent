import { generateJsonWithSchema } from "../ai/json";
import { buildCvExtractionMessages } from "../ai/prompts";
import { cvProfileSchema, type CvProfile } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function extractCvProfile(provider: LlmProvider, cvText: string): Promise<CvProfile> {
  return generateJsonWithSchema(provider, buildCvExtractionMessages(cvText), cvProfileSchema, "CV profile");
}
