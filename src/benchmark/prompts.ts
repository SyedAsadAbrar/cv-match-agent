import type { CvProfile, JobRequirements, MatchAnalysis } from "../ai/schemas";
import type { LlmMessage } from "../ai/providers/types";

export function buildGroundedWritingBenchmarkMessages(
  profile: CvProfile,
  requirements: JobRequirements,
  analysis: MatchAnalysis
): LlmMessage[] {
  return [
    {
      role: "system",
      content: "Return one valid JSON object only. Use only supplied evidence. Never invent skills, employers, metrics, certifications, or experience."
    },
    {
      role: "user",
      content: `Create exactly three concise CV-tailoring recommendations and one recruiter message of 45-110 words.

Return exactly:
{
  "recommendations": ["string", "string", "string"],
  "recruiterMessage": "string"
}

Recommendations may describe gaps as gaps, but must never imply the candidate has missing experience. Ground every factual claim in the profile.

Profile:
${JSON.stringify(profile, null, 2)}

Job requirements:
${JSON.stringify(requirements, null, 2)}

Match analysis:
${JSON.stringify(analysis, null, 2)}`
    }
  ];
}
