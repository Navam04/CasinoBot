import "dotenv/config";
import { z } from "zod";

const optionalText = z.preprocess((v) => v === "" ? undefined : v, z.string().min(1).optional());
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d+$/),
  DISCORD_GUILD_ID: z.preprocess((v) => v === "" ? undefined : v, z.string().regex(/^\d+$/).optional()),
  DATABASE_URL: z.string().min(1).default("file:./data/bot.db"),
  DEFAULT_TIMEZONE: z.string().min(1).default("America/Toronto"),
  DAILY_DILEMMA_API_KEY: optionalText,
  BOT_DISPLAY_NAME: z.string().trim().min(1).max(32).default("CasinoBot"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return result.data;
}
