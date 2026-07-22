import type { CandidateProfile } from "../domain/schemas";

export type SearchPlan = {
  generatedAt: string;
  roles: string[];
  skills: string[];
  locations: string[];
  queries: string[];
};

export function generateSearchPlan(profile: CandidateProfile): SearchPlan {
  const roles = unique(profile.targetRoles).slice(0, 8);
  const skills = unique(
    profile.skills
      .filter(
        (skill) => skill.proficiency !== "exposure" && skill.confidence >= 0.5,
      )
      .map((skill) => skill.name),
  ).slice(0, 6);
  const locations = unique(profile.targetCountries).slice(0, 8);
  const queries = new Set<string>();
  const skillTerms = skills.slice(0, 3).join(" ");

  for (const role of roles) {
    for (const location of locations.length > 0 ? locations : [""]) {
      queries.add(clean(`${role} ${skillTerms} ${location} careers`));
      if (
        profile.personal.requiresWorkPermit &&
        location !== profile.personal.currentCountry
      ) {
        queries.add(clean(`${role} ${location} visa sponsorship relocation`));
      }
    }
  }
  for (const role of roles.slice(0, 4)) {
    for (const host of [
      "boards.greenhouse.io",
      "jobs.lever.co",
      "jobs.ashbyhq.com",
    ]) {
      queries.add(clean(`site:${host} ${role} ${locations[0] ?? ""}`));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    roles,
    skills,
    locations,
    queries: [...queries].filter(Boolean).slice(0, 40),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
