#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { createAnalyzeCommand } from "./commands/analyze";
import { createProfileCommand } from "./commands/profile";
import { logger } from "./utils/logger";

const program = new Command();

program
  .name("cv-match-agent")
  .description("Local-first AI CV and job-description matching agent.")
  .version("0.1.0");

program.addCommand(createAnalyzeCommand());
program.addCommand(createProfileCommand());

program.exitOverride();

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error && error.name === "CommanderError") {
      const commanderError = error as Error & { code?: string; exitCode?: number };
      process.exitCode = commanderError.code === "commander.helpDisplayed" ? 0 : commanderError.exitCode ?? 1;
      return;
    }

    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
