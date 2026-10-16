// The bot's real decisions: who gets mapped, what the channel sees, and that
// a refusal from the engine stays a quiet ephemeral — never a crash.

import { describe, expect, it } from 'vitest';
import {
  buttonId,
  handleButton,
  handleInbox,
  handleList,
  handleSignoff,
  parseButtonId,
  renderAi,
  type Deps,
} from '../src/handlers.js';
import type { DispatchResult, EngineRpc, ParkedAsk, RpcResult, RunEvent } from '../src/rpc.js';

const SCOPE_DENIED = {
  code: 'scope_denied',
  message: 'user:bob does not hold qa',
  hint: 'The answerScope on the ask is qa.',
};

const EVENTS: RunEvent[] = [
  { type: 'agent.model_call', data: { step: 'assess' } },
  { type: 'step.output', data: { step: 'assess', output: { recommendation: 'ship' } } },
  { type: 'ask.answered', data: {} },
  { type: 'step.output', data: { step: 'execute', output: { tagged: true } } },
];

function fakeRpc(overrides: Partial<EngineRpc>): EngineRpc {
  const notCalled = (): never => {
    throw new Error('unexpected rpc call');
  };
  return {
    kinds: overrides.kinds ?? notCalled,
    dispatch: overrides.dispatch ?? notCalled,
    resume: overrides.resume ?? notCalled,
    asks: overrides.asks ?? notCalled,
    runEvents:
      overrides.runEvents ??
      (async (): Promise<RpcResult<{ events: RunEvent[] }>> => ({ ok: true, value: { events: EVENTS } })),
  };
}

function deps(rpc: EngineRpc): Deps {
  return {
    identity: new Map([
      ['111', 'alice'],
      ['222', 'bob'],
    ]),
    rpc,
    signoffUri: 'qa://release-signoff',
  };
}

describe('identity gate', () => {
  it('an unmapped Discord user is refused ephemerally, before any rpc call', async () => {
    const reply = await handleSignoff('999', '1.4.0', deps(fakeRpc({})));
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toContain('not mapped');
  });
});

describe('/signoff', () => {
  it('a parked run posts the AI output publicly with buttons carrying the askId', async () => {
    const rpc = fakeRpc({
      dispatch: async (uri, input, userId): Promise<RpcResult<DispatchResult>> => {
        expect(uri).toBe('qa://release-signoff');
        expect(input).toEqual({ version: '1.4.0' });
        expect(userId).toBe('alice');
        return { ok: true, value: { runId: 'r-1', status: 'waiting', ask: { askId: 'a-1' } } };
      },
    });
    const reply = await handleSignoff('111', '1.4.0', deps(rpc));
    expect(reply.ephemeral).toBe(false);
    expect(reply.askIds).toEqual(['a-1']);
    expect(reply.text).toContain('recommendation');
    expect(reply.text).toContain('human');
  });

  it('an engine refusal on dispatch stays ephemeral', async () => {
    const rpc = fakeRpc({
      dispatch: async (): Promise<RpcResult<DispatchResult>> => ({ ok: false, error: SCOPE_DENIED }),
    });
    const reply = await handleSignoff('222', '1.4.0', deps(rpc));
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toContain('scope_denied');
  });
});

describe('buttons', () => {
  it('customId round-trips', () => {
    expect(parseButtonId(buttonId('a-1', 'approve'))).toEqual({ askId: 'a-1', decision: 'approve' });
    expect(parseButtonId('nonsense')).toBeNull();
  });

  it("the CLICKER's identity answers — bob's click is refused by the engine, quietly", async () => {
    const rpc = fakeRpc({
      resume: async (askId, answer, userId): Promise<RpcResult<DispatchResult>> => {
        expect(askId).toBe('a-1');
        expect(answer).toEqual({ decision: 'approve' });
        expect(userId).toBe('bob');
        return { ok: false, error: SCOPE_DENIED };
      },
    });
    const reply = await handleButton('222', buttonId('a-1', 'approve'), deps(rpc));
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toContain('scope_denied');
    expect(reply.askIds).toBeUndefined();
  });

  it("alice's approve completes publicly, showing only post-answer output", async () => {
    const rpc = fakeRpc({
      resume: async (): Promise<RpcResult<DispatchResult>> => ({
        ok: true,
        value: { runId: 'r-1', status: 'done', output: { tagged: true } },
      }),
    });
    const reply = await handleButton('111', buttonId('a-1', 'approve'), deps(rpc));
    expect(reply.ephemeral).toBe(false);
    expect(reply.text).toContain('answered `approve` as `alice`');
    expect(reply.text).toContain('tagged');
    expect(reply.text).not.toContain('recommendation'); // pre-answer AI line not replayed
  });
});

