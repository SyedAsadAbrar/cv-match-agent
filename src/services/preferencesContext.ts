import { userPreferencesSchema, type UserPreferences } from "../ai/schemas";
import { fileExists, readTextFile } from "../utils/file";

export const PREFERENCES_CONTEXT_PATH = "context/preferences.json";

export async function loadUserPreferences(): Promise<UserPreferences> {
  if (!(await fileExists(PREFERENCES_CONTEXT_PATH))) {
    return defaultPreferences();
  }

  const raw = await readTextFile(PREFERENCES_CONTEXT_PATH);
  const parsed = JSON.parse(raw) as unknown;
  return userPreferencesSchema.parse(parsed);
}

function defaultPreferences(): UserPreferences {
  return {
    linkedinTone: "formal and concise",
    coverLetterLength: "medium",
    preferredRoles: [],
    avoidPhrases: ["excited", "perfect fit"]
  };
}
