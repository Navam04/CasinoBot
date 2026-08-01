import type { GuildMember } from "discord.js";
export const SAFE_ALLOWED_MENTIONS = { parse: [] as never[], repliedUser: false };
export const truncate = (value: string, length: number): string => value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;
export const canManageGuild = (member: GuildMember): boolean => member.permissions.has("Administrator");
