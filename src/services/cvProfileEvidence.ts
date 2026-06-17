import type { CvProfile, SemanticCv } from "../ai/schemas";

type SemanticCvItem = SemanticCv["sections"][number]["items"][number];

export function assertProfilePreservesEmploymentBullets(profile: CvProfile, semanticCv: SemanticCv): void {
  const missing: string[] = [];
  const profileExperience = profile.workExperience;

  for (const sourceItem of getEmploymentItems(semanticCv)) {
    const profileItem = findMatchingProfileExperience(profileExperience, sourceItem);

    if (!profileItem) {
      missing.push(`${sourceItem.heading}: no matching profile experience`);
      continue;
    }

    for (const bullet of sourceItem.bullets) {
      if (!profileItem.responsibilities.some((responsibility) => sameMeaning(responsibility, bullet))) {
        missing.push(`${sourceItem.heading}: ${bullet}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `CV profile extraction dropped ${missing.length} employment bullet(s). ` +
        `First missing bullet: ${missing[0]}. No further AI calls were made.`
    );
  }
}

export function mergeEmploymentBulletsIntoProfile(profile: CvProfile, semanticCv: SemanticCv): CvProfile {
  const workExperience = profile.workExperience.map((experience) => ({ ...experience }));

  for (const sourceItem of getEmploymentItems(semanticCv)) {
    const profileItem = findMatchingProfileExperience(workExperience, sourceItem);

    if (profileItem) {
      profileItem.responsibilities = mergeBullets(sourceItem.bullets, profileItem.responsibilities);
      continue;
    }

    workExperience.push({
      company: sourceItem.company,
      role: sourceItem.role,
      location: sourceItem.location,
      startDate: sourceItem.startDate,
      endDate: sourceItem.endDate,
      responsibilities: sourceItem.bullets,
      technologies: [],
      achievements: []
    });
  }

  return { ...profile, workExperience };
}

function getEmploymentItems(semanticCv: SemanticCv): SemanticCvItem[] {
  return semanticCv.sections.flatMap((section) => (section.type === "employment" ? section.items : []));
}

function findMatchingProfileExperience(
  experiences: CvProfile["workExperience"],
  sourceItem: SemanticCvItem
): CvProfile["workExperience"][number] | undefined {
  let bestMatch: CvProfile["workExperience"][number] | undefined;
  let bestScore = 0;

  for (const experience of experiences) {
    const score =
      matchScore(experience.company, sourceItem.company, 3) +
      matchScore(experience.role, sourceItem.role, 3) +
      matchScore(experience.startDate, sourceItem.startDate, 1) +
      matchScore(experience.endDate, sourceItem.endDate, 1);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = experience;
    }
  }

  return bestScore >= 4 ? bestMatch : undefined;
}

function mergeBullets(sourceBullets: string[], profileBullets: string[]): string[] {
  const merged: string[] = [];

  for (const bullet of [...sourceBullets, ...profileBullets]) {
    if (!merged.some((existing) => sameMeaning(existing, bullet))) {
      merged.push(bullet);
    }
  }

  return merged;
}

function matchScore(left: string | undefined, right: string | undefined, score: number): number {
  if (!left || !right) {
    return 0;
  }

  const normalizedLeft = normalizeForMatch(left);
  const normalizedRight = normalizeForMatch(right);

  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft) ? score : 0;
}

function sameMeaning(left: string, right: string): boolean {
  const normalizedLeft = normalizeForMatch(left);
  const normalizedRight = normalizeForMatch(right);

  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
