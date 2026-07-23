import { z } from "zod";
import { htmlToSafeText } from "../../security/content";
import { safeFetch, type SafeFetchOptions } from "../../security/safeFetch";
import type { CrawledJob } from "../../company/crawler";

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? "");
const pinpointJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().min(1),
    url: z.string().url(),
    description: optionalText,
    key_responsibilities: optionalText,
    skills_knowledge_expertise: optionalText,
    employment_type_text: optionalText,
    workplace_type_text: optionalText,
    location: z
      .object({
        city: optionalText,
        name: optionalText,
      })
      .nullish(),
  })
  .passthrough();
const pinpointBoardSchema = z.object({ data: z.array(pinpointJobSchema) });

export function isPinpointBoardUrl(input: string | undefined): boolean {
  if (!input) return false;
  try {
    const url = new URL(input);
    return (
      (url.hostname === "pinpointhq.com" ||
        url.hostname.endsWith(".pinpointhq.com")) &&
      /^\/[a-z]{2}(?:-[a-z]{2})?\/postings\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function crawlPinpointBoard(
  boardUrl: string,
  options: SafeFetchOptions = {},
): Promise<CrawledJob[]> {
  if (!isPinpointBoardUrl(boardUrl))
    throw new Error(
      "Pinpoint board URL must use the public postings endpoint.",
    );
  const response = await safeFetch(boardUrl, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
    allowedContentTypes: ["application/json"],
    maxBytes: options.maxBytes ?? 2_000_000,
  });
  if (!response.ok)
    throw new Error(`Pinpoint board returned HTTP ${response.status}.`);
  const payload = pinpointBoardSchema.parse(await response.json());
  return payload.data.map((job) => ({
    title: job.title,
    url: job.url,
    description: htmlToSafeText(
      [
        job.description,
        job.key_responsibilities,
        job.skills_knowledge_expertise,
        job.employment_type_text,
        job.workplace_type_text,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    locationText:
      [job.location?.city, job.location?.name].filter(Boolean).join(", ") ||
      undefined,
  }));
}
