# ace-discord

A Discord surface for [ace](https://github.com/PieroEnriquez/ace), as a
proof of one claim: **a surface only decides who you are — never what you
may do.** This bot is ~400 lines with no special privileges. Every rule
you see it enforce is the engine refusing, not the UI hiding.

What it does:

- `/list` — what *you* can dispatch, as the engine user your Discord
  account maps to (visible = callable).
- `/inbox` — the human decisions parked on *you*: step, run, expiry, and
  an Approve/Reject row per ask (the first five; Discord allows five
  rows per message). The engine decides whose inbox an ask lands in; the
  bot only asks. An ask you have delegated in text (a settled
  `delegations/<you>.yaml` on the engine side) is marked, so you know
  your agent may answer it before you do.
- `/signoff version:1.4.0` — dispatches the release-signoff workflow. The
  AI's assessment is posted in the channel; the run parks on a
  **human-only** approval, rendered as Approve/Reject buttons. A click
  is a person's gesture, so the bot never declares `via: machine`; an
  agent answering through `ace mcp` does, and is refused unless the
  user delegated that step.
- Button clicks answer the ask **as the clicker**, not as whoever started
  the run. The wrong person's click comes back `scope_denied` from the
  engine, quietly (ephemeral). The right person's click completes the run
  and posts the result.

There is deliberately no admin command, no override, no bot-side
permission list beyond one file: `users.json` maps Discord user IDs to
engine user ids. That mapping is the surface's entire authority decision.

## Architecture

The bot never touches the engine's internals — it is a pure HTTP client
of `ace rpc`, where the bearer token *is* the engine user id (the
surface names the caller; the engine decides everything else):

```
Discord ⇄ ace-discord (this bot) ⇄ HTTP ⇄ ace rpc ⇄ engine ⇄ content repo
```

Two processes: the engine host (`ace rpc`) and this bot. They can live on
different machines; the bot needs only the URL.

**One engine process.** ace's file run store is one process per repo
directory, so the bot talks to the single running `ace rpc`, and nobody
runs the `ace` CLI against the same repo while it is up.

## Run it

Prereqs: Node 26+ (the engine requires it; the bot itself runs on 22+),
pnpm, a running ace repo (see the ace README).

**1. The engine side** (from your ace checkout):

```
ace init demo
cd demo && ace rpc          # listens on :3111
```

By default the engine answers with a scripted model. Set
`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` on the engine side, exported
or in a `.env` at the ace checkout root, for a real one; which model a step runs on is the workspace's `models:` policy, not
an environment variable (see the ace README).

**2. The Discord app** (~2 minutes):

- <https://discord.com/developers/applications> → New Application → Bot →
  copy the **token**; General Information → copy the **application id**.
- Invite it: `https://discord.com/oauth2/authorize?client_id=<application id>&scope=bot+applications.commands&permissions=2048`
  (2048 = Send Messages).

**3. The bot side** (this repo):

```
pnpm install && pnpm typecheck

cp users.example.json users.json     # put REAL Discord user ids in it
# (Discord: Settings → Advanced → Developer Mode, then right-click a user → Copy User ID)

export DISCORD_TOKEN=...             # the bot token
export DISCORD_CLIENT_ID=...         # the application id
export DISCORD_GUILD_ID=...          # your server id — optional but instant registration
export ACE_RPC_URL=http://localhost:3111
export ACE_USERS=./users.json        # optional: path to the identity map
export ACE_SIGNOFF_URI=qa://release-signoff   # optional: what /signoff dispatches

pnpm register                        # registers /list, /inbox and /signoff
pnpm start
```

## The storyboard

With two Discord accounts mapped — one to `alice` (holds `qa`), one to
`bob` (holds nothing):

1. As bob: `/list` → "Nothing — as `bob`, visible = callable, and you hold neither."
2. As alice: `/list` → the approve-release tool and both qa workflows
   (release-signoff, weekly-policy-review).
3. As alice: `/signoff version:1.4.0` → the AI's recommendation appears
   in-channel, then: parked on a human decision, with Approve/Reject.
4. As alice: `/inbox` → the parked ask, with its step, run and expiry and
   its own Approve/Reject. As bob: `/inbox` → "Nothing waiting for you."
   Same engine, same ask; bob lacks the answer scope, so it is not his.
5. **As bob: click Approve** → ephemeral `scope_denied`, verbatim from
   the engine, hint included. The button did nothing because bob may do
   nothing — the bot has no opinion about it.
6. As alice: click Approve → the run completes, tag and all, attributed
   to alice in the run log (`ace runs show <id>` on the engine side shows
   the whole story: who asked, what the AI said, who approved, what ran).

Kill `ace rpc` between steps 3 and 6 and restart it: the buttons still
work — the parked ask lives in the engine's run store, not in the bot.

## Develop

```
pnpm typecheck   # tsc (also builds dist/)
pnpm test        # handler decisions + the wire contract, 17 tests
```

`src/handlers.ts` is the whole bot as pure functions (data in, Reply
out); `src/discord.ts` is the dumb wiring; `src/rpc.ts` is the engine
client. Point any other chat platform at the same three files and you
have the next surface.

## License

Apache-2.0.
