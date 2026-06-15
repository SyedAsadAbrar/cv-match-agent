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
  await writeTextFile(outputFiles[2], renderLinkedinMessage(rawAnalysis.applicationAssets.linkedinMessage));
  await writeTextFile(outputFiles[3], renderCoverLetter(rawAnalysis.applicationAssets.coverLetter, rawAnalysis));
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

function renderLinkedinMessage(message: string): string {
  const trimmed = normalizeTechnologySpacing(message).trim();
  if (!trimmed) {
    return "\n";
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length >= 2) {
    return `${paragraphs.slice(0, 2).join("\n\n")}\n`;
  }

  const sentences = splitSentences(trimmed);
  if (sentences.length <= 2) {
    return `${trimmed}\n`;
  }

  const greeting = sentences[0];
  const body = sentences.slice(1).join(" ");
  const formatted = [greeting, body].filter(Boolean).join("\n\n");

  return `${formatted}\n`;
}

function normalizeTechnologySpacing(text: string): string {
  return text
    .replace(/\b(Node|React|Next|Vue|Express|Angular)\.\s+js\b/gi, "$1.js")
    .replace(/\b(Postgre)\s+SQL\b/gi, "PostgreSQL");
}

function renderCoverLetter(coverLetter: string, rawAnalysis: RawAnalysis): string {
  const trimmed = normalizeTechnologySpacing(coverLetter).trim();
  const candidateName = rawAnalysis.cvProfile.name?.trim() || "Candidate";

  if (hasProfessionalClosing(trimmed)) {
    return `${trimmed}\n`;
  }

  return `${trimmed}\n\nRegards,\n${candidateName}\n`;
}

function hasProfessionalClosing(text: string): boolean {
  return /(?:^|\n)\s*(regards|sincerely|best regards|kind regards),?\s*(?:\n|$)/i.test(text);
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return matches?.map((sentence) => sentence.trim()).filter(Boolean) ?? [text.trim()];
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
