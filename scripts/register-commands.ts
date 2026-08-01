import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commandJson } from "../src/bot/commandDefinitions.js";

const token = process.env["DISCORD_TOKEN"];
const clientId = process.env["DISCORD_CLIENT_ID"];
const guildId = process.env["DISCORD_GUILD_ID"];
if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required.");
}

const rest = new REST({ version: "10" }).setToken(token);
if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandJson });
  console.log(`Registered commands in development guild ${guildId}.`);
} else {
  await rest.put(Routes.applicationCommands(clientId), { body: commandJson });
  console.log("Registered global commands. Global updates can take up to one hour.");
}
