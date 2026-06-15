import { parseJsonWithSchema } from "../ai/json";
import { buildJobExtractionMessages } from "../ai/prompts";
import { jobRequirementsSchema, type JobRequirements } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function extractJobRequirements(
  provider: LlmProvider,
  jobText: string
): Promise<JobRequirements> {
  const response = await provider.generateText(buildJobExtractionMessages(jobText));
  return parseJsonWithSchema(response, jobRequirementsSchema, "job requirements");
}
