import type { JobRequirements } from "../../ai/schemas";
import type { JobExtractionExpected } from "../fixtureTypes";
import type { BenchmarkScore, ScoreReason } from "../types";
import { allStringValues, clampScore, includesConcept, matchedConceptIds, weightedTaskScore } from "./utils";

const DEDUCTIONS = {
  missingRequired: 14,
  missingPreferred: 6,
  misclassifiedRequired: 10,
  misclassifiedPreferred: 5,
  missingGroundedFact: 3,
  inventedRequirement: 30
} as const;

export function scoreJobExtraction(
  output: JobRequirements,
  expected: JobExtractionExpected,
  schemaValid = true
): BenchmarkScore {
  const reasons: ScoreReason[] = [];
  let completeness = 100;
  let grounding = 100;
  const required = output.requiredSkills;
  const preferred = output.niceToHaveSkills;
  const allValues = allStringValues(output);

  for (const concept of expected.required) {
    if (includesConcept(required, concept)) continue;
    const misclassified = includesConcept(preferred, concept);
    const deduction = misclassified ? DEDUCTIONS.misclassifiedRequired : DEDUCTIONS.missingRequired;
    completeness -= deduction;
    reasons.push({
      code: misclassified ? "required-classified-preferred" : "missing-required",
      deduction,
      detail: concept.id
    });
  }

  for (const concept of expected.preferred) {
    if (includesConcept(preferred, concept)) continue;
    const misclassified = includesConcept(required, concept);
    const deduction = misclassified ? DEDUCTIONS.misclassifiedPreferred : DEDUCTIONS.missingPreferred;
    completeness -= deduction;
    reasons.push({
      code: misclassified ? "preferred-classified-required" : "missing-preferred",
      deduction,
      detail: concept.id
    });
  }

  for (const concept of expected.grounded) {
    if (!includesConcept(allValues, concept)) {
      completeness -= DEDUCTIONS.missingGroundedFact;
      reasons.push({ code: "missing-grounded-fact", deduction: DEDUCTIONS.missingGroundedFact, detail: concept.id });
    }
  }

  const invented = expected.forbidden.filter((concept) => includesConcept(allValues, concept));
  for (const concept of invented) {
    grounding -= DEDUCTIONS.inventedRequirement;
    reasons.push({ code: "invented-requirement", deduction: DEDUCTIONS.inventedRequirement, detail: concept.id });
  }

  completeness = clampScore(completeness);
  grounding = clampScore(grounding);
  const semanticFacts = [
    ...matchedConceptIds(required, expected.required),
    ...matchedConceptIds(preferred, expected.preferred),
    ...matchedConceptIds(allValues, expected.grounded),
    ...invented.map((concept) => concept.id)
  ].sort();

  return {
    completenessScore: completeness,
    groundingScore: grounding,
    taskScore: weightedTaskScore(grounding, completeness, schemaValid),
    semanticFacts,
    catastrophicFabrication: invented.length > 0,
    reasons
  };
}
