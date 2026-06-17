import { Command } from "commander";
import { runAnalysisWorkflow, type AnalyzeWorkflowOptions } from "../services/runAnalysisWorkflow";

export function createAnalyzeCommand(): Command {
  return new Command("analyze")
    .description("Analyze a CV/profile against a job description and generate application assets.")
    .option("--cv <path>", "Path to a CV/resume PDF, text, or markdown file.")
    .requiredOption("--job <path>", "Path to a job description text file.")
    .option("--provider <provider>", "LLM provider to use: ollama or openai.")
    .option("--no-save-context", "Do not save an extracted --cv profile to context/profile.json.")
    .action(async (options: AnalyzeWorkflowOptions) => {
      await runAnalysisWorkflow(options);
    });
}
