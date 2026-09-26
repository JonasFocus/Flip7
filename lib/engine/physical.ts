import { scorePhysical } from "./score.ts";
import type { PhysicalEntry, ScoreIntent, ScorePlayer, ScoreState } from "./types.ts";

const MAX_SEATS = 10;
const PLUS_VALUES = [2, 4, 6, 8, 10];

type ScoreResult = { ok: true; state: ScoreState } | { ok: false; error: string };

export function createScoreGame(opts: { goal?: number } = {}): ScoreState {
  return { phase: "lobby", goal: opts.goal ?? 200, round: 0, players: [], entries: {}, winnerIds: [] };
}

export function addScoreSeat(s: ScoreState, seat: { id: string; name: string; ownerId: string }): ScoreState {
  if (s.phase === "gameOver" || s.players.length >= MAX_SEATS || s.players.some((p) => p.id === seat.id)) return s;
  const completed = s.players[0]?.rounds.length ?? 0;
  const player: ScorePlayer = { ...seat, total: 0, rounds: Array<number | null>(completed).fill(null) };
  return { ...s, players: [...s.players, player], entries: { ...s.entries, [seat.id]: null } };
}

function normalizeEntry(e: PhysicalEntry): PhysicalEntry | null {
  const okNumbers =
    Array.isArray(e.numbers) &&
    e.numbers.length <= 7 &&
    e.numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 12) &&
    new Set(e.numbers).size === e.numbers.length;
  const okPlus =
    Array.isArray(e.plus) && e.plus.every((v) => PLUS_VALUES.includes(v)) && new Set(e.plus).size === e.plus.length;
  if (!okNumbers || !okPlus || typeof e.x2 !== "boolean" || typeof e.busted !== "boolean") return null;
  return { numbers: [...e.numbers].sort((a, b) => a - b), x2: e.x2, plus: [...e.plus].sort((a, b) => a - b), busted: e.busted };
}

function winners(players: ScorePlayer[], goal: number): string[] {
  const top = Math.max(...players.map((p) => p.total));
  return top >= goal ? players.filter((p) => p.total === top).map((p) => p.id) : [];
}

export function applyScoreIntent(
  s: ScoreState,
  actorId: string,
  intent: ScoreIntent,
  opts: { isHost: boolean; seatName?: string },
): ScoreResult {
  const ok = (state: ScoreState): ScoreResult => ({ ok: true, state });
  const fail = (error: string): ScoreResult => ({ ok: false, error });
  const hostOnly = ["start", "finishRound", "undoRound", "setGoal", "playAgain"];
  if (hostOnly.includes(intent.type) && !opts.isHost) return fail("Only the host can do that");
  const seatOf = (seatId: string) => s.players.find((p) => p.id === seatId);
  const canControl = (seat: ScorePlayer) => opts.isHost || seat.ownerId === actorId;

  switch (intent.type) {
    case "addSeat": {
      const name = (intent.name || opts.seatName || "").trim();
      if (name.length === 0 || name.length > 20) return fail("Name must be 1-20 characters");
      if (s.phase === "gameOver") return fail("The game is over");
      if (s.players.length >= MAX_SEATS) return fail("The table is full");
      let k = 1;
      while (seatOf(`${actorId}~${k}`)) k++;
      return ok(addScoreSeat(s, { id: `${actorId}~${k}`, name, ownerId: actorId }));
    }
    case "removeSeat": {
      const seat = seatOf(intent.seatId);
      if (!seat) return fail("No such seat");
      if (!canControl(seat)) return fail("Not your seat");
      const entries = { ...s.entries };
      delete entries[seat.id];
      return ok({ ...s, players: s.players.filter((p) => p !== seat), entries });
    }
    case "start":
      if (s.phase !== "lobby") return fail("Already started");
      if (s.players.length === 0) return fail("Add at least one player");
      return ok({ ...s, phase: "playing", round: 1, entries: Object.fromEntries(s.players.map((p) => [p.id, null])) });
    case "submitEntry": {
      const seat = seatOf(intent.seatId);
      if (s.phase !== "playing") return fail("Not playing");
      if (!seat) return fail("No such seat");
      if (!canControl(seat)) return fail("Not your seat");
      const entry = normalizeEntry(intent.entry);
      if (!entry) return fail("Invalid cards");
      return ok({ ...s, entries: { ...s.entries, [seat.id]: entry } });
    }
    case "clearEntry": {
      const seat = seatOf(intent.seatId);
      if (s.phase !== "playing") return fail("Not playing");
      if (!seat) return fail("No such seat");
      if (!canControl(seat)) return fail("Not your seat");
      return ok({ ...s, entries: { ...s.entries, [seat.id]: null } });
    }
    case "finishRound": {
      if (s.phase !== "playing") return fail("Not playing");
      if (s.players.some((p) => !s.entries[p.id])) return fail("Everyone needs an entry first");
      const players = s.players.map((p) => {
        const entry = s.entries[p.id];
        const pts = entry ? scorePhysical(entry) : 0;
        return { ...p, total: p.total + pts, rounds: [...p.rounds, pts] };
      });
      const winnerIds = winners(players, s.goal);
      return ok({
        ...s,
        players,
        winnerIds,
        phase: winnerIds.length > 0 ? "gameOver" : "playing",
        round: winnerIds.length > 0 ? s.round : s.round + 1,
        entries: Object.fromEntries(players.map((p) => [p.id, null])),
      });
    }
    case "undoRound": {
      if (s.phase === "lobby" || (s.players[0]?.rounds.length ?? 0) === 0) return fail("Nothing to undo");
      const players = s.players.map((p) => {
        const last = p.rounds[p.rounds.length - 1] ?? 0;
        return { ...p, total: p.total - last, rounds: p.rounds.slice(0, -1) };
      });
      return ok({
        ...s,
        players,
        phase: "playing",
        round: s.phase === "gameOver" ? s.round : s.round - 1,
        winnerIds: [],
        entries: Object.fromEntries(players.map((p) => [p.id, null])),
      });
    }
    case "setGoal":
      if (s.phase !== "lobby") return fail("Goal can only change before starting");
      if (!Number.isInteger(intent.goal) || intent.goal < 50 || intent.goal > 1000) return fail("Goal must be 50-1000");
      return ok({ ...s, goal: intent.goal });
    case "playAgain":
      if (s.phase !== "gameOver") return fail("The game is not over");
      return ok({
        ...createScoreGame({ goal: s.goal }),
        players: s.players.map((p) => ({ ...p, total: 0, rounds: [] })),
        entries: Object.fromEntries(s.players.map((p) => [p.id, null])),
      });
  }
}
