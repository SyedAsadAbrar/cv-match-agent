import { randomUUID } from "node:crypto";
import type { CvProfile } from "../ai/schemas";
import {
  candidateProfileSchema,
  createInitialCandidateProfile,
  type CandidateProfile,
} from "../domain/schemas";

export type DiscoveryProfileExtraction = {
  profile: CandidateProfile;
  sourceClaims: string[];
};

export function convertCvProfile(
  profile: CvProfile,
  existing = createInitialCandidateProfile(),
): DiscoveryProfileExtraction {
  const sourceClaims: string[] = [];
  if (profile.summary) sourceClaims.push("summary");
  const experience = profile.workExperience.map((item, index) => {
    if (item.company) sourceClaims.push(`experience.${index}.company`);
    if (item.role) sourceClaims.push(`experience.${index}.title`);
    for (
      let achievement = 0;
      achievement < item.achievements.length;
      achievement += 1
    ) {
      sourceClaims.push(`experience.${index}.achievements.${achievement}`);
    }
    return {
      id: randomUUID(),
      company: item.company ?? "Unknown employer",
      title: item.role ?? "Unknown role",
      startDate: item.startDate,
      endDate: item.endDate,
      isCurrent: !item.endDate || /present|current/i.test(item.endDate),
      achievements: [...item.achievements, ...item.responsibilities],
      technologies: item.technologies,
    };
  });
  const skills = profile.skills.map((name, index) => {
    sourceClaims.push(`skills.${index}.name`);
    const evidence = profile.workExperience.flatMap((item) =>
      [...item.responsibilities, ...item.achievements].filter((claim) =>
        claim.toLowerCase().includes(name.toLowerCase()),
      ),
    );
    return {
      name,
      proficiency: "working" as const,
      evidence,
      confidence: evidence.length > 0 ? 0.9 : 0.75,
    };
  });
  return {
    profile: candidateProfileSchema.parse({
      ...existing,
      personal: {
        ...existing.personal,
        currentCity:
          inferCity(profile.location) ?? existing.personal.currentCity,
      },
      summary: profile.summary,
      experience,
      education: profile.education.flatMap((item) =>
        item.institution
          ? [
              {
                institution: item.institution,
                degree: item.degree,
                field: item.field,
                graduationYear: item.graduationYear,
              },
            ]
          : [],
      ),
      skills,
    }),
    sourceClaims,
  };
}

function inferCity(location?: string): string | undefined {
  return location?.split(",")[0]?.trim() || undefined;
}
