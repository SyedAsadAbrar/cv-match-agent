import { generateJsonWithSchema } from "../ai/json";
import { buildComparisonMessages } from "../ai/prompts";
import { matchAnalysisSchema, type CvProfile, type JobRequirements, type MatchAnalysis } from "../ai/schemas";
import type { LlmProvider } from "../ai/providers/types";
import { logger } from "../utils/logger";

export async function compareCvToJob(
  provider: LlmProvider,
  profile: CvProfile,
  job: JobRequirements
): Promise<MatchAnalysis> {
  try {
    return await generateJsonWithSchema(provider, buildComparisonMessages(profile, job), matchAnalysisSchema, "match analysis");
  } catch (error) {
    logger.warn(
      `Could not get valid match analysis JSON from ${provider.name}; using deterministic fallback analysis. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return buildFallbackMatchAnalysis(profile, job);
  }
}

function buildFallbackMatchAnalysis(profile: CvProfile, job: JobRequirements): MatchAnalysis {
  const evidenceText = buildEvidenceText(profile);
  const requiredSkillMatches = partitionByEvidence(job.requiredSkills, evidenceText);
  const niceToHaveMatches = partitionByEvidence(job.niceToHaveSkills, evidenceText);
  const educationMatches = partitionByEvidence(job.educationRequirements, evidenceText);
  const keywordMatches = partitionByEvidence(job.keywords, evidenceText);
  const totalRequirements = job.requiredSkills.length + job.educationRequirements.length;
  const matchedRequirements = requiredSkillMatches.matches.length + educationMatches.matches.length;
  const requiredCoverage = totalRequirements === 0 ? 0.65 : matchedRequirements / totalRequirements;
  const niceCoverage =
    job.niceToHaveSkills.length === 0 ? 0 : niceToHaveMatches.matches.length / job.niceToHaveSkills.length;
  const keywordCoverage = job.keywords.length === 0 ? 0 : keywordMatches.matches.length / job.keywords.length;
  const experienceBonus = profile.workExperience.length > 0 ? 8 : 0;
  const projectBonus = profile.projects.length > 0 ? 5 : 0;
  const matchScore = clampScore(
    Math.round(requiredCoverage * 70 + niceCoverage * 10 + keywordCoverage * 7 + experienceBonus + projectBonus)
  );
  const strongMatches = [
    ...requiredSkillMatches.matches.map((skill) => `Required skill evidence found: ${skill}`),
    ...educationMatches.matches.map((requirement) => `Education evidence found: ${requirement}`)
  ];
  const partialMatches = [
    ...niceToHaveMatches.matches.map((skill) => `Nice-to-have evidence found: ${skill}`),
    ...keywordMatches.matches
      .filter((keyword) => !hasCaseInsensitive(requiredSkillMatches.matches, keyword))
      .map((keyword) => `Keyword evidence found: ${keyword}`)
  ];
  const gaps = [
    ...requiredSkillMatches.missing.map((skill) => `No clear evidence for required skill: ${skill}`),
    ...educationMatches.missing.map((requirement) => `No clear evidence for education requirement: ${requirement}`)
  ];
  const keywordSuggestions = uniqueCaseInsensitive([
    ...requiredSkillMatches.missing,
    ...niceToHaveMatches.missing,
    ...keywordMatches.missing
  ]).slice(0, 12);
  const risks = gaps.length > 0 ? ["Some required evidence was not found in the parsed CV profile."] : [];
  const fallbackSummary =
    `Fallback analysis based on parsed CV/profile data. Estimated match is ${matchScore}/100 against ` +
    `${job.roleTitle}. Review the generated gaps carefully because no LLM match analysis JSON was available.`;

  return matchAnalysisSchema.parse({
    matchScore,
    summary: fallbackSummary,
    strongMatches,
    partialMatches,
    gaps,
    risks,
    suggestedPositioning: buildSuggestedPositioning(profile, job, strongMatches, gaps),
    keywordSuggestions
  });
}

function buildEvidenceText(profile: CvProfile): string {
  const values: string[] = [
    profile.summary,
    profile.currentTitle,
    ...profile.skills,
    ...profile.industries,
    ...profile.companies,
    ...profile.achievements,
    ...profile.education.flatMap((education) => [
      education.degree,
      education.institution,
      education.field,
      education.notes
    ]),
    ...profile.workExperience.flatMap((experience) => [
      experience.company,
      experience.role,
      experience.location,
      experience.description,
      ...experience.responsibilities,
      ...experience.technologies,
      ...experience.achievements
    ]),
    ...profile.projects.flatMap((project) => [
      project.name,
      project.description,
      project.impact,
      ...project.technologies
    ])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return values.join("\n").toLowerCase();
}

function partitionByEvidence(items: string[], evidenceText: string): { matches: string[]; missing: string[] } {
  const matches: string[] = [];
  const missing: string[] = [];

  for (const item of uniqueCaseInsensitive(items)) {
    if (hasEvidence(item, evidenceText)) {
      matches.push(item);
    } else {
      missing.push(item);
    }
  }

  return { matches, missing };
}

function hasEvidence(item: string, evidenceText: string): boolean {
  const normalized = item.toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (evidenceText.includes(normalized)) {
    return true;
  }

  const tokens = normalized
    .split(/[^a-z0-9.+#]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (tokens.length === 0) {
    return false;
  }

  const matchedTokens = tokens.filter((token) => evidenceText.includes(token.toLowerCase()));
  return matchedTokens.length / tokens.length >= 0.75;
}

function buildSuggestedPositioning(
  profile: CvProfile,
  job: JobRequirements,
  strongMatches: string[],
  gaps: string[]
): string {
  const role = profile.currentTitle ? `${profile.currentTitle} background` : "relevant delivery experience";
  const strongestEvidence =
    strongMatches.length > 0
      ? `Lead with ${strongMatches.slice(0, 3).map((match) => match.replace(/^.*: /, "")).join(", ")}.`
      : "Lead with the most relevant work experience, projects, and measurable outcomes from the CV.";
  const gapNote =
    gaps.length > 0
      ? "Address missing required evidence directly and avoid claiming skills or credentials not present in the profile."
      : "Reinforce the fit with specific examples from work experience and projects.";

  return `Position the candidate's ${role} for the ${job.roleTitle} role. ${strongestEvidence} ${gapNote}`;
}

function uniqueCaseInsensitive(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function hasCaseInsensitive(items: string[], value: string): boolean {
  return items.some((item) => item.toLowerCase() === value.toLowerCase());
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
