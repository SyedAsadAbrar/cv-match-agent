import { promises as fs } from "node:fs";
import path from "node:path";
import { cvProfileSchema, jobRequirementsSchema, matchAnalysisSchema } from "../ai/schemas";
import type {
  BenchmarkFixtures,
  GroundedWritingExpected,
  JobExtractionExpected,
  ProfileMatchingExpected
} from "./fixtureTypes";

export async function loadBenchmarkFixtures(rootDir = process.cwd()): Promise<BenchmarkFixtures> {
  const fixtureRoot = path.join(rootDir, "benchmark", "fixtures");
  const readText = (relativePath: string) => fs.readFile(path.join(fixtureRoot, relativePath), "utf8");
  const readJson = async (relativePath: string): Promise<unknown> => JSON.parse(await readText(relativePath)) as unknown;

  return {
    jobExtraction: {
      input: await readText("job-extraction/input.txt"),
      expected: (await readJson("job-extraction/expected.json")) as JobExtractionExpected
    },
    profileMatching: {
      profile: cvProfileSchema.parse(await readJson("profile-matching/profile.json")),
      requirements: jobRequirementsSchema.parse(await readJson("profile-matching/requirements.json")),
      expected: (await readJson("profile-matching/expected.json")) as ProfileMatchingExpected
    },
    groundedWriting: {
      profile: cvProfileSchema.parse(await readJson("grounded-writing/profile.json")),
      requirements: jobRequirementsSchema.parse(await readJson("grounded-writing/requirements.json")),
      matchAnalysis: matchAnalysisSchema.parse(await readJson("grounded-writing/match-analysis.json")),
      expected: (await readJson("grounded-writing/expected.json")) as GroundedWritingExpected
    }
  };
}
