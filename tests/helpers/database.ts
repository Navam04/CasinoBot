import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client.js";

export function createTestDatabase(): { prisma: PrismaClient; cleanup: () => Promise<void> } {
  const databaseDirectory = mkdtempSync(path.join(tmpdir(), "casinobot-test-"));
  const databasePath = path.join(databaseDirectory, "test.db");
  const sqlite = new DatabaseSync(databasePath);
  const migrationsDirectory = path.resolve("prisma", "migrations");
  for (const directory of readdirSync(migrationsDirectory).sort()) {
    const migrationPath = path.join(migrationsDirectory, directory, "migration.sql");
    if (existsSync(migrationPath)) {
      sqlite.exec(readFileSync(migrationPath, "utf8"));
    }
  }
  sqlite.close();
  const adapter = new PrismaBetterSqlite3({
    url: `file:${databasePath.replaceAll("\\", "/")}`,
  });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    cleanup: async () => {
      await prisma.$disconnect();
      rmSync(databaseDirectory, { recursive: true, force: true });
    },
  };
}
