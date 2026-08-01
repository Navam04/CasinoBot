import pino, { type Logger } from "pino";
import type { Config } from "./env.js";
export function createLogger(config: Pick<Config, "LOG_LEVEL">): Logger {
  return pino({ level: config.LOG_LEVEL, redact: { paths: ["token", "*.token", "apiKey", "*.apiKey", "authorization", "*.authorization"], censor: "[REDACTED]" } });
}
