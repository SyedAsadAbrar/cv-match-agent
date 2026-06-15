import type { CvProfile, JobRequirements, MatchAnalysis } from "./schemas";
import type { LlmMessage } from "./providers/types";

const jsonOnlySystemPrompt = [
  "You are a careful CV and job-description analysis agent.",
  "Return only one valid JSON object. Do not return a top-level array.",
  "Do not wrap the JSON object in keys like data, result, profile, or analysis.",
  "Do not include markdown fences, commentary, or trailing text.",
  "Do not invent experience, employers, achievements, certifications, tools, or skills.",
  "If evidence is missing, mark it as a gap instead of implying the candidate has it.",
  "Keep scoring realistic and useful. Do not guarantee interviews or job offers."
].join(" ");

export function buildCvExtractionMessages(cvText: string): LlmMessage[] {
  return [
    { role: "system", content: jsonOnlySystemPrompt },
    {
      role: "user",
      content: `Extract a structured CV profile from the CV below.

Return a single JSON object with exactly this shape:
{
  "name": "optional string",
  "currentTitle": "optional string",
  "yearsOfExperience": 0,
  "summary": "string",
  "education": [
    {
      "degree": "optional string",
      "institution": "optional string",
      "field": "optional string",
      "graduationYear": 2020,
      "notes": "optional string"
    }
  ],
  "skills": ["string"],
  "industries": ["string"],
  "companies": ["string"],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "technologies": ["string"],
      "impact": "optional string"
    }
  ],
  "achievements": ["string"]
}

Use empty arrays where no evidence exists. Omit optional fields when unknown. The "summary" field is required; if the CV has no explicit summary, write a concise evidence-based summary from the CV content.

CV:
${cvText}`
    }
  ];
}

export function buildJobExtractionMessages(jobText: string): LlmMessage[] {
  return [
    { role: "system", content: jsonOnlySystemPrompt },
    {
      role: "user",
      content: `Extract structured job requirements from the job description below.

Return a single JSON object with exactly this shape:
{
  "roleTitle": "string",
  "company": "optional string",
  "location": "optional string",
  "seniority": "optional string",
  "requiredSkills": ["string"],
  "niceToHaveSkills": ["string"],
  "educationRequirements": ["string"],
  "responsibilities": ["string"],
  "domain": "optional string",
  "keywords": ["string"]
}

Use empty arrays where no evidence exists. Omit optional fields when unknown.

Job description:
${jobText}`
    }
  ];
}

export function buildComparisonMessages(profile: CvProfile, job: JobRequirements): LlmMessage[] {
  return [
    { role: "system", content: jsonOnlySystemPrompt },
    {
      role: "user",
      content: `Compare the candidate profile against the job requirements.

Return a single JSON object with exactly this shape:
{
  "matchScore": 0,
  "summary": "string",
  "strongMatches": ["string"],
  "partialMatches": ["string"],
  "gaps": ["string"],
  "risks": ["string"],
  "suggestedPositioning": "string",
  "keywordSuggestions": ["string"]
}

Rules:
- matchScore must be a number from 0 to 100.
- Prefer specific evidence from the profile.
- Do not hallucinate missing experience.
- Missing required skills should appear in gaps or risks.
- If the job requires a degree or educational background, compare it against profile.education and mark missing evidence as a gap.

Candidate profile JSON:
${JSON.stringify(profile, null, 2)}

Job requirements JSON:
${JSON.stringify(job, null, 2)}`
    }
  ];
}

export function buildAssetGenerationMessages(
  profile: CvProfile,
  job: JobRequirements,
  analysis: MatchAnalysis
): LlmMessage[] {
  return [
    { role: "system", content: jsonOnlySystemPrompt },
    {
      role: "user",
      content: `Generate application assets based only on the profile, job requirements, and match analysis.

Return a single JSON object with exactly this shape:
{
  "cvImprovements": {
    "improvedBullets": ["string"],
    "skillsToEmphasize": ["string"],
    "experienceToRewrite": ["string"],
    "missingKeywords": ["string"]
  },
  "linkedinMessage": "string",
  "coverLetter": "string",
  "interviewPrep": {
    "likelyInterviewTopics": ["string"],
    "technicalQuestions": ["string"],
    "behavioralQuestions": ["string"],
    "suggestedTalkingPoints": ["string"]
  }
}

Rules:
- The LinkedIn message must start with a professional salutation; use the recipient's name if present, otherwise use "Hello,".
- The LinkedIn message should include 2-3 sentences of relevant candidate background before the ask.
- Keep the LinkedIn message natural, recruiter-friendly, and roughly 120-170 words.
- The cover letter should be substantial enough to be useful: 4-6 concise paragraphs and roughly 250-400 words.
- Make the cover letter specific to the role, company, profile evidence, and match analysis.
- Do not claim experience that is not present in the profile.
- Missing keywords should be keywords from the job that are not clearly present in the profile.
- Do not imply any guarantee of interviews or offers.

Candidate profile JSON:
${JSON.stringify(profile, null, 2)}

Job requirements JSON:
${JSON.stringify(job, null, 2)}

Match analysis JSON:
${JSON.stringify(analysis, null, 2)}`
    }
  ];
}
