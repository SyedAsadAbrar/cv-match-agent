import { Command } from "commander";
import { JobCopilotStore } from "../db/store";
import { seedDemo } from "../demo/seed";
import { logger } from "../utils/logger";

export function createDemoCommand(): Command {
  const demo = new Command("demo").description(
    "Manage clearly labelled fictional demo data.",
  );
  demo
    .command("seed")
    .description("Seed and rank the fictional product demonstration.")
    .action(async () => {
      const store = new JobCopilotStore();
      try {
        const run = await seedDemo(store);
        logger.success(
          `Fictional demo seeded: ${run.jobsImported} imported, ${run.duplicatesFound} duplicate(s), ${run.errors.length} expected error(s).`,
        );
      } finally {
        store.close();
      }
    });
  return demo;
}
