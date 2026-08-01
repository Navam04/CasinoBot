import { EmbedBuilder } from "discord.js";
import { DAILY_DILEMMA_URL, type DailyDilemma } from "../services/dailyDilemma/dailyDilemmaClient.js";
import { truncate } from "../utilities/discord.js";
export function dailyDilemmaEmbed(d: DailyDilemma) { return new EmbedBuilder().setColor(0x5865f2).setTitle("Daily Dilemma").setURL(DAILY_DILEMMA_URL).setDescription(truncate(d.prompt, 4096)).addFields({ name: "🔴 Option A", value: truncate(d.redOption, 1024) }, { name: "🔵 Option B", value: truncate(d.blueOption, 1024) }, { name: "Answer and see the results", value: `[Open Daily Dilemma](${DAILY_DILEMMA_URL})` }).setFooter({ text: `Poll ${d.pollId}` }); }
