import { Events } from "discord.js";
import { createDiscordClient } from "./bot/client.js";
import { handleInteraction } from "./bot/interactionRouter.js";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createPrismaClient } from "./repositories/prisma.js";
import { BlackjackService } from "./services/blackjack/blackjackService.js";
import { CasinoService } from "./services/casino/casinoService.js";
import { DailyDilemmaClient } from "./services/dailyDilemma/dailyDilemmaClient.js";
import { CasinoReminder } from "./scheduler/casinoReminder.js";
import { DailyDilemmaAnnouncer } from "./scheduler/dailyDilemmaAnnouncer.js";

async function main() {
 const config = loadConfig(); const logger = createLogger(config); const prisma = createPrismaClient(); await prisma.$connect(); const client = createDiscordClient(); const casino = new CasinoService(prisma);
 const context = { client, prisma, config, logger, casino, blackjack: new BlackjackService(prisma, undefined, casino), dailyDilemma: new DailyDilemmaClient(config.DAILY_DILEMMA_API_KEY, logger) };
 const reminder = new CasinoReminder(context); const dilemma = new DailyDilemmaAnnouncer(context);
 client.on(Events.InteractionCreate, interaction => void handleInteraction(interaction, context));
 client.once(Events.ClientReady, async ready => { logger.info({ user: ready.user.tag }, "Discord client ready"); await reminder.start(); await dilemma.start(); });
 client.on(Events.Error, error => logger.error({ error }, "Discord client error"));
 let stopping = false; const shutdown = async (signal: string) => { if (stopping) return; stopping = true; logger.info({ signal }, "Shutting down"); reminder.stop(); dilemma.stop(); client.destroy(); await prisma.$disconnect(); };
 process.once("SIGINT", () => void shutdown("SIGINT")); process.once("SIGTERM", () => void shutdown("SIGTERM")); await client.login(config.DISCORD_TOKEN);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
