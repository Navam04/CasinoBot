import { DateTime } from "luxon";
import { escapeMarkdown, TextChannel } from "discord.js";
import type { AppContext } from "../bot/context.js";
export function casinoTier(position: number): "High Roller" | "Diamond" | "Gold" | "Silver" { return position === 0 ? "High Roller" : position <= 2 ? "Diamond" : position <= 5 ? "Gold" : "Silver"; }
export class CasinoReminder {
  private timer?: NodeJS.Timeout; private running = false;
  constructor(private readonly context: AppContext) {}
  async start() { await this.run(); this.timer = setInterval(() => void this.run(), 60_000); this.timer.unref(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async run(now = new Date()) {
    if (this.running) return; this.running = true;
    try {
      const settings = await this.context.prisma.guildSetting.findMany({ where: { casinoReminderChannelId: { not: null } } });
      for (const setting of settings) {
        const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(setting.timezone);
        if (!local.isValid || local.hour !== 21) continue;
        const localDate = local.toISODate()!;
        if (await this.context.prisma.casinoAnnouncement.findUnique({ where: { guildId_localDate: { guildId: setting.guildId, localDate } } })) continue;
        try {
          const channel = await this.context.client.channels.fetch(setting.casinoReminderChannelId!);
          if (!(channel instanceof TextChannel) || channel.guildId !== setting.guildId) throw new Error("Configured reminder channel is unavailable");
          const accounts = await this.context.casino.recentPlayers(setting.guildId, new Date(now.getTime() - 48 * 60 * 60 * 1000));
          const players = (await Promise.all(accounts.map(async account => { try { const member = await channel.guild.members.fetch(account.userId); return { ...account, name: escapeMarkdown(member.displayName).replaceAll("@", "@\u200b") }; } catch { return undefined; } }))).filter((p): p is NonNullable<typeof p> => Boolean(p));
          if (!players.length) continue;
          const record = await this.context.prisma.casinoAnnouncement.create({ data: { guildId: setting.guildId, localDate, channelId: channel.id } });
          const message = await channel.send({ content: `🎰 **CasinoBot — 9 PM table call**\n${players.slice(0, 15).map((p, i) => `**${casinoTier(i)}** · <@${p.userId}> (${p.name}) — **${p.balance.toLocaleString("en-CA")} chips**`).join("\n")}\n\nPlay with \`/casino\`. Use \`/casino notifications off\` to stop these pings.`, allowedMentions: { parse: [], users: players.slice(0, 15).map(p => p.userId), repliedUser: false } });
          await this.context.prisma.casinoAnnouncement.update({ where: { id: record.id }, data: { status: "SENT", messageId: message.id, sentAt: now } });
        } catch (error) { this.context.logger.error({ error, guildId: setting.guildId }, "Casino reminder failed"); }
      }
    } finally { this.running = false; }
  }
}
