# Flip 7 · Family Game Night

A mobile-first scorekeeper and virtual card table for playing Flip 7 with family and friends. Host a room, join by numeric code, play with up to 10 people, or start a solo game with bots.

## Features

- Real-time multiplayer rooms with ready-up, turn order, running totals, and round results
- Virtual cards, Hit/Stay decisions, Freeze targeting, bust detection, and animated reveals
- Physical-card scorekeeping with optional photo scanning
- Bot opponents for solo testing
- Responsive card table for portrait and landscape phones

## Run locally

Requires Node.js 22.13+ and pnpm 11.25.0.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

The app is built with React, TypeScript, Vinext, and Cloudflare Workers/D1. Its production deployment uses the ChatGPT Sites hosting configuration in `.openai/hosting.json`; a local install uses the development configuration. The OCR assets in `public/ocr` are bundled for card photo scanning. See `tests/virtual.test.ts` for gameplay coverage.

Live app: https://flip-seven-family.jonasinfocus.chatgpt.site

Flip 7 is a trademark of its respective owner. This is an independent family project.
