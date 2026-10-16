// A thin client for `ace rpc`. The bearer IS the engine user id — the surface
// names the caller, the engine decides everything else.

export interface ErrorEnvelope {
  code: string;
  message: string;
  hint: string;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: ErrorEnvelope };

export interface RunEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface DispatchResult {
  runId: string;
  status: 'done' | 'waiting' | 'failed' | string;
  output?: unknown;
  ask?: { askId: string; schema?: unknown };
  error?: ErrorEnvelope;
}

export interface ParkedAsk {
  askId: string;
  runId: string;
  step: string;
  schema: unknown;
  answerScope: string[];
  humanOnly: boolean;
  /** The user settled a delegation: a machine wearing them may answer this one. */
  delegated: boolean;
  expiresAt: string; // ISO
}

// What the handlers need; AceRpc is the real one, tests bring fakes.
export interface EngineRpc {
  kinds(userId: string): Promise<RpcResult<{ kinds: { uri: string }[] }>>;
  dispatch(uri: string, input: unknown, userId: string): Promise<RpcResult<DispatchResult>>;
  resume(askId: string, answer: unknown, userId: string): Promise<RpcResult<DispatchResult>>;
  runEvents(runId: string, userId: string): Promise<RpcResult<{ events: RunEvent[] }>>;
  /** The asks this user may answer, oldest-expiring first — the engine filters, not the bot. */
  asks(userId: string): Promise<RpcResult<{ asks: ParkedAsk[] }>>;
}

export class AceRpc implements EngineRpc {
  constructor(private readonly baseUrl: string) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    userId: string,
    body?: unknown,
  ): Promise<RpcResult<T>> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${userId}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      return {
        ok: false,
        error: {
          code: 'rpc_unreachable',
          message: e instanceof Error ? e.message : String(e),
          hint: `Is \`ace rpc\` running at ${this.baseUrl}?`,
        },
      };
    }
    const doc = (await res.json()) as unknown;
    if (!res.ok) return { ok: false, error: doc as ErrorEnvelope };
    return { ok: true, value: doc as T };
  }

  kinds(userId: string): Promise<RpcResult<{ kinds: { uri: string }[] }>> {
    return this.call('GET', '/kinds', userId);
  }

  dispatch(uri: string, input: unknown, userId: string): Promise<RpcResult<DispatchResult>> {
    return this.call('POST', '/dispatch', userId, { uri, input });
  }

  resume(askId: string, answer: unknown, userId: string): Promise<RpcResult<DispatchResult>> {
    return this.call('POST', '/resume', userId, { askId, answer });
  }

  runEvents(runId: string, userId: string): Promise<RpcResult<{ events: RunEvent[] }>> {
    return this.call('GET', `/runs/${encodeURIComponent(runId)}`, userId);
  }

  asks(userId: string): Promise<RpcResult<{ asks: ParkedAsk[] }>> {
    return this.call('GET', '/asks', userId);
  }
}
