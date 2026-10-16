// One-shot slash-command registration; guild-scoped when DISCORD_GUILD_ID is set.

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { loadConfig } from './config.js';

const commands = [
  new SlashCommandBuilder().setName('list').setDescription('What you can dispatch — visible = callable'),
  new SlashCommandBuilder().setName('inbox').setDescription('Human decisions parked on you, with Approve/Reject'),
  new SlashCommandBuilder()
    .setName('signoff')
    .setDescription('Run the release signoff: AI assessment, then a human-only approval')
    .addStringOption((o) => o.setName('version').setDescription('version to sign off, e.g. 1.4.0').setRequired(true)),
].map((c) => c.toJSON());

const cfg = loadConfig();
const rest = new REST().setToken(cfg.token);
const route =
  cfg.guildId === undefined
    ? Routes.applicationCommands(cfg.clientId)
    : Routes.applicationGuildCommands(cfg.clientId, cfg.guildId);
await rest.put(route, { body: commands });
console.log(`registered /list, /inbox and /signoff (${cfg.guildId === undefined ? 'global' : `guild ${cfg.guildId}`})`);
