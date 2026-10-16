import { loadConfig } from './config.js';
import { createBot } from './discord.js';
import { loadIdentityMap } from './identity.js';
import { AceRpc } from './rpc.js';

const cfg = loadConfig();
const deps = {
  identity: await loadIdentityMap(cfg.usersFile),
  rpc: new AceRpc(cfg.rpcUrl),
  signoffUri: process.env['ACE_SIGNOFF_URI'] ?? 'qa://release-signoff',
};

const bot = createBot(deps);
bot.once('clientReady', () => {
  console.log(`ace-discord up — engine at ${cfg.rpcUrl}, ${deps.identity.size} user(s) mapped`);
});
await bot.login(cfg.token);
