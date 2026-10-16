// All configuration is environment; the identity map is a file (see identity.ts).

export interface BotConfig {
  token: string;
  clientId: string;
  /** Guild-scoped command registration when set (instant); global otherwise (slow). */
  guildId?: string;
  rpcUrl: string;
  usersFile: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): BotConfig {
  const token = env['DISCORD_TOKEN'];
  const clientId = env['DISCORD_CLIENT_ID'];
  if (token === undefined || token === '') throw new Error('DISCORD_TOKEN is required');
  if (clientId === undefined || clientId === '') throw new Error('DISCORD_CLIENT_ID is required');
  const guildId = env['DISCORD_GUILD_ID'];
  return {
    token,
    clientId,
    ...(guildId !== undefined && guildId !== '' ? { guildId } : {}),
    rpcUrl: env['ACE_RPC_URL'] ?? 'http://localhost:3111',
    usersFile: env['ACE_USERS'] ?? './users.json',
  };
}
