import type { MatchAnalysis } from "../../ai/schemas";
import type { ProfileMatchingExpected } from "../fixtureTypes";
import type { BenchmarkScore, ScoreReason } from "../types";
import { allStringValues, clampScore, includesConcept, matchedConceptIds, weightedTaskScore } from "./utils";

const DEDUCTIONS = {
  missingStrongMatch: 9,
  missingPartialMatch: 5,
  missingGap: 14,
  wrongCategory: 7,
  unsupportedClaim: 35,
  scoreOutsideRange: 5
} as const;

export function scoreProfileMatching(
  output: MatchAnalysis,
  expected: ProfileMatchingExpected,
  schemaValid = true
): BenchmarkScore {
  const reasons: ScoreReason[] = [];
  let completeness = 100;
  let grounding = 100;
  const positive = [...output.strongMatches, ...output.partialMatches, output.summary, output.suggestedPositioning];
  const gaps = [...output.gaps, ...output.risks];
  const allValues = allStringValues(output);

  for (const concept of expected.strongMatches) {
    if (includesConcept(output.strongMatches, concept)) continue;
    const wrongCategory = includesConcept([...output.partialMatches, ...gaps], concept);
    const deduction = wrongCategory ? DEDUCTIONS.wrongCategory : DEDUCTIONS.missingStrongMatch;
    completeness -= deduction;
    reasons.push({ code: wrongCategory ? "strong-match-wrong-category" : "missing-strong-match", deduction, detail: concept.id });
  }

  for (const concept of expected.partialMatches) {
    if (!includesConcept([...output.partialMatches, ...gaps], concept)) {
      completeness -= DEDUCTIONS.missingPartialMatch;
      reasons.push({ code: "missing-transferable-match", deduction: DEDUCTIONS.missingPartialMatch, detail: concept.id });
    }
  }

  for (const concept of expected.gaps) {
    if (!includesConcept(gaps, concept)) {
      completeness -= DEDUCTIONS.missingGap;
      reasons.push({ code: "missing-genuine-gap", deduction: DEDUCTIONS.missingGap, detail: concept.id });
    }
  }

  const unsupported = expected.forbidden.filter((concept) => includesConcept(positive, concept));
  for (const concept of unsupported) {
    grounding -= DEDUCTIONS.unsupportedClaim;
    reasons.push({ code: "unsupported-profile-claim", deduction: DEDUCTIONS.unsupportedClaim, detail: concept.id });
  }

  if (output.matchScore < expected.matchScoreRange[0] || output.matchScore > expected.matchScoreRange[1]) {
    completeness -= DEDUCTIONS.scoreOutsideRange;
    reasons.push({
      code: "match-score-outside-reasonable-range",
      deduction: DEDUCTIONS.scoreOutsideRange,
      detail: String(output.matchScore)
    });
  }

  completeness = clampScore(completeness);
  grounding = clampScore(grounding);
  const semanticFacts = [
    ...matchedConceptIds(output.strongMatches, expected.strongMatches),
    ...matchedConceptIds([...output.partialMatches, ...gaps], expected.partialMatches),
    ...matchedConceptIds(gaps, expected.gaps),
    ...unsupported.map((concept) => concept.id)
  ].sort();

  return {
    completenessScore: completeness,
    groundingScore: grounding,
    taskScore: weightedTaskScore(grounding, completeness, schemaValid),
    semanticFacts,
    catastrophicFabrication: unsupported.length > 0,
    reasons
  };
}
