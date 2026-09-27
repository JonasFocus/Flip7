import { LOCATIONS } from "./locations.ts";
import type { SpyIntent, SpyResult, SpyState, SpyTimer } from "./types.ts";

export const MIN_SPY_PLAYERS = 3;
export const MAX_SPY_PLAYERS = 10;
export const SPY_TIMERS: readonly SpyTimer[] = [4, 6, 8];

type Rng = () => number;
export type SpyApplyResult = { ok: true; state: SpyState } | { ok: false; error: string };

function pick<T>(items: readonly T[], rng: Rng): T | undefined {
  return items[Math.floor(rng() * items.length)];
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function createSpyGame(): SpyState {
  return {
    phase: "lobby",
    players: [],
    timerMin: 6,
    location: null,
    roles: {},
    spyId: null,
    firstAskerId: null,
    deadline: null,
    votes: {},
    votedIds: [],
    result: null,
    seq: 0,
  };
}

export function addSpyPlayer(s: SpyState, p: { id: string; name: string }): SpyState {
  if (s.phase !== "lobby" || s.players.length >= MAX_SPY_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  return { ...s, players: [...s.players, { id: p.id, name: p.name, connected: true }], seq: s.seq + 1 };
}

export function setSpyConnected(s: SpyState, id: string, connected: boolean): SpyState {
  const player = s.players.find((p) => p.id === id);
  if (!player || player.connected === connected) return s;
  return maybeResolve({ ...s, players: s.players.map((p) => (p.id === id ? { ...p, connected } : p)), seq: s.seq + 1 });
}

function end(s: SpyState, result: SpyResult): SpyState {
  return { ...s, phase: "gameOver", deadline: null, result };
}

const noVotes = { tally: {}, accusedId: null, guess: null };

export function removeSpyPlayer(s: SpyState, id: string, opts: { now: number; rng?: Rng }): SpyState {
  if (!s.players.some((p) => p.id === id)) return s;
  const players = s.players.filter((p) => p.id !== id);
  const roles = Object.fromEntries(Object.entries(s.roles).filter(([pid]) => pid !== id));
  const next: SpyState = { ...s, players, roles, seq: s.seq + 1 };
  if (s.phase === "lobby" || s.phase === "gameOver") return next;
  if (id === s.spyId) return end(next, { winner: "faithful", outcome: "spyLeft", ...noVotes });
  if (players.length < MIN_SPY_PLAYERS) return end(next, { winner: "spy", outcome: "tooFew", ...noVotes });
  const firstAskerId = s.firstAskerId === id ? (pick(players, opts.rng ?? Math.random)?.id ?? null) : s.firstAskerId;
  // Drop the leaver's ballot and any ballot cast against them; those voters vote again.
  const votes = Object.fromEntries(Object.entries(s.votes).filter(([voter, target]) => voter !== id && target !== id));
  return maybeResolve({ ...next, firstAskerId, votes, votedIds: Object.keys(votes) });
}

function maybeResolve(s: SpyState): SpyState {
  if (s.phase !== "voting" || s.votedIds.length === 0) return s;
  const pending = s.players.some((p) => p.connected && !s.votedIds.includes(p.id));
  if (pending) return s;
  const tally: Record<string, number> = {};
  for (const target of Object.values(s.votes)) tally[target] = (tally[target] ?? 0) + 1;
  const cast = Object.keys(s.votes).length;
  const accusedId = Object.keys(tally).find((id) => (tally[id] ?? 0) * 2 > cast) ?? null;
  const caught = accusedId !== null && accusedId === s.spyId;
  return end(s, { winner: caught ? "faithful" : "spy", outcome: caught ? "caught" : "missed", guess: null, tally, accusedId });
}

export function applySpyIntent(
  s: SpyState,
  actorId: string,
  intent: SpyIntent,
  opts: { isHost: boolean; now: number; rng?: Rng },
): SpyApplyResult {
  if (!s.players.some((p) => p.id === actorId)) return { ok: false, error: "You are not in this game" };
  const rng = opts.rng ?? Math.random;
  const done = (state: SpyState): SpyApplyResult => ({ ok: true, state: { ...state, seq: s.seq + 1 } });
  const fail = (error: string): SpyApplyResult => ({ ok: false, error });

  switch (intent.type) {
    case "vote": {
      if (s.phase !== "voting") return fail("Not voting right now");
      if (intent.targetId === actorId) return fail("You can't vote for yourself");
      if (!s.players.some((p) => p.id === intent.targetId)) return fail("Pick a player in the game");
      const votes = { ...s.votes, [actorId]: intent.targetId };
      return done(maybeResolve({ ...s, votes, votedIds: Object.keys(votes) }));
    }
    case "guess": {
      if (s.phase !== "questions") return fail("You can only guess during questions");
      if (actorId !== s.spyId) return fail("Only the spy can guess");
      const guess = LOCATIONS.find((l) => l.name === intent.location)?.name;
      if (!guess) return fail("Unknown location");
      const right = guess === s.location;
      return done(end(s, { winner: right ? "spy" : "faithful", outcome: right ? "guessRight" : "guessWrong", tally: {}, accusedId: null, guess }));
    }
  }

  if (!opts.isHost) return fail("Only the host can do that");
  switch (intent.type) {
    case "setTimer":
      if (s.phase !== "lobby") return fail("Game already started");
      if (!SPY_TIMERS.includes(intent.minutes)) return fail("Invalid timer");
      return done({ ...s, timerMin: intent.minutes });
    case "start": {
      if (s.phase !== "lobby") return fail("Game already started");
      if (s.players.length < MIN_SPY_PLAYERS) return fail(`Need at least ${MIN_SPY_PLAYERS} players`);
      const location = pick(LOCATIONS, rng);
      const spy = pick(s.players, rng);
      const first = pick(s.players, rng);
      if (!location || !spy || !first) return fail("Could not deal cards");
      const deck = shuffle(location.roles, rng);
      const roles = Object.fromEntries(
        s.players.filter((p) => p.id !== spy.id).map((p, i) => [p.id, deck[i % deck.length] ?? location.roles[0] ?? ""]),
      );
      return done({
        ...s,
        phase: "questions",
        location: location.name,
        roles,
        spyId: spy.id,
        firstAskerId: first.id,
        deadline: opts.now + s.timerMin * 60_000,
        votes: {},
        votedIds: [],
        result: null,
      });
    }
    case "startVoting":
      if (s.phase !== "questions") return fail("Not in the question phase");
      return done(toVoting(s));
    case "playAgain":
      if (s.phase !== "gameOver") return fail("Game is not over");
      return done({ ...createSpyGame(), players: s.players, timerMin: s.timerMin });
    default:
      return fail("Unknown action");
  }
}

function toVoting(s: SpyState): SpyState {
  return { ...s, phase: "voting", deadline: null, votes: {}, votedIds: [] };
}

export function serverDeadline(s: SpyState): number | null {
  return s.phase === "questions" ? s.deadline : null;
}

export const visibleDeadline = serverDeadline;

// rng is part of the shared engine signature; nothing random happens when questions time out.
export const onDeadline: (s: SpyState, now: number, rng?: Rng) => SpyState = (s, now) => {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  return { ...toVoting(s), seq: s.seq + 1 };
};

export function redactSpy(s: SpyState, viewerId: string): SpyState {
  if (s.phase === "gameOver") return s;
  const isSpy = viewerId === s.spyId;
  const ownRole = s.roles[viewerId];
  const ownVote = s.votes[viewerId];
  return {
    ...s,
    location: isSpy ? null : s.location,
    roles: ownRole === undefined ? {} : { [viewerId]: ownRole },
    spyId: isSpy ? s.spyId : null,
    votes: ownVote === undefined ? {} : { [viewerId]: ownVote },
  };
}
