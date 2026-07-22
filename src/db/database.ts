import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrations } from "./migrations";

export type SqliteDatabase = Database.Database;

export function resolveDatabasePath(
  databaseUrl = process.env.DATABASE_URL,
): string {
  const configured = databaseUrl?.trim() || "file:./data/job-copilot.db";
  const filePath = configured.startsWith("file:")
    ? configured.slice(5)
    : configured;
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

export function openDatabase(databaseUrl?: string): SqliteDatabase {
  const filename = resolveDatabasePath(databaseUrl);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new Database(filename);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  migrateDatabase(database);
  return database;
}

export function migrateDatabase(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const apply = database.transaction(() => {
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
    }
  });
  apply();
}
