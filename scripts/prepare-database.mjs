import "dotenv/config";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:../data/casinobot.db";
if (!databaseUrl.startsWith("file:")) {
  throw new Error("CasinoBot currently supports SQLite DATABASE_URL values beginning with file:.");
}

const configuredPath = databaseUrl.slice("file:".length).split("?")[0];
if (!configuredPath) {
  throw new Error("DATABASE_URL must include a SQLite file path.");
}

// Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
const databasePath = isAbsolute(configuredPath)
  ? configuredPath
  : resolve(process.cwd(), "prisma", configuredPath);
mkdirSync(dirname(databasePath), { recursive: true });
closeSync(openSync(databasePath, "a", 0o600));
console.log(`SQLite database ready at ${databasePath}`);
