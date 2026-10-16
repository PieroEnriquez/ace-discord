// All bot behavior as pure data-in / data-out, so the wiring in discord.ts
// stays dumb and the tests exercise the real decisions.

import type { IdentityMap } from './identity.js';
import type { DispatchResult, EngineRpc, ErrorEnvelope, ParkedAsk, RunEvent } from './rpc.js';

export interface Reply {
  text: string;
  /** Visible only to the caller — refusals and errors never spam the channel. */
  ephemeral: boolean;
  /** One Approve/Reject button row per askId, in this order. */
  askIds?: string[];
}

export interface Deps {
  identity: IdentityMap;
  rpc: EngineRpc;
  /** The workflow the /signoff command dispatches. */
  signoffUri: string;
}

const NOT_MAPPED: Reply = {
  text: 'You are not mapped to an engine user — ask the operator to add you to users.json.',
  ephemeral: true,
};

function formatError(e: ErrorEnvelope): string {
  return `refused — \`${e.code}\`: ${e.message} (${e.hint})`;
}

// The AI's judgment is the product: every agent step's output, one line each.
// After an answer, only what happened since — no replaying the pre-ask story.
export function renderAi(events: RunEvent[], afterLastAnswer = false): string[] {
  let from = 0;
  if (afterLastAnswer) {
    for (let i = 0; i < events.length; i++) if (events[i]!.type === 'ask.answered') from = i + 1;
  }
  events = events.slice(from);
  const agentSteps = new Set(
    events.map((e) => (e.type === 'agent.model_call' ? String(e.data['step']) : '')).filter(Boolean),
  );
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === 'step.output' && agentSteps.has(String(e.data['step']))) {
      lines.push(`AI **${String(e.data['step'])}** → \`${JSON.stringify(e.data['output'])}\``);
    }
  }
  return lines;
}

async function describeRun(
  result: DispatchResult,
  userId: string,
  deps: Deps,
  afterLastAnswer = false,
): Promise<Reply> {
  const events = await deps.rpc.runEvents(result.runId, userId);
  const ai = events.ok ? renderAi(events.value.events, afterLastAnswer) : [];

  if (result.status === 'waiting' && result.ask !== undefined) {
    return {
      text: [
        ...ai,
        `Run \`${result.runId}\` is parked on a **human** decision (ask \`${result.ask.askId}\`).`,
      ].join('\n'),
      ephemeral: false,
      askIds: [result.ask.askId],
    };
  }
  if (result.status === 'done') {
    return {
      text: [...ai, `Run \`${result.runId}\` done: \`${JSON.stringify(result.output)}\``].join('\n'),
      ephemeral: false,
    };
  }
  return {
    text: [
      ...ai,
      `Run \`${result.runId}\` ${result.status}${result.error ? ` — ${formatError(result.error)}` : ''}`,
    ].join('\n'),
    ephemeral: false,
  };
}

export async function handleList(discordId: string, deps: Deps): Promise<Reply> {
  const userId = deps.identity.get(discordId);
  if (userId === undefined) return NOT_MAPPED;
  const kinds = await deps.rpc.kinds(userId);
  if (!kinds.ok) return { text: formatError(kinds.error), ephemeral: true };
  const uris = kinds.value.kinds.map((k) => `- \`${k.uri}\``);
  return {
    text: uris.length === 0 ? `Nothing — as \`${userId}\`, visible = callable, and you hold neither.` : `As \`${userId}\` you can dispatch:\n${uris.join('\n')}`,
    ephemeral: true,
  };
}

export async function handleSignoff(discordId: string, version: string, deps: Deps): Promise<Reply> {
  const userId = deps.identity.get(discordId);
  if (userId === undefined) return NOT_MAPPED;
  const result = await deps.rpc.dispatch(deps.signoffUri, { version }, userId);
  if (!result.ok) return { text: formatError(result.error), ephemeral: true };
  return describeRun(result.value, userId, deps);
}

// A Discord message holds at most five button rows, so at most five asks get buttons.
const INBOX_ROWS = 5;

function renderAsk(ask: ParkedAsk, n: number): string {
  const expires = `<t:${Math.floor(Date.parse(ask.expiresAt) / 1000)}:R>`;
  const tail = ask.delegated ? ' — delegated: your agent may answer this one' : '';
  return `${n}. **${ask.step}** — run \`${ask.runId.slice(0, 8)}\` — expires ${expires}${tail}`;
}

// The demo's asks all take { decision: approve|reject }, so buttons are enough; another schema would need a modal.
export async function handleInbox(discordId: string, deps: Deps): Promise<Reply> {
  const userId = deps.identity.get(discordId);
  if (userId === undefined) return NOT_MAPPED;
  const result = await deps.rpc.asks(userId);
  if (!result.ok) return { text: formatError(result.error), ephemeral: true };
  const asks = result.value.asks;
  if (asks.length === 0) return { text: 'Nothing waiting for you.', ephemeral: true };
  const shown = asks.slice(0, INBOX_ROWS);
  const lines = [`Waiting on \`${userId}\`:`, ...shown.map((ask, i) => renderAsk(ask, i + 1))];
  if (asks.length > shown.length) lines.push(`…and ${asks.length - shown.length} more once these are answered.`);
  return { text: lines.join('\n'), ephemeral: true, askIds: shown.map((a) => a.askId) };
}

// Button customId format: ask|<askId>|<decision>
export function buttonId(askId: string, decision: 'approve' | 'reject'): string {
  return `ask|${askId}|${decision}`;
}

export function parseButtonId(customId: string): { askId: string; decision: string } | null {
  const [tag, askId, decision] = customId.split('|');
  if (tag !== 'ask' || askId === undefined || askId === '' || decision === undefined) return null;
  return { askId, decision };
}

// The clicker — not the dispatcher — is who the answer is attributed to.
export async function handleButton(discordId: string, customId: string, deps: Deps): Promise<Reply> {
  const parsed = parseButtonId(customId);
  if (parsed === null) return { text: `Unknown button: ${customId}`, ephemeral: true };
  const userId = deps.identity.get(discordId);
  if (userId === undefined) return NOT_MAPPED;
  const result = await deps.rpc.resume(parsed.askId, { decision: parsed.decision }, userId);
  if (!result.ok) return { text: formatError(result.error), ephemeral: true };
  const reply = await describeRun(result.value, userId, deps, true);
  return { ...reply, text: `<@${discordId}> answered \`${parsed.decision}\` as \`${userId}\`.\n${reply.text}` };
}
