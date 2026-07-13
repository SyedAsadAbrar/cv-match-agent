import type { ExpectedConcept } from "../fixtureTypes";

export function normalizeBenchmarkText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

export function includesConcept(values: string[], concept: ExpectedConcept): boolean {
  const haystack = normalizeBenchmarkText(values.join(" | "));
  return concept.aliases.some((alias) => haystack.includes(normalizeBenchmarkText(alias)));
}

export function matchedConceptIds(values: string[], concepts: ExpectedConcept[]): string[] {
  return concepts.filter((concept) => includesConcept(values, concept)).map((concept) => concept.id).sort();
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export function weightedTaskScore(
  groundingScore: number,
  completenessScore: number,
  schemaValid: boolean
): number {
  return clampScore(groundingScore * 0.45 + completenessScore * 0.35 + (schemaValid ? 100 : 0) * 0.2);
}

export function allStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStringValues);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(allStringValues);
  return [];
}
