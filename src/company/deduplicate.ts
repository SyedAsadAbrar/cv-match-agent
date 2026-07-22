import type { TargetCompany } from "../domain/schemas";
import { normaliseCompanyName, normaliseDomain } from "./normalise";

export type CompanyDuplicateCandidate = {
  leftId: string;
  rightId: string;
  confidence: "high" | "medium";
  reasons: string[];
};

export function findCompanyDuplicates(
  companies: TargetCompany[],
): CompanyDuplicateCandidate[] {
  const buckets = new Map<string, TargetCompany[]>();
  for (const company of companies) {
    const domain = normaliseDomain(company.companyDomain);
    if (domain) addToBucket(buckets, `domain:${domain}`, company);
    for (const name of [
      ...new Set(
        [company.legalName, company.displayName, ...company.aliases]
          .map(normaliseCompanyName)
          .filter(Boolean),
      ),
    ])
      for (const country of company.operatingCountries)
        addToBucket(buckets, `name:${name}\u0000${country}`, company);
  }
  const candidates: CompanyDuplicateCandidate[] = [];
  const compared = new Set<string>();
  for (const bucket of buckets.values()) {
    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < bucket.length;
        rightIndex += 1
      ) {
        const pair = [bucket[leftIndex].id, bucket[rightIndex].id]
          .sort()
          .join("\u0000");
        if (compared.has(pair)) continue;
        compared.add(pair);
        const duplicate = compareCompanies(
          bucket[leftIndex],
          bucket[rightIndex],
        );
        if (duplicate) candidates.push(duplicate);
      }
    }
  }
  return candidates;
}

function addToBucket(
  buckets: Map<string, TargetCompany[]>,
  key: string,
  company: TargetCompany,
): void {
  const bucket = buckets.get(key) ?? [];
  if (!bucket.some((candidate) => candidate.id === company.id))
    bucket.push(company);
  buckets.set(key, bucket);
}

export function compareCompanies(
  left: TargetCompany,
  right: TargetCompany,
): CompanyDuplicateCandidate | undefined {
  const reasons: string[] = [];
  const leftDomain = normaliseDomain(left.companyDomain);
  const rightDomain = normaliseDomain(right.companyDomain);
  if (leftDomain && rightDomain && leftDomain === rightDomain)
    reasons.push(`Shared official domain: ${leftDomain}`);

  const leftNames = [left.legalName, left.displayName, ...left.aliases].map(
    normaliseCompanyName,
  );
  const rightNames = [right.legalName, right.displayName, ...right.aliases].map(
    normaliseCompanyName,
  );
  const commonName = leftNames.find(
    (name) => name && rightNames.includes(name),
  );
  const countriesOverlap = left.operatingCountries.some((country) =>
    right.operatingCountries.includes(country),
  );
  if (commonName && countriesOverlap)
    reasons.push(`Matching name and country: ${commonName}`);

  if (reasons.length === 0) return undefined;
  return {
    leftId: left.id,
    rightId: right.id,
    confidence: leftDomain && leftDomain === rightDomain ? "high" : "medium",
    reasons,
  };
}
