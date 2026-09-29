import { CATEGORIES } from "./categories.ts";
import type { ImposterIntent, ImposterPlayer, ImposterState, ImposterTimer, VoteResult } from "./types.ts";

export const MIN_IMPOSTER_PLAYERS = 3;
export const MAX_IMPOSTER_PLAYERS = 10;
export const VOTING_MS = 60_000;
const TIMERS: readonly ImposterTimer[] = [90, 120, 300];

type Rng = () => number;
export type ImposterResult = { ok: true; state: ImposterState } | { ok: false; error: string };

function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  return items[Math.floor(rng() * items.length)];
}

const alive = (s: ImposterState): ImposterPlayer[] => s.players.filter((p) => !p.eliminated);

export function createImposterGame(): ImposterState {
  return {
    phase: "lobby",
    players: [],
    categoryId: "random",
    timerSec: 120,
    maxRounds: 2,
    round: 0,
    category: null,
    word: null,
    imposterId: null,
    starterId: null,
    cluesDeadline: null,
    votingDeadline: null,
    votes: {},
    votedIds: [],
    lastResult: null,
    winner: null,
    seq: 0,
  };
}

export function addImposterPlayer(s: ImposterState, p: { id: string; name: string }): ImposterState {
  if (s.phase !== "lobby" || s.players.length >= MAX_IMPOSTER_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  return { ...s, players: [...s.players, { ...p, connected: true, eliminated: false }], seq: s.seq + 1 };
}

export function setImposterConnected(s: ImposterState, id: string, connected: boolean): ImposterState {
  if (!s.players.some((p) => p.id === id)) return s;
  const next = { ...s, players: s.players.map((p) => (p.id === id ? { ...p, connected } : p)), seq: s.seq + 1 };
  return maybeResolve(next);
}

export function removeImposterPlayer(s: ImposterState, id: string): ImposterState {
  if (!s.players.some((p) => p.id === id)) return s;
  const players = s.players.filter((p) => p.id !== id);
  const next: ImposterState = { ...s, players, seq: s.seq + 1 };
  if (s.phase === "lobby" || s.phase === "gameOver") return next;
  if (id === s.imposterId) return { ...next, phase: "gameOver", cluesDeadline: null, votingDeadline: null, winner: "faithful" };
  if (alive(next).length <= 2) return { ...next, phase: "gameOver", cluesDeadline: null, votingDeadline: null, winner: "imposter" };
  // Drop the leaver's ballot and any ballot cast against them; those voters vote again.
  const votes = Object.fromEntries(Object.entries(s.votes).filter(([voter, target]) => voter !== id && target !== id));
  return maybeResolve({ ...next, votes, votedIds: Object.keys(votes) });
}

function maybeResolve(s: ImposterState): ImposterState {
  if (s.phase !== "voting" || s.votedIds.length === 0) return s;
  const pending = alive(s).some((p) => p.connected && !s.votedIds.includes(p.id));
  return pending ? s : resolve(s);
}

function resolve(s: ImposterState): ImposterState {
  s = { ...s, votingDeadline: null };
  const tally: Record<string, number> = {};
  for (const target of Object.values(s.votes)) tally[target] = (tally[target] ?? 0) + 1;
  const cast = Object.keys(s.votes).length;
  const votedOutId = Object.keys(tally).find((id) => (tally[id] ?? 0) * 2 > cast) ?? null;
  const wasImposter = votedOutId !== null && votedOutId === s.imposterId;
  const lastResult: VoteResult = { round: s.round, tally, votedOutId, wasImposter };
  if (wasImposter) return { ...s, phase: "gameOver", lastResult, winner: "faithful" };
  const players = s.players.map((p) => (p.id === votedOutId ? { ...p, eliminated: true } : p));
  const next = { ...s, players, lastResult };
  const over = s.round >= s.maxRounds || alive(next).length <= 2;
  return over ? { ...next, phase: "gameOver", winner: "imposter" } : { ...next, phase: "reveal" };
}

function beginRound(s: ImposterState, round: number, now: number, rng: Rng): ImposterState {
  return {
    ...s,
    phase: "clues",
    round,
    starterId: pick(alive(s), rng)?.id ?? null,
    cluesDeadline: now + s.timerSec * 1000,
    votingDeadline: null,
    votes: {},
    votedIds: [],
  };
}

export function applyImposterIntent(
  s: ImposterState,
  actorId: string,
  intent: ImposterIntent,
  opts: { isHost: boolean; now: number; rng?: Rng },
): ImposterResult {
  const actor = s.players.find((p) => p.id === actorId);
  if (!actor) return { ok: false, error: "You are not in this game" };
  const rng = opts.rng ?? Math.random;
  const done = (state: ImposterState): ImposterResult => ({ ok: true, state: { ...state, seq: s.seq + 1 } });
  const fail = (error: string): ImposterResult => ({ ok: false, error });

  if (intent.type === "vote") {
    if (s.phase !== "voting") return fail("Not voting right now");
    if (s.votingDeadline !== null && opts.now >= s.votingDeadline) return fail("Voting has ended");
    if (actor.eliminated) return fail("You are out and can't vote");
    if (intent.targetId === actorId) return fail("You can't vote for yourself");
    if (!alive(s).some((p) => p.id === intent.targetId)) return fail("Pick a player who is still in");
    const votes = { ...s.votes, [actorId]: intent.targetId };
    return done(maybeResolve({ ...s, votes, votedIds: Object.keys(votes) }));
  }

  if (!opts.isHost) return fail("Only the host can do that");
  switch (intent.type) {
    case "setCategory":
      if (s.phase !== "lobby") return fail("Game already started");
      if (intent.categoryId !== "random" && !CATEGORIES.some((c) => c.id === intent.categoryId)) return fail("Unknown category");
      return done({ ...s, categoryId: intent.categoryId });
    case "setTimer":
      if (s.phase !== "lobby") return fail("Game already started");
      if (!TIMERS.includes(intent.sec)) return fail("Invalid timer");
      return done({ ...s, timerSec: intent.sec });
    case "start": {
      if (s.phase !== "lobby") return fail("Game already started");
      if (s.players.length < MIN_IMPOSTER_PLAYERS) return fail(`Need at least ${MIN_IMPOSTER_PLAYERS} players`);
      const category = s.categoryId === "random" ? pick(CATEGORIES, rng) : CATEGORIES.find((c) => c.id === s.categoryId);
      const word = category && pick(category.words, rng);
      const imposter = pick(s.players, rng);
      if (!category || !word || !imposter) return fail("Could not deal cards");
      const players = s.players.map((p) => ({ ...p, eliminated: false }));
      const base = { ...s, players, category: category.name, word, imposterId: imposter.id, lastResult: null, winner: null };
      return done(beginRound(base, 1, opts.now, rng));
    }
    case "startVoting":
      if (s.phase !== "clues") return fail("Not in the clue phase");
      return done(toVoting(s, opts.now));
    case "nextRound":
      if (s.phase !== "reveal") return fail("Nothing to continue");
      return done(beginRound(s, s.round + 1, opts.now, rng));
    case "playAgain": {
      if (s.phase !== "gameOver") return fail("Game is not over");
      const players = s.players.map((p) => ({ ...p, eliminated: false }));
      return done({ ...createImposterGame(), players, categoryId: s.categoryId, timerSec: s.timerSec });
    }
  }
}

function toVoting(s: ImposterState, now: number): ImposterState {
  return { ...s, phase: "voting", cluesDeadline: null, votingDeadline: now + VOTING_MS, votes: {}, votedIds: [] };
}

export function serverDeadline(s: ImposterState): number | null {
  return s.phase === "clues" ? s.cluesDeadline : s.phase === "voting" ? s.votingDeadline : null;
}

export function onDeadline(s: ImposterState, now: number): ImposterState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  const next = s.phase === "clues" ? toVoting(s, now) : resolve(s);
  return { ...next, seq: s.seq + 1 };
}

export function redactImposter(s: ImposterState, viewerId: string): ImposterState {
  const isImposter = viewerId === s.imposterId;
  const gameOver = s.phase === "gameOver";
  const ownVote = s.votes[viewerId];
  return {
    ...s,
    word: s.phase === "lobby" || (isImposter && !gameOver) ? null : s.word,
    imposterId: isImposter || gameOver ? s.imposterId : null,
    votes: s.phase !== "voting" ? s.votes : ownVote === undefined ? {} : { [viewerId]: ownVote },
  };
}
