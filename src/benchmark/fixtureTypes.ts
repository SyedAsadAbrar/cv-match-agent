import type { CvProfile, JobRequirements, MatchAnalysis } from "../ai/schemas";

export type ExpectedConcept = {
  id: string;
  aliases: string[];
};

export type JobExtractionExpected = {
  fixtureVersion: string;
  required: ExpectedConcept[];
  preferred: ExpectedConcept[];
  grounded: ExpectedConcept[];
  forbidden: ExpectedConcept[];
};

export type ProfileMatchingExpected = {
  fixtureVersion: string;
  strongMatches: ExpectedConcept[];
  partialMatches: ExpectedConcept[];
  gaps: ExpectedConcept[];
  forbidden: ExpectedConcept[];
  matchScoreRange: [number, number];
};

export type GroundedWritingExpected = {
  fixtureVersion: string;
  requiredConcepts: ExpectedConcept[];
  forbidden: ExpectedConcept[];
  recommendationCount: number;
  messageWordRange: [number, number];
};

export type BenchmarkFixtures = {
  jobExtraction: {
    input: string;
    expected: JobExtractionExpected;
  };
  profileMatching: {
    profile: CvProfile;
    requirements: JobRequirements;
    expected: ProfileMatchingExpected;
  };
  groundedWriting: {
    profile: CvProfile;
    requirements: JobRequirements;
    matchAnalysis: MatchAnalysis;
    expected: GroundedWritingExpected;
  };
};
