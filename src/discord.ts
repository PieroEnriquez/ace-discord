// The dumb layer: Discord events in, handler Replies out. No decisions here.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
} from 'discord.js';
import { buttonId, handleButton, handleInbox, handleList, handleSignoff, type Deps, type Reply } from './handlers.js';

function buttonsFor(askId: string, tag: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(buttonId(askId, 'approve')).setLabel(`Approve${tag}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(buttonId(askId, 'reject')).setLabel(`Reject${tag}`).setStyle(ButtonStyle.Danger),
  );
}

// Several rows get numbered to match the reply's numbered list; a lone row needs no tag.
function toPayload(reply: Reply) {
  const askIds = reply.askIds ?? [];
  return {
    content: reply.text,
    components: askIds.map((askId, i) => buttonsFor(askId, askIds.length === 1 ? '' : ` #${i + 1}`)),
  };
}

const EPHEMERAL = { flags: MessageFlags.Ephemeral as const };

export function createBot(deps: Deps): Client {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.on('interactionCreate', (interaction: Interaction) => {
    void (async () => {
      if (interaction.isChatInputCommand()) {
        await interaction.deferReply();
        const reply =
          interaction.commandName === 'list'
            ? await handleList(interaction.user.id, deps)
            : interaction.commandName === 'inbox'
              ? await handleInbox(interaction.user.id, deps)
              : await handleSignoff(
                  interaction.user.id,
                  interaction.options.getString('version', true),
                  deps,
                );
        // deferReply is public; an ephemeral verdict goes in a follow-up instead.
        if (reply.ephemeral) {
          await interaction.deleteReply();
          await interaction.followUp({ ...toPayload(reply), ...EPHEMERAL });
        } else {
          await interaction.editReply(toPayload(reply));
        }
        return;
      }
      if (interaction.isButton()) {
        const reply = await handleButton(interaction.user.id, interaction.customId, deps);
        await interaction.reply(reply.ephemeral ? { ...toPayload(reply), ...EPHEMERAL } : toPayload(reply));
      }
    })().catch((e: unknown) => {
      console.error('interaction failed:', e);
    });
  });

  return client;
}
