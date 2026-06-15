import { cvProfileSchema, type CvProfile } from "../ai/schemas";
import { deleteFileIfExists, fileExists, readTextFile, writeTextFile } from "../utils/file";

export const PROFILE_CONTEXT_PATH = "context/profile.json";

export async function hasProfileContext(): Promise<boolean> {
  return fileExists(PROFILE_CONTEXT_PATH);
}

export async function loadProfileContext(): Promise<CvProfile> {
  const raw = await readTextFile(PROFILE_CONTEXT_PATH);
  const parsed = JSON.parse(raw) as unknown;
  const result = cvProfileSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`context/profile.json is not a valid CV profile: ${result.error.message}`);
  }

  return result.data;
}

export async function saveProfileContext(profile: CvProfile): Promise<void> {
  await writeTextFile(PROFILE_CONTEXT_PATH, `${JSON.stringify(profile, null, 2)}\n`);
}

export async function resetProfileContext(): Promise<boolean> {
  return deleteFileIfExists(PROFILE_CONTEXT_PATH);
}
