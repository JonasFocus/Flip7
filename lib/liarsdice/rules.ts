import type { Bid, Challenge, DiceCount, DiceIntent, DicePlayer, DiceState } from "./types.ts";

export const MIN_DICE_PLAYERS = 2;
export const MAX_DICE_PLAYERS = 8;
export const REVEAL_MS = 6000;
export const OFFLINE_AUTO_MS = 30_000;
const DICE_COUNTS: readonly DiceCount[] = [3, 4, 5];

type Rng = () => number;
export type DiceResult = { ok: true; state: DiceState } | { ok: false; error: string };

const alive = (s: DiceState): DicePlayer[] => s.players.filter((p) => p.diceCount > 0);
const bump = (s: DiceState, prev: DiceState): DiceState => ({ ...s, seq: prev.seq + 1 });
const rollDie = (rng: Rng): number => Math.min(6, 1 + Math.floor(rng() * 6));

export const totalDice = (s: DiceState): number => s.players.reduce((n, p) => n + p.diceCount, 0);

export function isRaise(prev: Bid | null, next: Bid): boolean {
  return !prev || next.count > prev.count || (next.count === prev.count && next.face > prev.face);
}

export function minRaise(prev: Bid | null): Bid {
  if (!prev) return { count: 1, face: 2 };
  return prev.face < 6 ? { count: prev.count, face: prev.face + 1 } : { count: prev.count + 1, face: 2 };
}

export const matches = (die: number, face: number): boolean => die === face || die === 1;

// First player with dice at or after seat `from` (wrapping).
function aliveFromSeat(players: DicePlayer[], from: number): DicePlayer | undefined {
  for (let i = 0; i < players.length; i++) {
    const p = players[(from + i) % players.length];
    if (p && p.diceCount > 0) return p;
  }
  return undefined;
}

function nextAliveAfter(s: DiceState, id: string): DicePlayer | undefined {
  return aliveFromSeat(s.players, s.players.findIndex((p) => p.id === id) + 1);
}

export function createDiceGame(): DiceState {
  return {
    phase: "lobby",
    players: [],
    startDice: 5,
    round: 0,
    turnId: null,
    turnAt: null,
    bid: null,
    bidderId: null,
    lastChallenge: null,
    revealDeadline: null,
    winnerId: null,
    seq: 0,
  };
}

export function addDicePlayer(s: DiceState, p: { id: string; name: string }): DiceState {
  if (s.phase !== "lobby" || s.players.length >= MAX_DICE_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const player: DicePlayer = { id: p.id, name: p.name, connected: true, offlineSince: null, diceCount: 0, dice: [] };
  return { ...s, players: [...s.players, player], seq: s.seq + 1 };
}

// ponytail: `now` is optional to fit the shared adapter signature; pass it for deterministic offline timers.
export function setDiceConnected(s: DiceState, id: string, connected: boolean, now: number = Date.now()): DiceState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  const players = s.players.map((x) => (x.id === id ? { ...x, connected, offlineSince: connected ? null : now } : x));
  return { ...s, players, seq: s.seq + 1 };
}

function finish(s: DiceState): DiceState {
  return { ...s, phase: "gameOver", turnId: null, turnAt: null, revealDeadline: null, winnerId: alive(s)[0]?.id ?? null };
}

function beginRound(s: DiceState, starterId: string | null, now: number, rng: Rng): DiceState {
  const players = s.players.map((p) => ({ ...p, dice: Array.from({ length: p.diceCount }, () => rollDie(rng)) }));
  const next = { ...s, players };
  const starter = next.players.find((p) => p.id === starterId && p.diceCount > 0);
  const list = alive(next);
  const turnId = starter?.id ?? list[Math.floor(rng() * list.length)]?.id ?? null;
  return { ...next, phase: "bidding", round: s.round + 1, turnId, turnAt: now, bid: null, bidderId: null, revealDeadline: null };
}

// Round 2+: the loser starts, or the next player with dice if they were eliminated.
function nextRound(s: DiceState, now: number, rng: Rng): DiceState {
  const loser = s.players.find((p) => p.id === s.lastChallenge?.loserId);
  const starter = !loser ? undefined : loser.diceCount > 0 ? loser : nextAliveAfter(s, loser.id);
  return beginRound(s, starter?.id ?? null, now, rng);
}

function placeBid(s: DiceState, actorId: string, bid: Bid, now: number): DiceState {
  return { ...s, bid, bidderId: actorId, turnId: nextAliveAfter(s, actorId)?.id ?? null, turnAt: now };
}

function challenge(s: DiceState, callerId: string, now: number): DiceState {
  if (!s.bid || !s.bidderId) return s;
  const bid = s.bid;
  const total = alive(s).reduce((n, p) => n + p.dice.filter((d) => matches(d, bid.face)).length, 0);
  const loserId = total >= bid.count ? callerId : s.bidderId;
  const lastChallenge: Challenge = { bidderId: s.bidderId, callerId, bid, total, loserId };
  // Dice arrays stay as rolled so the reveal shows them; diceCount already reflects the loss.
  const players = s.players.map((p) => (p.id === loserId ? { ...p, diceCount: p.diceCount - 1 } : p));
  const next: DiceState = { ...s, players, lastChallenge, turnId: null, turnAt: null };
  if (alive(next).length <= 1) return finish(next);
  return { ...next, phase: "reveal", revealDeadline: now + REVEAL_MS };
}

