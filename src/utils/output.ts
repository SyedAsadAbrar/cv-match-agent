import type { ApplicationAssets, MatchAnalysis, RawAnalysis } from "../ai/schemas";
import { writeTextFile } from "./file";

export const OUTPUT_FILES = [
  "output/match-report.md",
  "output/cv-improvements.md",
  "output/linkedin-message.txt",
  "output/cover-letter.txt",
  "output/interview-prep.md",
  "output/raw-analysis.json"
] as const;

export async function writeAnalysisOutput(rawAnalysis: RawAnalysis): Promise<typeof OUTPUT_FILES> {
  await writeTextFile("output/match-report.md", renderMatchReport(rawAnalysis.matchAnalysis));
  await writeTextFile("output/cv-improvements.md", renderCvImprovements(rawAnalysis.applicationAssets));
  await writeTextFile("output/linkedin-message.txt", `${rawAnalysis.applicationAssets.linkedinMessage.trim()}\n`);
  await writeTextFile("output/cover-letter.txt", `${rawAnalysis.applicationAssets.coverLetter.trim()}\n`);
  await writeTextFile("output/interview-prep.md", renderInterviewPrep(rawAnalysis.applicationAssets));
  await writeTextFile("output/raw-analysis.json", `${JSON.stringify(rawAnalysis, null, 2)}\n`);

  return OUTPUT_FILES;
}

function renderMatchReport(analysis: MatchAnalysis): string {
  return `# CV Match Report

## Match Score

${Math.round(analysis.matchScore)}/100

## Executive Summary

${analysis.summary}

## Strong Matches

${renderList(analysis.strongMatches)}

## Partial Matches

${renderList(analysis.partialMatches)}

## Gaps

${renderList(analysis.gaps)}

## Risks

${renderList(analysis.risks)}

## Suggested Positioning

${analysis.suggestedPositioning}

## Keywords To Add

${renderList(analysis.keywordSuggestions)}
`;
}

function renderCvImprovements(assets: ApplicationAssets): string {
  return `# CV Improvements

## Suggested Improved CV Bullets

${renderList(assets.cvImprovements.improvedBullets)}

## Skills To Emphasize

${renderList(assets.cvImprovements.skillsToEmphasize)}

## Experience That Should Be Rewritten

${renderList(assets.cvImprovements.experienceToRewrite)}

## Missing Keywords From The Job Description

${renderList(assets.cvImprovements.missingKeywords)}
`;
}

function renderInterviewPrep(assets: ApplicationAssets): string {
  return `# Interview Prep

## Likely Interview Topics

${renderList(assets.interviewPrep.likelyInterviewTopics)}

## Technical Questions

${renderList(assets.interviewPrep.technicalQuestions)}

## Behavioral Questions

${renderList(assets.interviewPrep.behavioralQuestions)}

## Suggested Talking Points

${renderList(assets.interviewPrep.suggestedTalkingPoints)}
`;
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "- None identified";
  }

  return items.map((item) => `- ${item}`).join("\n");
}
