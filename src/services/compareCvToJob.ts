import { generateJsonWithSchema } from "../ai/json";
import { buildComparisonMessages } from "../ai/prompts";
import { matchAnalysisSchema, type CvProfile, type JobRequirements, type MatchAnalysis } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";

export async function compareCvToJob(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements
): Promise<MatchAnalysis> {
  const analysis = await generateJsonWithSchema(
    provider,
    buildComparisonMessages(profile, job),
    matchAnalysisSchema,
    "match analysis"
  );

  return removeInvalidEducationGaps(analysis, profile, job);
}

function removeInvalidEducationGaps(
  analysis: MatchAnalysis,
  profile: CvProfile,
  job: JobRequirements
): MatchAnalysis {
  if (job.educationRequirements.length > 0 && !profileSatisfiesEducation(profile, job)) {
    return analysis;
  }

  return {
    ...analysis,
    gaps: analysis.gaps.filter((gap) => !mentionsEducation(gap)),
    risks: analysis.risks.filter((risk) => !mentionsEducation(risk))
  };
}

function profileSatisfiesEducation(profile: CvProfile, job: JobRequirements): boolean {
  const educationText = profile.education
    .flatMap((education) => [education.degree, education.field, education.institution, education.notes])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  return job.educationRequirements.every((requirement) => {
    const normalizedRequirement = requirement.toLowerCase();

    if (normalizedRequirement.includes("computer science")) {
      return educationText.includes("computer science");
    }

    if (/\b(bs|b\.s\.|bachelor|degree)\b/.test(normalizedRequirement)) {
      return /\b(bs|b\.s\.|bachelor)\b/.test(educationText) || educationText.includes("degree");
    }

    return educationText.includes(normalizedRequirement);
  });
}

function mentionsEducation(value: string): boolean {
  return /\b(degree|education|educational|bachelor|b\.s\.|bs|computer science)\b/i.test(value);
}
