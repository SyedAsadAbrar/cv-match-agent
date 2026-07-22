import { Command } from "commander";
import { openDatabase, resolveDatabasePath } from "../db/database";
import { logger } from "../utils/logger";

export function createDatabaseCommand(): Command {
  const database = new Command("db").description(
    "Manage the local SQLite database.",
  );
  database
    .command("migrate")
    .description("Apply pending database migrations.")
    .action(() => {
      const connection = openDatabase();
      connection.close();
      logger.success(
        `Database migrations applied at ${resolveDatabasePath()}.`,
      );
    });
  return database;
}