describe('renderAi', () => {
  it('shows agent-step outputs only, and afterLastAnswer skips the pre-ask story', () => {
    expect(renderAi(EVENTS)).toHaveLength(1); // execute is a route step, not an agent step
    expect(renderAi(EVENTS)[0]).toContain('recommendation');
    expect(renderAi(EVENTS, true)).toHaveLength(0);
  });
});

describe('/inbox', () => {
  const PARKED: ParkedAsk = {
    askId: 'a-1',
    runId: '0f2f3317-d6e3-46fc-92ed-b2ecf5951d88',
    step: 'approve',
    schema: { type: 'object' },
    answerScope: ['qa'],
    humanOnly: true,
    delegated: false,
    expiresAt: '2026-10-12T12:00:00.000Z',
  };

  it('an unmapped Discord user is refused before any rpc call', async () => {
    const reply = await handleInbox('999', deps(fakeRpc({})));
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toContain('not mapped');
  });

  it("alice's parked ask comes back as a row of buttons carrying its askId, ephemerally", async () => {
    const rpc = fakeRpc({
      asks: async (userId): Promise<RpcResult<{ asks: ParkedAsk[] }>> => {
        expect(userId).toBe('alice');
        return { ok: true, value: { asks: [PARKED] } };
      },
    });
    const reply = await handleInbox('111', deps(rpc));
    expect(reply.ephemeral).toBe(true);
    expect(reply.askIds).toEqual(['a-1']); // one row = Approve + Reject, both buttonId('a-1', …)
    expect(reply.text).toContain('**approve**');
    expect(reply.text).toContain('`0f2f3317`');
    expect(reply.text).toContain(`<t:${Date.parse(PARKED.expiresAt) / 1000}:R>`);
    expect(reply.text).not.toContain('delegated');
  });

  it('an ask the user delegated says so — the engine decided, the bot only shows it', async () => {
    const rpc = fakeRpc({
      asks: async (): Promise<RpcResult<{ asks: ParkedAsk[] }>> => ({
        ok: true,
        value: { asks: [{ ...PARKED, delegated: true }] },
      }),
    });
    const reply = await handleInbox('111', deps(rpc));
    expect(reply.text).toContain('delegated: your agent may answer this one');
    expect(reply.askIds).toEqual(['a-1']); // the buttons stay: a person may still answer first
  });

  it("bob's inbox is empty, with no buttons", async () => {
    const rpc = fakeRpc({
      asks: async (): Promise<RpcResult<{ asks: ParkedAsk[] }>> => ({ ok: true, value: { asks: [] } }),
    });
    const reply = await handleInbox('222', deps(rpc));
    expect(reply).toEqual({ text: 'Nothing waiting for you.', ephemeral: true });
  });

  it('an unreachable engine is a quiet ephemeral, like every other refusal', async () => {
    const rpc = fakeRpc({
      asks: async (): Promise<RpcResult<{ asks: ParkedAsk[] }>> => ({
        ok: false,
        error: { code: 'rpc_unreachable', message: 'ECONNREFUSED', hint: 'Is `ace rpc` running?' },
      }),
    });
    const reply = await handleInbox('111', deps(rpc));
    expect(reply.ephemeral).toBe(true);
    expect(reply.text).toContain('rpc_unreachable');
    expect(reply.askIds).toBeUndefined();
  });
});

describe('/list', () => {
  it('lists as the mapped user', async () => {
    const rpc = fakeRpc({
      kinds: async (userId): Promise<RpcResult<{ kinds: { uri: string }[] }>> => ({
        ok: true,
        value: { kinds: userId === 'alice' ? [{ uri: 'qa://release-signoff' }] : [] },
      }),
    });
    const alice = await handleList('111', deps(rpc));
    expect(alice.text).toContain('qa://release-signoff');
    const bob = await handleList('222', deps(rpc));
    expect(bob.text).toContain('Nothing');
  });
});
