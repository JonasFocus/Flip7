# Flip 7 · Family Game Night

A mobile-first web app for playing the Flip 7 card game with family:

- **Play online**: one phone per player, realtime rooms joined by a 6-digit code (up to 10 players, bots optional).
- **Play vs bots**: solo on one device, no server needed.
- **Scorekeeper**: play with real cards and let the app tally each round.

No accounts. Next.js (App Router) frontend, a plain Node `ws` game server with in-memory rooms, and a pure shared rules engine in `lib/engine`.

## Run locally

Requires Node 24+ and pnpm.

```bash
pnpm install
cp .env.example .env.local   # NEXT_PUBLIC_WS_URL=ws://localhost:8787
pnpm dev:server              # game server on :8787
pnpm dev                     # web app on :3000
```

To test on a phone on the same Wi-Fi, set `NEXT_PUBLIC_WS_URL=ws://<your-lan-ip>:8787` and open `http://<your-lan-ip>:3000`.

Checks: `pnpm exec tsc --noEmit -p .`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Deploy

**Game server (Railway).** Create a service from this repo. `railway.json` sets the start command (`node server/index.ts`), the `/health` check and restart policy. Railway provides `PORT`. Rooms live in memory, so run a single instance.

**Frontend (Vercel).** Import the repo as a Next.js project and set `NEXT_PUBLIC_WS_URL` to the Railway public URL with the `wss://` scheme, e.g. `wss://flip7-server.up.railway.app`. Redeploy after changing it, since it is inlined at build time.

## Rules

Game rules follow the published Flip 7 rules (94-card deck: numbers 0 to 12, five plus modifiers and x2, Freeze, Flip Three, Second Chance; first to 200 wins). The in-app "How to play" panel summarizes them.

Flip 7 is a trademark of its respective owner. This is an independent family project.

## Legacy snapshot

`legacy-snapshot/` holds the compiled frontend of the original ChatGPT Sites version (no source). It is kept for reference only and is not part of the build.
