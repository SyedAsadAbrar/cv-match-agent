import { Command } from "commander";
import { OllamaClient, type OllamaModel } from "../ai/ollamaClient";
import { logger } from "../utils/logger";

export function createModelsCommand(): Command {
  const modelsCommand = new Command("models").description("Inspect locally installed Ollama models.");

  modelsCommand
    .command("list")
    .description("List models installed in the local Ollama instance.")
    .action(async () => {
      const client = new OllamaClient();
      const models = await client.listModels();

      if (models.length === 0) {
        logger.info(`No local Ollama models found at ${client.baseUrl}.`);
        logger.info("Install one first, for example: ollama pull deepseek-r1:8b");
        return;
      }

      logger.info("Installed Ollama models\n");
      logger.info(formatModelTable(models));
    });

  return modelsCommand;
}

export function formatModelTable(models: OllamaModel[]): string {
  const rows = models
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((model) => [
      model.name,
      model.details?.parameterSize ?? "-",
      model.details?.quantizationLevel ?? "-",
      formatByteSize(model.size),
      model.details?.family ?? "-"
    ]);
  const headers = ["MODEL", "PARAMETERS", "QUANTIZATION", "SIZE", "FAMILY"];
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index].length)));
  const formatRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  return [formatRow(headers), ...rows.map(formatRow)].join("\n");
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${value} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}
