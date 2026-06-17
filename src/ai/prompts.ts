import type { CvProfile, JobRequirements, MatchAnalysis, SemanticCv } from "./schemas";
import type { LlmMessage } from "./providers/types";

const jsonOnlySystemPrompt = [
  "You are a careful CV and job-description analysis agent.",
  "Return only one valid JSON object. Do not return a top-level array.",
  "Do not wrap the JSON object in keys like data, result, profile, or analysis.",
  "Do not return JSON as a quoted string.",
  "Do not include markdown fences, commentary, or trailing text.",
  "Do not invent experience, employers, achievements, certifications, tools, or skills.",
  "If evidence is missing, mark it as a gap instead of implying the candidate has it.",
  "Keep scoring realistic and useful. Do not guarantee interviews or job offers."
].join(" ");

export function buildCvExtractionMessages(semanticCv: SemanticCv): LlmMessage[] {
  return [
    { role: "system", content: jsonOnlySystemPrompt },
    {
      role: "user",
      content: `Extract a structured CV profile from the semantic CV sections below.

Return a single JSON object with exactly this shape:
{
  "name": "optional string",
  "currentTitle": "optional string",
  "location": "optional string",
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
  "workExperience": [
    {
      "company": "optional string",
      "role": "optional string",
      "location": "optional string",
      "startDate": "optional string",
      "endDate": "optional string",
      "responsibilities": ["string"],
      "technologies": ["string"],
      "achievements": ["string"]
    }
  ],
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

Extraction rules:
- Use empty arrays where no evidence exists. Omit optional fields when unknown; do not output empty strings.
- Extract candidate location into top-level "location" when present, and role-specific locations into workExperience[].location.
- Extract each work experience entry by company and role into "workExperience"; do not use a "title" key.
- Do not create duplicate entries for the same company, role, startDate, and endDate.
- For each work experience role, process every bullet under that role until the next role or section starts.
- If a bullet wraps across multiple lines in the CV, join it into one complete bullet before classifying it.
- Copy every meaningful work experience bullet for a role into that role's "responsibilities" array. Do not summarize several bullets into only the first bullet.
- Preserve the original meaning and specific metrics of each responsibility. Light cleanup is fine, but do not drop tools, numbers, outcomes, or scope.
- Put measurable impact, scale, savings, growth, awards, mentoring outcomes, performance results, or business outcomes in that same role's "achievements" array as highlighted duplicates.
- Do not move work experience bullets only to top-level "achievements"; keep them attached to their workExperience role.
- Use top-level "achievements" only for standalone awards or achievements outside a specific role.
- If one role mentions multiple technologies, responsibilities, or achievements, combine them into the same workExperience entry.
- Keep "technologies" to concise technology/tool names only, not full responsibility phrases.
- Keep "companies" as a simple list of employer names.
- The "summary" field is required; if the CV has no explicit summary, write a concise evidence-based summary from the CV content.

Semantic CV sections:
${JSON.stringify(semanticCv, null, 2)}`
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

Use empty arrays where no evidence exists. Omit optional fields when unknown. Extract job location exactly when present, including remote/hybrid/on-site signals.

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
- Use profile.workExperience, projects, achievements, skills, and education as primary evidence.
- Missing required skills should appear in gaps or risks.
- Only evaluate education when job.educationRequirements is non-empty.
- If the job has no educationRequirements, do not add education or degree gaps.
- If the job requires a degree or educational background, compare it against profile.education and mark missing evidence as a gap only when it is genuinely missing.
- Compare job.location against profile.location and workExperience locations when available. If location, remote, hybrid, relocation, or work authorization requirements are unclear or unsupported, include that under gaps or risks.

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
- Format the LinkedIn message as a concise note with a salutation, relevant background/fit, and a clear ask.
- Use either one short paragraph after the salutation or two compact paragraphs total; do not force three paragraphs.
- Keep the LinkedIn message formal, direct, recruiter-friendly, meaningful, and roughly 60-100 words.
- Avoid casual phrasing such as "excited", exclamation marks, or overly enthusiastic language.
- The cover letter should be substantial enough to be useful: 4-6 concise paragraphs and roughly 250-400 words.
- Keep the cover letter formal, direct, and professional. Avoid casual phrasing, exclamation marks, and overly enthusiastic language.
- Make the cover letter specific to the role, company, profile evidence, and match analysis.
- End the cover letter with a professional closing in the format "Regards," followed by the candidate's name on the next line. If the candidate name is unknown, use "Regards," followed by "Candidate".
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