export function removeDicePlayer(s: DiceState, id: string, opts: { now: number; rng?: Rng }): DiceState {
  if (!s.players.some((p) => p.id === id)) return s;
  const rng = opts.rng ?? Math.random;
  const players = s.players.filter((p) => p.id !== id);
  const next: DiceState = { ...s, players, seq: s.seq + 1 };
  if (s.phase === "lobby" || s.phase === "gameOver") return next;
  if (alive(next).length <= 1) return finish(next);
  // An eliminated player's leave touches neither the bid nor the turn.
  if (s.phase === "reveal" || s.players.some((p) => p.id === id && p.diceCount === 0)) return next;
  // Bidding: the standing bid may involve the leaver's dice, so reroll. Turn stays put or passes on.
  const starter = s.turnId === id ? nextAliveAfter(s, id) : s.players.find((p) => p.id === s.turnId);
  return beginRound({ ...next, round: s.round - 1 }, starter?.id ?? null, opts.now, rng);
}

export function applyDiceIntent(
  s: DiceState,
  actorId: string,
  intent: DiceIntent,
  opts: { isHost: boolean; now: number; rng?: Rng },
): DiceResult {
  const actor = s.players.find((p) => p.id === actorId);
  if (!actor) return { ok: false, error: "You are not in this game" };
  const rng = opts.rng ?? Math.random;
  const done = (state: DiceState): DiceResult => ({ ok: true, state: bump(state, s) });
  const fail = (error: string): DiceResult => ({ ok: false, error });

  switch (intent.type) {
    case "bid": {
      if (s.phase !== "bidding") return fail("Not bidding right now");
      if (s.turnId !== actorId) return fail("It's not your turn");
      const { count, face } = intent;
      if (!Number.isInteger(face) || face < 2 || face > 6) return fail("Bid a face from 2 to 6");
      if (!Number.isInteger(count) || count < 1 || count > totalDice(s)) return fail("Invalid dice count");
      if (!isRaise(s.bid, { count, face })) return fail("You must raise the bid");
      return done(placeBid(s, actorId, { count, face }, opts.now));
    }
    case "liar":
      if (s.phase !== "bidding") return fail("Not bidding right now");
      if (s.turnId !== actorId) return fail("It's not your turn");
      if (!s.bid) return fail("There's no bid to challenge");
      return done(challenge(s, actorId, opts.now));
  }

  if (!opts.isHost) return fail("Only the host can do that");
  switch (intent.type) {
    case "setDice":
      if (s.phase !== "lobby") return fail("Game already started");
      if (!DICE_COUNTS.includes(intent.count)) return fail("Pick 3, 4 or 5 dice");
      return done({ ...s, startDice: intent.count });
    case "start": {
      if (s.phase !== "lobby") return fail("Game already started");
      if (s.players.length < MIN_DICE_PLAYERS) return fail(`Need at least ${MIN_DICE_PLAYERS} players`);
      const players = s.players.map((p) => ({ ...p, diceCount: s.startDice }));
      return done(beginRound({ ...s, players, round: 0, lastChallenge: null, winnerId: null }, null, opts.now, rng));
    }
    case "nextRound":
      if (s.phase !== "reveal") return fail("Nothing to continue");
      return done(nextRound(s, opts.now, rng));
    case "playAgain": {
      if (s.phase !== "gameOver") return fail("Game is not over");
      const players = s.players.map((p) => ({ ...p, diceCount: 0, dice: [] }));
      return done({ ...createDiceGame(), players, startDice: s.startDice });
    }
  }
  return fail("Unknown action");
}

function autoDeadline(s: DiceState): number | null {
  if (s.phase !== "bidding" || s.turnAt === null) return null;
  const p = s.players.find((x) => x.id === s.turnId);
  if (!p || p.connected || p.offlineSince === null) return null;
  return Math.max(s.turnAt, p.offlineSince) + OFFLINE_AUTO_MS;
}

export function serverDeadline(s: DiceState): number | null {
  return s.phase === "reveal" ? s.revealDeadline : autoDeadline(s);
}

// Neither deadline is secret.
export const visibleDeadline = serverDeadline;

// ponytail: naive expectation (own matches + a third of unseen dice); good enough for a stand-in move.
function autoMove(s: DiceState, p: DicePlayer): Bid | "liar" {
  if (s.bid) {
    const own = p.dice.filter((d) => matches(d, s.bid?.face ?? 0)).length;
    const expected = own + (totalDice(s) - p.diceCount) / 3;
    if (s.bid.count > expected + 1) return "liar";
  }
  const raise = minRaise(s.bid);
  return raise.count > totalDice(s) ? "liar" : raise;
}

export function onDeadline(s: DiceState, now: number, rng: Rng = Math.random): DiceState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "reveal") return bump(nextRound(s, now, rng), s);
  const p = s.players.find((x) => x.id === s.turnId);
  if (!p) return s;
  const move = autoMove(s, p);
  return bump(move === "liar" ? challenge(s, p.id, now) : placeBid(s, p.id, move, now), s);
}

export function redactDice(s: DiceState, viewerId: string): DiceState {
  if (s.phase === "reveal" || s.phase === "gameOver") return s;
  return { ...s, players: s.players.map((p) => (p.id === viewerId ? p : { ...p, dice: [] })) };
}
