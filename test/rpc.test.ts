// The wire contract against a real HTTP server: bearer = user id, engine
// errors come back as envelopes, an unreachable engine is a readable error.

import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AceRpc } from '../src/rpc.js';

let server: Server | undefined;

function serve(handler: (path: string, auth: string | undefined, res: (status: number, body: unknown) => void) => void): Promise<string> {
  server = createServer((req, res) => {
    handler(req.url ?? '/', req.headers.authorization, (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server!.listen(0, () => {
      const addr = server!.address();
      resolve(`http://localhost:${typeof addr === 'object' && addr !== null ? addr.port : 0}`);
    });
  });
}

afterEach(() => {
  server?.close();
  server = undefined;
});

describe('AceRpc', () => {
  it('sends the engine user id as the bearer', async () => {
    let seen: string | undefined;
    const url = await serve((_path, auth, res) => {
      seen = auth;
      res(200, { kinds: [] });
    });
    const result = await new AceRpc(url).kinds('alice');
    expect(result.ok).toBe(true);
    expect(seen).toBe('Bearer alice');
  });

  it('the inbox is GET /asks as the user', async () => {
    let seen: { path: string; auth: string | undefined } | undefined;
    const url = await serve((path, auth, res) => {
      seen = { path, auth };
      res(200, { asks: [{ askId: 'a-1' }] });
    });
    const result = await new AceRpc(url).asks('alice');
    expect(seen).toEqual({ path: '/asks', auth: 'Bearer alice' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.asks[0]?.askId).toBe('a-1');
  });

  it('a non-2xx becomes the engine error envelope', async () => {
    const url = await serve((_path, _auth, res) =>
      res(403, { code: 'scope_denied', message: 'no', hint: 'get the scope' }),
    );
    const result = await new AceRpc(url).resume('a-1', { decision: 'approve' }, 'bob');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('scope_denied');
  });

  it('an unreachable engine is rpc_unreachable, not a throw', async () => {
    const result = await new AceRpc('http://localhost:1').kinds('alice');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('rpc_unreachable');
  });
});
