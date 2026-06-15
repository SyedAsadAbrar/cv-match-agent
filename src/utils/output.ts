import type { ApplicationAssets, MatchAnalysis, RawAnalysis } from "../ai/schemas";
import { writeTextFile } from "./file";

const OUTPUT_FILE_NAMES = [
  "match-report.md",
  "cv-improvements.md",
  "linkedin-message.txt",
  "cover-letter.txt",
  "interview-prep.md",
  "cv-profile.json",
  "raw-analysis.json"
] as const;

export async function writeAnalysisOutput(rawAnalysis: RawAnalysis): Promise<string[]> {
  const outputDir = buildOutputDir(rawAnalysis);
  const outputFiles = OUTPUT_FILE_NAMES.map((fileName) => `${outputDir}/${fileName}`);

  await writeTextFile(outputFiles[0], renderMatchReport(rawAnalysis.matchAnalysis));
  await writeTextFile(outputFiles[1], renderCvImprovements(rawAnalysis.applicationAssets));
  await writeTextFile(outputFiles[2], `${rawAnalysis.applicationAssets.linkedinMessage.trim()}\n`);
  await writeTextFile(outputFiles[3], `${rawAnalysis.applicationAssets.coverLetter.trim()}\n`);
  await writeTextFile(outputFiles[4], renderInterviewPrep(rawAnalysis.applicationAssets));
  await writeTextFile(outputFiles[5], `${JSON.stringify(rawAnalysis.cvProfile, null, 2)}\n`);
  await writeTextFile(outputFiles[6], `${JSON.stringify(rawAnalysis, null, 2)}\n`);

  return outputFiles;
}

function buildOutputDir(rawAnalysis: RawAnalysis): string {
  const candidateName = sanitizePathPart(rawAnalysis.cvProfile.name ?? "candidate");
  const timestamp = formatTimestamp(new Date(rawAnalysis.generatedAt));
  return `output/${candidateName}_${timestamp}`;
}

function sanitizePathPart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "candidate";
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
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
