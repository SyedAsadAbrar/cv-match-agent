import type { CvProfile } from "../ai/schemas";

export function assertUsableCvProfile(profile: CvProfile): void {
  const issues: string[] = [];

  if (!hasText(profile.name)) {
    issues.push("candidate name is missing");
  }

  if (!hasText(profile.currentTitle) && !profile.workExperience.some((experience) => hasText(experience.role))) {
    issues.push("current title or at least one work experience role is missing");
  }

  if (profile.skills.length < 3) {
    issues.push("fewer than 3 skills were extracted");
  }

  if (!hasMeaningfulExperience(profile)) {
    issues.push("no meaningful work experience or project evidence was extracted");
  }

  if (issues.length > 0) {
    throw new Error(
      `CV profile extraction looks incomplete: ${issues.join("; ")}. ` +
        "No further AI calls were made. Try rerunning with a stronger model, a clearer CV, or a different provider."
    );
  }
}

function hasMeaningfulExperience(profile: CvProfile): boolean {
  return (
    profile.workExperience.some(
      (experience) =>
        (hasText(experience.company) || hasText(experience.role)) &&
        (hasText(experience.description) ||
          experience.responsibilities.length > 0 ||
          experience.achievements.length > 0 ||
          experience.technologies.length > 0)
    ) ||
    profile.projects.length > 0 ||
    profile.achievements.length > 0
  );
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
