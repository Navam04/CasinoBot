import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
const wager = (c: any) => c.addIntegerOption((o: any) => o.setName("wager").setDescription("Chips to wager (10–500)").setMinValue(10).setMaxValue(500).setRequired(true));
export const commandDefinitions = [new SlashCommandBuilder().setName("casino").setDescription("Play CasinoBot games with virtual chips")
  .addSubcommand(c => c.setName("balance").setDescription("Check your balance"))
  .addSubcommand(c => c.setName("stats").setDescription("Show your lifetime statistics"))
  .addSubcommand(c => c.setName("daily").setDescription("Claim free daily chips"))
  .addSubcommand(c => c.setName("leaderboard").setDescription("Show the server leaderboard"))
  .addSubcommand(c => c.setName("history").setDescription("Show your recent transactions"))
  .addSubcommand(c => c.setName("odds").setDescription("Show game rules and payouts"))
  .addSubcommand(c => c.setName("notifications").setDescription("Control reminder mentions").addStringOption(o => o.setName("setting").setDescription("Preference").setRequired(true).addChoices({ name: "On", value: "on" }, { name: "Off", value: "off" })))
  .addSubcommand(c => c.setName("transfer").setDescription("Send chips to a member").addUserOption(o => o.setName("member").setDescription("Recipient").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Chips (minimum 10)").setMinValue(10).setRequired(true)))
  .addSubcommandGroup(g => g.setName("blackjack").setDescription("Play blackjack").addSubcommand(c => wager(c.setName("play").setDescription("Start a hand"))).addSubcommand(c => c.setName("resume").setDescription("Resume your hand")))
  .addSubcommand(c => wager(c.setName("coinflip").setDescription("Call heads or tails")).addStringOption((o: any) => o.setName("side").setDescription("Side").setRequired(true).addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" })))
  .addSubcommand(c => wager(c.setName("dice").setDescription("Roll against the dealer")))
  .addSubcommand(c => wager(c.setName("slots").setDescription("Spin the slots")))
  .addSubcommand(c => wager(c.setName("crash").setDescription("Choose a cash-out target")).addIntegerOption((o: any) => o.setName("target").setDescription("Multiplier").setRequired(true).addChoices({ name: "2×", value: 2 }, { name: "3×", value: 3 }, { name: "5×", value: 5 }, { name: "10×", value: 10 })))
  .addSubcommand(c => wager(c.setName("roulette").setDescription("Play European roulette")).addStringOption((o: any) => o.setName("bet").setDescription("Bet").setRequired(true).addChoices({ name: "Red", value: "red" }, { name: "Black", value: "black" }, { name: "Even", value: "even" }, { name: "Odd", value: "odd" }, { name: "Low (1–18)", value: "low" }, { name: "High (19–36)", value: "high" }, { name: "Exact number", value: "number" })).addIntegerOption((o: any) => o.setName("number").setDescription("Required for an exact-number bet").setMinValue(0).setMaxValue(36)))
  .addSubcommandGroup(g => g.setName("setup").setDescription("Configure this server").addSubcommand(c => c.setName("dilemma-channel").setDescription("Set or disable Daily Dilemma announcements").addChannelOption(o => o.setName("channel").setDescription("Leave blank to disable").addChannelTypes(ChannelType.GuildText))).addSubcommand(c => c.setName("reminder-channel").setDescription("Set or disable casino reminders").addChannelOption(o => o.setName("channel").setDescription("Leave blank to disable").addChannelTypes(ChannelType.GuildText))).addSubcommand(c => c.setName("timezone").setDescription("Set the server IANA timezone").addStringOption(o => o.setName("timezone").setDescription("For example America/Toronto").setRequired(true))))
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)];
export const commandJson = commandDefinitions.map(command => command.toJSON());
