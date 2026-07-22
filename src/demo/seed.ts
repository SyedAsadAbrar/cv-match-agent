import { JobCopilotStore } from "../db/store";
import { runDiscovery } from "../discovery/pipeline";
import { createDemoConnectors, DEMO_COMPANIES } from "./fixtures";

export async function seedDemo(store = new JobCopilotStore()) {
  const profile = store.getProfile();
  store.saveProfile(
    {
      ...profile,
      targetCountries: ["United Arab Emirates", "Netherlands", "Germany"],
      skills:
        profile.skills.length > 0
          ? profile.skills
          : [
              {
                name: "React",
                proficiency: "strong",
                estimatedYears: 6,
                evidence: ["Fictional demo profile evidence"],
                confidence: 0.95,
              },
              {
                name: "TypeScript",
                proficiency: "strong",
                estimatedYears: 6,
                evidence: ["Fictional demo profile evidence"],
                confidence: 0.95,
              },
              {
                name: "JavaScript",
                proficiency: "strong",
                estimatedYears: 8,
                evidence: ["Fictional demo profile evidence"],
                confidence: 0.95,
              },
              {
                name: "Node.js",
                proficiency: "working",
                estimatedYears: 3,
                evidence: ["Fictional demo profile evidence"],
                confidence: 0.8,
              },
            ],
    },
    ["Demo profile data is fictional"],
  );
  for (const company of DEMO_COMPANIES) store.saveCompany(company);
  return runDiscovery({
    store,
    companies: DEMO_COMPANIES,
    connectors: createDemoConnectors(),
    analyse: false,
    verify: false,
  });
}
