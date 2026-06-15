import { Command } from "commander";
import { createProvider } from "../ai/providers";
import { extractCvProfile } from "../services/extractCvProfile";
import {
  hasProfileContext,
  loadProfileContext,
  PROFILE_CONTEXT_PATH,
  resetProfileContext,
  saveProfileContext
} from "../services/profileContext";
import { readTextFile } from "../utils/file";
import { logger } from "../utils/logger";

type ProfileBuildOptions = {
  cv: string;
  provider?: string;
};

export function createProfileCommand(): Command {
  const profileCommand = new Command("profile").description("Manage the optional local CV profile context.");

  profileCommand
    .command("build")
    .description("Extract a CV profile and save it to context/profile.json.")
    .requiredOption("--cv <path>", "Path to a CV/resume text or markdown file.")
    .option("--provider <provider>", "LLM provider to use: ollama or openai.")
    .action(async (options: ProfileBuildOptions) => {
      await runProfileBuild(options);
    });

  profileCommand
    .command("show")
    .description("Pretty-print context/profile.json if it exists.")
    .action(async () => {
      await runProfileShow();
    });

  profileCommand
    .command("reset")
    .description("Delete context/profile.json if it exists.")
    .action(async () => {
      await runProfileReset();
    });

  return profileCommand;
}

async function runProfileBuild(options: ProfileBuildOptions): Promise<void> {
  const provider = createProvider(options.provider);

  logger.info("Reading CV...");
  const cvText = await readTextFile(options.cv);

  logger.info("Extracting CV profile...");
  const profile = await extractCvProfile(provider, cvText);

  await saveProfileContext(profile);
  logger.success(`Saved parsed profile to ${PROFILE_CONTEXT_PATH}`);
}

async function runProfileShow(): Promise<void> {
  if (!(await hasProfileContext())) {
    logger.info(`No profile found at ${PROFILE_CONTEXT_PATH}. Run "npm run dev -- profile build --cv <path>".`);
    return;
  }

  const profile = await loadProfileContext();
  logger.info(JSON.stringify(profile, null, 2));
}

async function runProfileReset(): Promise<void> {
  const deleted = await resetProfileContext();

  if (deleted) {
    logger.success(`Deleted ${PROFILE_CONTEXT_PATH}.`);
  } else {
    logger.info(`No profile found at ${PROFILE_CONTEXT_PATH}.`);
  }
}
