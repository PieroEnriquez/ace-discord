// The surface's ONLY authority decision: which engine user a Discord account is.
// Everything after this mapping is the engine's call, never the bot's.

import { readFile } from 'node:fs/promises';

export type IdentityMap = ReadonlyMap<string, string>;

// users.json: { "<discord user id>": "<engine user id>", ... }
export async function loadIdentityMap(path: string): Promise<IdentityMap> {
  const doc: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`${path} must be a JSON object of discordId -> engine user id`);
  }
  const map = new Map<string, string>();
  for (const [discordId, userId] of Object.entries(doc)) {
    if (typeof userId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(userId)) {
      throw new Error(`${path}: "${discordId}" maps to an invalid user id`);
    }
    map.set(discordId, userId);
  }
  return map;
}
