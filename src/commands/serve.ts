import { Command } from "commander";
import { startWebServer } from "../web/server";
import { logger } from "../utils/logger";

export function createServeCommand(): Command {
  return new Command("serve")
    .description("Start the local job-copilot dashboard.")
    .option("--host <host>", "Local bind host.", "127.0.0.1")
    .option("--port <port>", "Local port.", "4310")
    .action(async (options: { host: string; port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("Port must be an integer from 1 to 65535.");
      await startWebServer({ host: options.host, port });
      logger.success(
        `Local dashboard running at http://${options.host}:${port}`,
      );
    });
}
