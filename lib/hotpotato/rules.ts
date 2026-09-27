import { POTATO_CATEGORIES } from "./categories.ts";
import type { PotatoIntent, PotatoLives, PotatoPlayer, PotatoState } from "./types.ts";

export const MIN_POTATO_PLAYERS = 3;
export const MAX_POTATO_PLAYERS = 10;
export const PASS_COOLDOWN_MS = 800;
export const OFFLINE_PASS_MS = 5000;
export const BOOM_PAUSE_MS = 4000;
const FUSE_MIN_MS = 12_000;
const FUSE_MAX_MS = 40_000;
const LIVES: readonly PotatoLives[] = [1, 2, 3, 5];

type Rng = () => number;
export type PotatoResult = { ok: true; state: PotatoState } | { ok: false; error: string };

const isAlive = (p: PotatoPlayer): boolean => p.lives > 0;
const alive = (s: PotatoState): PotatoPlayer[] => s.players.filter(isAlive);

function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  return items[Math.floor(rng() * items.length)];
}

// Next alive player after `fromId` in seat order (wrapping). Excludes `fromId` unless it is the only one alive.
function nextAlive(players: PotatoPlayer[], fromId: string): string | null {
  const from = players.findIndex((p) => p.id === fromId);
  for (let i = 1; i <= players.length; i++) {
    const p = players[(from + i) % players.length];
    if (p && isAlive(p)) return p.id;
  }
  return null;
}

export function createPotatoGame(): PotatoState {
  return {
    phase: "lobby",
    players: [],
    startLives: 3,
    categoryId: "random",
    round: 0,
    category: null,
    holderId: null,
    heldSince: null,
    fuseAt: null,
    nextRoundAt: null,
    starterId: null,
    lastBoom: null,
    winnerId: null,
    seq: 0,
  };
}

