import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { Config } from "../config/env.js";
import type { BlackjackService } from "../services/blackjack/blackjackService.js";
import type { CasinoService } from "../services/casino/casinoService.js";
import type { DailyDilemmaClient } from "../services/dailyDilemma/dailyDilemmaClient.js";
export interface AppContext { client: Client; prisma: PrismaClient; config: Config; logger: Logger; blackjack: BlackjackService; casino: CasinoService; dailyDilemma: DailyDilemmaClient }
