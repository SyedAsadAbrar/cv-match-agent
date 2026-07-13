import type { GroundedWritingExpected } from "../fixtureTypes";
import type { GroundedWritingOutput } from "../schemas";
import type { BenchmarkScore, ScoreReason } from "../types";
import { allStringValues, clampScore, includesConcept, matchedConceptIds, weightedTaskScore } from "./utils";

const DEDUCTIONS = {
  missingConcept: 12,
  recommendationCount: 15,
  messageLength: 10,
  fabricatedClaim: 35,
  unsupportedSuperlative: 15
} as const;

export function scoreGroundedWriting(
  output: GroundedWritingOutput,
  expected: GroundedWritingExpected,
  schemaValid = true
): BenchmarkScore {
  const reasons: ScoreReason[] = [];
  let completeness = 100;
  let grounding = 100;
  const allValues = allStringValues(output);

  for (const concept of expected.requiredConcepts) {
    if (!includesConcept(allValues, concept)) {
      completeness -= DEDUCTIONS.missingConcept;
      reasons.push({ code: "missing-job-concept", deduction: DEDUCTIONS.missingConcept, detail: concept.id });
    }
  }

  if (output.recommendations.length !== expected.recommendationCount) {
    completeness -= DEDUCTIONS.recommendationCount;
    reasons.push({ code: "recommendation-count", deduction: DEDUCTIONS.recommendationCount, detail: String(output.recommendations.length) });
  }

  const wordCount = output.recruiterMessage.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < expected.messageWordRange[0] || wordCount > expected.messageWordRange[1]) {
    completeness -= DEDUCTIONS.messageLength;
    reasons.push({ code: "message-length", deduction: DEDUCTIONS.messageLength, detail: String(wordCount) });
  }

  const forbidden = expected.forbidden.filter((concept) => includesConcept(allValues, concept));
  for (const concept of forbidden) {
    const deduction = concept.id === "unsupported-superlative"
      ? DEDUCTIONS.unsupportedSuperlative
      : DEDUCTIONS.fabricatedClaim;
    grounding -= deduction;
    reasons.push({ code: concept.id === "unsupported-superlative" ? "unsupported-superlative" : "fabricated-claim", deduction, detail: concept.id });
  }

  completeness = clampScore(completeness);
  grounding = clampScore(grounding);
  const semanticFacts = [
    ...matchedConceptIds(allValues, expected.requiredConcepts),
    ...forbidden.map((concept) => concept.id)
  ].sort();

  return {
    completenessScore: completeness,
    groundingScore: grounding,
    taskScore: weightedTaskScore(grounding, completeness, schemaValid),
    semanticFacts,
    catastrophicFabrication: forbidden.some((concept) => concept.id !== "unsupported-superlative"),
    reasons
  };
}
