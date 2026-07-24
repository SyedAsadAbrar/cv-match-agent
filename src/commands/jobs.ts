import { Command } from "commander";
import { OllamaLocalAIProvider } from "../ai/localAIProvider";
import { runDiscovery } from "../discovery/pipeline";
import { createConfiguredWebSearchProvider } from "../discovery/webSearch";
import { logger } from "../utils/logger";

export function createJobsCommand(): Command {
  const jobs = new Command("jobs").description(
    "Discover and rank jobs from configured sources.",
  );
  jobs
    .command("discover")
    .description(
      "Run one autonomous discovery batch without requiring a job URL.",
    )
    .option("--no-ai", "Skip detailed Ollama shortlist analysis.")
    .option(
      "--no-verify",
      "Trust the current official ATS listing without a per-job verification request.",
    )
    .option(
      "--re-evaluate",
      "Re-score unchanged jobs with the current matching rules.",
    )
    .action(
      async (options: {
        ai: boolean;
        verify: boolean;
        reEvaluate?: boolean;
      }) => {
        logger.info("Starting job discovery...");
        const run = await runDiscovery({
          webSearchProvider: createConfiguredWebSearchProvider(),
          localAI: options.ai ? new OllamaLocalAIProvider() : undefined,
          analyse: options.ai,
          verify: options.verify,
          rescoreExisting: options.reEvaluate,
        });
        logger.info(JSON.stringify(run, null, 2));
        if (run.status === "failed") process.exitCode = 1;
      },
    );
  return jobs;
}
