import { randomUUID } from "node:crypto";
import type {
  JobPosting,
  SalaryAnalysis,
  SalaryEvidence,
} from "../domain/schemas";

export function analyseSalary(
  job: JobPosting,
  comparableJobs: JobPosting[] = [],
  now = new Date().toISOString(),
): SalaryAnalysis {
  const evidence: SalaryEvidence[] = [];
  if (
    job.compensation?.currency &&
    job.compensation.period &&
    (job.compensation.minimum !== undefined ||
      job.compensation.maximum !== undefined)
  ) {
    evidence.push({
      id: randomUUID(),
      evidenceType: "job-advertisement",
      sourceName: job.sourceName ?? job.company,
      sourceUrl: job.canonicalUrl,
      jobTitle: job.title,
      company: job.company,
      country: job.country,
      city: job.city,
      minimum: job.compensation.minimum,
      maximum: job.compensation.maximum,
      currency: job.compensation.currency,
      period: job.compensation.period,
      grossOrNet: job.compensation.grossOrNet ?? "unknown",
      collectedAt: now,
      confidence: 0.95,
    });
  }
  const comparableEvidence = comparableJobs.flatMap(
    (candidate): SalaryEvidence[] => {
      const compensation = candidate.compensation;
      if (
        !compensation?.currency ||
        !compensation.period ||
        (compensation.minimum === undefined &&
          compensation.maximum === undefined) ||
        titleSimilarity(job.title, candidate.title) < 0.35 ||
        candidate.country !== job.country
      )
        return [];
      return [
        {
          id: randomUUID(),
          evidenceType:
            candidate.company === job.company
              ? "same-company-comparable"
              : "market-comparable-job",
          sourceName: candidate.sourceName ?? candidate.company,
          sourceUrl: candidate.canonicalUrl,
          jobTitle: candidate.title,
          company: candidate.company,
          country: candidate.country,
          city: candidate.city,
          minimum: compensation.minimum,
          maximum: compensation.maximum,
          currency: compensation.currency,
          period: compensation.period,
          grossOrNet: compensation.grossOrNet ?? "unknown",
          collectedAt: now,
          confidence: candidate.company === job.company ? 0.8 : 0.65,
        },
      ];
    },
  );
  evidence.push(...removeSalaryOutliers(comparableEvidence));
  const advertised = evidence.find(
    (item) => item.evidenceType === "job-advertisement",
  );
  const comparableGroup = evidence.filter(
    (item) => item.evidenceType !== "job-advertisement",
  );
  const market = buildMarketRange(comparableGroup);
  const directRange = advertised
    ? {
        minimum: advertised.minimum,
        maximum: advertised.maximum,
        currency: advertised.currency,
        period: advertised.period,
        grossOrNet: advertised.grossOrNet,
      }
    : undefined;
  const expectationRange = directRange ?? market;
  const comparableToCurrent =
    expectationRange?.currency === "AED" &&
    expectationRange.period === "monthly";
  const midpoint = expectationRange
    ? midpointOf(expectationRange.minimum, expectationRange.maximum)
    : undefined;
  const comparisonStatus = !expectationRange
    ? "insufficient-evidence"
    : !comparableToCurrent
      ? "not-comparable"
      : midpoint === undefined
        ? "insufficient-evidence"
        : midpoint < 19800
          ? "potential-decrease"
          : midpoint > 24200
            ? "potential-increase"
            : "roughly-equivalent";
  return {
    advertisedSalary: directRange,
    estimatedMarketRange: market,
    recommendedExpectation:
      midpoint !== undefined && expectationRange
        ? {
            amount: midpoint,
            currency: expectationRange.currency,
            period: expectationRange.period,
          }
        : undefined,
    currentSalary: { amount: 22000, currency: "AED", period: "monthly" },
    comparisonStatus,
    confidence: advertised
      ? "high"
      : comparableGroup.length >= 5
        ? "medium"
        : "low",
    evidenceCount: evidence.length,
    evidence,
    missingInformation: [
      ...(!expectationRange
        ? [
            "No salary was advertised and no sufficiently comparable local jobs were collected.",
          ]
        : []),
      ...(!comparableToCurrent && expectationRange
        ? [
            "Tax, gross/net basis, exchange rate, benefits, and cost of living are not normalised.",
          ]
        : []),
    ],
    explanation: advertised
      ? "The expectation is derived from salary stated directly in the vacancy."
      : market
        ? `The market range is derived from ${comparableGroup.length} recent comparable stored job(s) after outlier handling.`
        : "There is insufficient collected evidence to estimate a defensible salary range.",
  };
}

export function removeSalaryOutliers(
  evidence: SalaryEvidence[],
): SalaryEvidence[] {
  const groups = new Map<string, SalaryEvidence[]>();
  for (const item of evidence) {
    const key = salaryGroupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].flatMap(removeGroupOutliers);
}

function removeGroupOutliers(evidence: SalaryEvidence[]): SalaryEvidence[] {
  if (evidence.length < 4) return evidence;
  const values = evidence
    .map((item) => midpointOf(item.minimum, item.maximum))
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (values.length < 4) return evidence;
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const spread = q3 - q1;
  return evidence.filter((item) => {
    const value = midpointOf(item.minimum, item.maximum);
    return (
      value === undefined ||
      (value >= q1 - 1.5 * spread && value <= q3 + 1.5 * spread)
    );
  });
}

function buildMarketRange(
  evidence: SalaryEvidence[],
): SalaryAnalysis["estimatedMarketRange"] {
  if (evidence.length < 2) return undefined;
  const groups = new Map<string, SalaryEvidence[]>();
  for (const item of evidence) {
    const key = salaryGroupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const group = [...groups.values()].sort(
    (left, right) => right.length - left.length,
  )[0];
  if (!group || group.length < 2) return undefined;
  const minimums = group
    .map((item) => item.minimum ?? item.maximum)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  const maximums = group
    .map((item) => item.maximum ?? item.minimum)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  return {
    minimum: percentile(minimums, 0.5),
    maximum: percentile(maximums, 0.5),
    currency: group[0].currency,
    period: group[0].period,
    grossOrNet: group[0].grossOrNet,
  };
}

function salaryGroupKey(
  evidence: Pick<SalaryEvidence, "currency" | "period" | "grossOrNet">,
): string {
  return `${evidence.currency}:${evidence.period}:${evidence.grossOrNet}`;
}

function percentile(values: number[], position: number): number {
  const index = (values.length - 1) * position;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return (
    values[lower] +
    (values[lower + 1] === undefined
      ? 0
      : fraction * (values[lower + 1] - values[lower]))
  );
}

function midpointOf(minimum?: number, maximum?: number): number | undefined {
  if (minimum !== undefined && maximum !== undefined)
    return Math.round((minimum + maximum) / 2);
  return minimum ?? maximum;
}

function titleSimilarity(left: string, right: string): number {
  const a = new Set(
    left
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 2),
  );
  const b = new Set(
    right
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 2),
  );
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}
