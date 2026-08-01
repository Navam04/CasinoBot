import { DateTime } from "luxon";
import { TextChannel } from "discord.js";
import type { AppContext } from "../bot/context.js";
import { dailyDilemmaVoteButtons } from "../ui/components.js";
import { dailyDilemmaEmbed } from "../ui/embeds.js";
import { SAFE_ALLOWED_MENTIONS } from "../utilities/discord.js";

export function dailyDilemmaScheduledDate(now: Date, timezone: string): string | undefined {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(timezone);
  if (!local.isValid) throw new Error(`Invalid timezone: ${timezone}`);
  return local.hour === 0 && local.minute >= 5 ? local.toISODate() ?? undefined : undefined;
}
export class DailyDilemmaAnnouncer {
  private timer?: NodeJS.Timeout; private running = false;
  constructor(private readonly context: AppContext) {}
  async start() { await this.run(); this.timer = setInterval(() => void this.run(), 60_000); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async run(now = new Date()) {
    if (this.running) return; this.running = true;
    try {
      const settings = await this.context.prisma.guildSetting.findMany({ where: { dilemmaChannelId: { not: null } } });
      for (const setting of settings) {
        if (!dailyDilemmaScheduledDate(now, setting.timezone)) continue;
        try {
          const dilemma = await this.context.dailyDilemma.getCurrent();
          const key = `daily-dilemma:${setting.guildId}:${dilemma.pollId}`;
          const existing = await this.context.prisma.integrationState.findUnique({ where: { key } });
          if (existing) continue;
          const channel = await this.context.client.channels.fetch(setting.dilemmaChannelId!);
          if (!(channel instanceof TextChannel) || channel.guildId !== setting.guildId) throw new Error("Configured dilemma channel is unavailable");
          const message = await channel.send({ embeds: [dailyDilemmaEmbed(dilemma)], components: this.context.config.DAILY_DILEMMA_API_KEY ? [dailyDilemmaVoteButtons(dilemma.pollId)] : [], allowedMentions: SAFE_ALLOWED_MENTIONS });
          await this.context.prisma.integrationState.create({ data: { key, value: message.id } });
        } catch (error) { this.context.logger.error({ error, guildId: setting.guildId }, "Daily Dilemma announcement failed"); }
      }
    } finally { this.running = false; }
  }
}