export function addPotatoPlayer(s: PotatoState, p: { id: string; name: string }): PotatoState {
  if (s.phase !== "lobby" || s.players.length >= MAX_POTATO_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  return { ...s, players: [...s.players, { ...p, connected: true, lives: s.startLives }], seq: s.seq + 1 };
}

export function setPotatoConnected(s: PotatoState, id: string, connected: boolean): PotatoState {
  if (!s.players.some((p) => p.id === id && p.connected !== connected)) return s;
  return { ...s, players: s.players.map((p) => (p.id === id ? { ...p, connected } : p)), seq: s.seq + 1 };
}

export function removePotatoPlayer(s: PotatoState, id: string, opts: { now: number; rng?: Rng }): PotatoState {
  if (!s.players.some((p) => p.id === id)) return s;
  const players = s.players.filter((p) => p.id !== id);
  // Computed on the old seat list so the bomb/start moves to the leaver's left-hand neighbour.
  const successor = nextAlive(s.players, id);
  const next: PotatoState = { ...s, players, seq: s.seq + 1 };
  if (s.phase === "lobby" || s.phase === "gameOver") return next;
  if (alive(next).length <= 1) return finish(next);
  if (s.phase === "playing" && s.holderId === id) return { ...next, holderId: successor, heldSince: opts.now };
  if (s.phase === "boom" && s.starterId === id) return { ...next, starterId: successor };
  return next;
}

function finish(s: PotatoState): PotatoState {
  return {
    ...s,
    phase: "gameOver",
    winnerId: alive(s)[0]?.id ?? null,
    holderId: null,
    heldSince: null,
    fuseAt: null,
    nextRoundAt: null,
    starterId: null,
  };
}

function pickCategory(s: PotatoState, rng: Rng): string {
  const fixed = POTATO_CATEGORIES.find((c) => c.id === s.categoryId);
  if (fixed) return fixed.prompt;
  const fresh = POTATO_CATEGORIES.filter((c) => c.prompt !== s.category);
  return (pick(fresh, rng) ?? POTATO_CATEGORIES[0])?.prompt ?? "Anything!";
}

function beginRound(s: PotatoState, holderId: string | null, now: number, rng: Rng): PotatoState {
  return {
    ...s,
    phase: "playing",
    round: s.round + 1,
    category: pickCategory(s, rng),
    holderId,
    heldSince: now,
    fuseAt: now + FUSE_MIN_MS + Math.floor(rng() * (FUSE_MAX_MS - FUSE_MIN_MS + 1)),
    nextRoundAt: null,
    starterId: null,
  };
}

function passFrom(s: PotatoState, now: number): PotatoState {
  if (!s.holderId) return s;
  return { ...s, holderId: nextAlive(s.players, s.holderId), heldSince: now };
}

export function applyPotatoIntent(
  s: PotatoState,
  actorId: string,
  intent: PotatoIntent,
  opts: { isHost: boolean; now: number; rng?: Rng },
): PotatoResult {
  const fail = (error: string): PotatoResult => ({ ok: false, error });
  if (typeof intent !== "object" || intent === null) return fail("Bad request");
  if (!s.players.some((p) => p.id === actorId)) return fail("You are not in this game");
  const rng = opts.rng ?? Math.random;
  const done = (state: PotatoState): PotatoResult => ({ ok: true, state: { ...state, seq: s.seq + 1 } });

  if (intent.type === "pass") {
    if (s.phase !== "playing") return fail("No bomb right now");
    if (s.holderId !== actorId) return fail("You don't have the bomb");
    if (s.heldSince !== null && opts.now - s.heldSince < PASS_COOLDOWN_MS) return fail("Say a word first!");
    return done(passFrom(s, opts.now));
  }

  if (!opts.isHost) return fail("Only the host can do that");
  switch (intent.type) {
    case "setLives":
      if (s.phase !== "lobby") return fail("Game already started");
      if (!LIVES.includes(intent.lives)) return fail("Invalid lives");
      return done({ ...s, startLives: intent.lives, players: s.players.map((p) => ({ ...p, lives: intent.lives })) });
    case "setCategory":
      if (s.phase !== "lobby") return fail("Game already started");
      if (intent.categoryId !== "random" && !POTATO_CATEGORIES.some((c) => c.id === intent.categoryId)) return fail("Unknown category");
      return done({ ...s, categoryId: intent.categoryId });
    case "start": {
      if (s.phase !== "lobby") return fail("Game already started");
      if (s.players.length < MIN_POTATO_PLAYERS) return fail(`Need at least ${MIN_POTATO_PLAYERS} players`);
      const players = s.players.map((p) => ({ ...p, lives: s.startLives }));
      const base = { ...s, players, round: 0, category: null, lastBoom: null, winnerId: null };
      return done(beginRound(base, pick(players, rng)?.id ?? null, opts.now, rng));
    }
    case "playAgain": {
      if (s.phase !== "gameOver") return fail("Game is not over");
      const players = s.players.map((p) => ({ ...p, lives: s.startLives }));
      return done({ ...createPotatoGame(), players, startLives: s.startLives, categoryId: s.categoryId });
    }
    default:
      return fail("Unknown action");
  }
}

function autoPassAt(s: PotatoState): number | null {
  const holder = s.players.find((p) => p.id === s.holderId);
  // ponytail: no disconnect timestamp in the API, so an offline holder passes once they've held it 5s (immediately if already longer).
  return holder && !holder.connected && s.heldSince !== null ? s.heldSince + OFFLINE_PASS_MS : null;
}

export function serverDeadline(s: PotatoState): number | null {
  if (s.phase === "boom") return s.nextRoundAt;
  if (s.phase !== "playing" || s.fuseAt === null) return null;
  const pass = autoPassAt(s);
  return pass === null ? s.fuseAt : Math.min(pass, s.fuseAt);
}

export function visibleDeadline(s: PotatoState): number | null {
  return s.phase === "boom" ? s.nextRoundAt : null;
}

export function onDeadline(s: PotatoState, now: number, rng: Rng = Math.random): PotatoState {
  if (s.phase === "boom" && s.nextRoundAt !== null && now >= s.nextRoundAt) {
    return { ...beginRound(s, s.starterId, now, rng), seq: s.seq + 1 };
  }
  if (s.phase !== "playing" || !s.holderId) return s;
  if (s.fuseAt !== null && now >= s.fuseAt) {
    const loserId = s.holderId;
    const players = s.players.map((p) => (p.id === loserId ? { ...p, lives: Math.max(0, p.lives - 1) } : p));
    const boomed: PotatoState = {
      ...s,
      players,
      lastBoom: { playerId: loserId, category: s.category ?? "" },
      holderId: null,
      heldSince: null,
      fuseAt: null,
      seq: s.seq + 1,
    };
    if (alive(boomed).length <= 1) return finish(boomed);
    return { ...boomed, phase: "boom", nextRoundAt: now + BOOM_PAUSE_MS, starterId: nextAlive(players, loserId) };
  }
  const pass = autoPassAt(s);
  if (pass !== null && now >= pass) return { ...passFrom(s, now), seq: s.seq + 1 };
  return s;
}

// Only the fuse is secret; nothing is per-viewer.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- viewerId keeps the uniform game API
export function redactPotato(s: PotatoState, viewerId: string): PotatoState {
  return { ...s, fuseAt: null };
}
