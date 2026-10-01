import type { RlBet, RlColor, RlIntent, RlPlayer, RlSpot, RlState } from "./types.ts";

export const SEATS = 8;
export const MAX_RL_PLAYERS = 14; // 8 seats plus rail watchers
export const START_CHIPS = 1000;
export const MIN_BET = 5; // per placement, and so per spot
export const MAX_INSIDE = 100; // per spot: straight, split, street, corner, six line
export const MAX_OUTSIDE = 1000; // per spot: columns, dozens, even-money
export const MAX_PLACEMENTS = 60; // chip placements per player per spin, bounds state size
export const BET_MS = 20_000; // after the first bet, the table has this long before the wheel spins
export const SPIN_MS = 7000; // ball circulates, result hidden
export const LAND_MS = 2500; // client: ball drops into the pocket after the reveal; winners are shown after this
export const SETTLE_MS = 9000; // result, winners, then the layout clears for betting
export const HISTORY_SIZE = 20;

type Rng = () => number;

// Uniform in [0, 1) from the platform CSPRNG (Node and browsers), so spins aren't predictable from Math.random state.
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 2 ** 32;
};
export type RlResult = { ok: true; state: RlState } | { ok: false; error: string };

// European single-zero wheel, clockwise from zero.
export const POCKETS: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const colorOf = (n: number): RlColor => (n === 0 ? "green" : REDS.has(n) ? "red" : "black");

// Layout is 3 columns by 12 rows: row r holds 3r+1..3r+3, column k holds numbers with n % 3 === k % 3.
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const num = (s: string): number => (/^(0|[1-9]\d?)$/.test(s) ? Number(s) : -1);
const isFirstOfRow = (n: number): boolean => n >= 1 && n <= 34 && n % 3 === 1;

export const straightSpot = (n: number): RlSpot => `n:${n}`;
export const splitSpot = (a: number, b: number): RlSpot => `s:${Math.min(a, b)}-${Math.max(a, b)}`;
export const streetSpot = (first: number): RlSpot => `t:${first}`;
export const cornerSpot = (lowest: number): RlSpot => `c:${lowest}`;
export const lineSpot = (first: number): RlSpot => `l:${first}`;

const SIMPLE = new Map<string, () => number[]>(Object.entries({
  red: () => range(1, 36).filter((n) => REDS.has(n)),
  black: () => range(1, 36).filter((n) => !REDS.has(n)),
  odd: () => range(1, 36).filter((n) => n % 2 === 1),
  even: () => range(1, 36).filter((n) => n % 2 === 0),
  low: () => range(1, 18),
  high: () => range(19, 36),
}));

// The numbers a spot covers, or null for anything that isn't a real place on the layout.
export function spotNumbers(spot: string): number[] | null {
  const simple = SIMPLE.get(spot);
  if (simple) return simple();
  const [kind, arg] = spot.split(":");
  if (arg === undefined) return null;
  switch (kind) {
    case "n": {
      const n = num(arg);
      return n >= 0 && n <= 36 ? [n] : null;
    }
    case "s": {
      const [a, b] = arg.split("-").map(num);
      if (a === undefined || b === undefined || a < 0 || b > 36 || a >= b) return null;
      const adjacent = a === 0 ? b <= 3 : b === a + 3 || (b === a + 1 && a % 3 !== 0);
      return adjacent ? [a, b] : null;
    }
    case "t": {
      const n = num(arg);
      return isFirstOfRow(n) ? range(n, n + 2) : null;
    }
    case "l": {
      const n = num(arg);
      return isFirstOfRow(n) && n <= 31 ? range(n, n + 5) : null;
    }
    case "c": {
      const n = num(arg);
      return n >= 1 && n <= 32 && n % 3 !== 0 ? [n, n + 1, n + 3, n + 4] : null;
    }
    case "col": {
      const k = num(arg);
      return k >= 1 && k <= 3 ? range(1, 36).filter((n) => n % 3 === k % 3) : null;
    }
    case "doz": {
      const k = num(arg);
      return k >= 1 && k <= 3 ? range(12 * (k - 1) + 1, 12 * k) : null;
    }
    default:
      return null;
  }
}

// Canonical spelling only: aliases like "n:17:x" or "n:05" would be separate keys in the per-spot limit map.
const CANONICAL_SPOT = /^(?:[a-z]+|[a-z]+:(?:0|[1-9]\d?)(?:-[1-9]\d?)?)$/;
export const isRlSpot = (v: unknown): v is RlSpot => typeof v === "string" && CANONICAL_SPOT.test(v) && spotNumbers(v) !== null;

// Winnings per chip, not counting the returned stake: 36 pockets / numbers covered - 1 (35 straight up ... 1 even-money).
export const spotPayout = (spot: RlSpot): number => 36 / (spotNumbers(spot)?.length ?? 36) - 1;

export const spotWins = (spot: RlSpot, n: number): boolean => spotNumbers(spot)?.includes(n) ?? false;

export const spotLimit = (spot: RlSpot): number => ((spotNumbers(spot)?.length ?? 0) <= 6 ? MAX_INSIDE : MAX_OUTSIDE);

// One row per spot, in first-placed order.
export function betTotals(bets: readonly RlBet[]): RlBet[] {
  const totals = new Map<RlSpot, number>();
  for (const b of bets) totals.set(b.spot, (totals.get(b.spot) ?? 0) + b.amount);
  return [...totals].map(([spot, amount]) => ({ spot, amount }));
}

const staked = (bets: readonly RlBet[]): number => bets.reduce((sum, b) => sum + b.amount, 0);
const bump = (s: RlState, prev: RlState): RlState => ({ ...s, seq: prev.seq + 1 });
const patch = (s: RlState, id: string, fn: (p: RlPlayer) => RlPlayer): RlState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? fn(p) : p)),
});
const bettors = (s: RlState): RlPlayer[] => s.players.filter((p) => p.seat !== null && p.bets.length > 0);

export function createRlGame(): RlState {
  return { phase: "betting", players: [], result: null, history: [], spinAt: null, landAt: null, settleAt: null, round: 0, seq: 0 };
}

export function addRlPlayer(s: RlState, p: { id: string; name: string }): RlState {
  if (s.players.length >= MAX_RL_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const player: RlPlayer = {
    id: p.id,
    name: p.name,
    connected: true,
    seat: null,
    chips: START_CHIPS,
    bets: [],
    lastBets: [],
    ready: false,
    result: null,
  };
  return { ...s, players: [...s.players, player], seq: s.seq + 1 };
}

export function setRlConnected(s: RlState, id: string, connected: boolean): RlState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  return { ...patch(s, id, (x) => ({ ...x, connected })), seq: s.seq + 1 };
}

function spin(s: RlState, now: number, rng: Rng): RlState {
  const live = bettors(s);
  if (live.length === 0) return { ...s, spinAt: null };
  return {
    ...s,
    phase: "spinning",
    result: Math.floor(rng() * POCKETS.length),
    round: s.round + 1,
    spinAt: null,
    landAt: now + SPIN_MS,
    players: s.players.map((p) => ({ ...p, ready: false, lastBets: p.bets.length > 0 ? betTotals(p.bets) : p.lastBets })),
  };
}

// Spin as soon as every seated bettor tapped Ready; the first bet starts the clock for the rest.
function syncBetting(s: RlState, now: number, rng: Rng): RlState {
  const live = bettors(s);
  if (live.length === 0) return { ...s, spinAt: null };
  if (live.every((p) => p.ready)) return spin(s, now, rng);
  return { ...s, spinAt: s.spinAt ?? now + BET_MS };
}

function settle(s: RlState, now: number): RlState {
  const n = s.result ?? 0;
  const players = s.players.map((p) => {
    if (p.bets.length === 0) return p;
    const payout = p.bets.reduce((sum, b) => (spotWins(b.spot, n) ? sum + b.amount * (spotPayout(b.spot) + 1) : sum), 0);
    return { ...p, chips: p.chips + payout, result: { net: payout - staked(p.bets), payout } };
  });
  return { ...s, phase: "settle", players, history: [...s.history, n].slice(-HISTORY_SIZE), landAt: null, settleAt: now + SETTLE_MS };
}

function resetTable(s: RlState): RlState {
  const players = s.players.map((p) => ({ ...p, bets: [], ready: false, result: null }));
  return { ...s, phase: "betting", players, result: null, spinAt: null, landAt: null, settleAt: null };
}

export function removeRlPlayer(s: RlState, id: string, opts: { now: number; rng?: Rng }): RlState {
  if (!s.players.some((p) => p.id === id)) return s;
  const next: RlState = { ...s, players: s.players.filter((p) => p.id !== id), seq: s.seq + 1 };
  return s.phase === "betting" ? syncBetting(next, opts.now, opts.rng ?? cryptoRng) : next;
}

export function applyRlIntent(s: RlState, actorId: string, intent: RlIntent, opts: { isHost: boolean; now: number; rng?: Rng }): RlResult {
  const me = s.players.find((p) => p.id === actorId);
  if (!me) return { ok: false, error: "You are not at this table" };
  const rng = opts.rng ?? cryptoRng;
  const { now } = opts;
  const done = (state: RlState): RlResult => ({ ok: true, state: bump(state, s) });
  const fail = (error: string): RlResult => ({ ok: false, error });
  const betting = (state: RlState): RlResult => done(syncBetting(state, now, rng));
  const setBets = (bets: RlBet[], chips: number): RlState => patch(s, actorId, (p) => ({ ...p, bets, chips, ready: false }));

  const needBetting = (): string | null => {
    if (s.phase !== "betting") return "Bets are closed";
    if (me.seat === null) return "Take a seat first";
    return null;
  };

  // The one place bets are added, so limits live here: per spot, per spin, and the bankroll.
  const add = (adds: RlBet[]): RlResult => {
    const cost = staked(adds);
    if (cost > me.chips) return fail("Not enough chips");
    if (me.bets.length + adds.length > MAX_PLACEMENTS) return fail("Too many chips on the table");
    const totals = new Map(betTotals(me.bets).map((b) => [b.spot, b.amount]));
    for (const b of adds) {
      const total = (totals.get(b.spot) ?? 0) + b.amount;
      if (total > spotLimit(b.spot)) return fail(`Table limit on that spot is ${spotLimit(b.spot)}`);
      totals.set(b.spot, total);
    }
    return betting(setBets([...me.bets, ...adds], me.chips - cost));
  };

  switch (intent.type) {
    case "sit": {
      const { seat } = intent;
      if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) return fail("No such seat");
      if (s.players.some((p) => p.seat === seat)) return fail("Seat taken");
      if (me.bets.length > 0) return fail("Finish your spin first");
      return done(patch(s, actorId, (p) => ({ ...p, seat, ready: false })));
    }
    case "standUp": {
      if (me.seat === null) return fail("You're not seated");
      if (s.phase !== "betting" && me.bets.length > 0) return fail("Finish your spin first");
      const next = patch(s, actorId, (p) => ({ ...p, seat: null, ready: false, bets: [], chips: p.chips + staked(p.bets) }));
      return s.phase === "betting" ? betting(next) : done(next);
    }
    case "place": {
      const blocked = needBetting();
      if (blocked) return fail(blocked);
      if (!isRlSpot(intent.spot)) return fail("No such bet");
      if (!Number.isInteger(intent.amount) || intent.amount < MIN_BET) return fail(`Minimum bet is ${MIN_BET}`);
      return add([{ spot: intent.spot, amount: intent.amount }]);
    }
    case "undo": {
      const blocked = needBetting();
      if (blocked) return fail(blocked);
      const last = me.bets.at(-1);
      if (!last) return fail("Nothing to undo");
      return betting(setBets(me.bets.slice(0, -1), me.chips + last.amount));
    }
    case "clear": {
      const blocked = needBetting();
      if (blocked) return fail(blocked);
      if (me.bets.length === 0) return fail("Nothing to clear");
      return betting(setBets([], me.chips + staked(me.bets)));
    }
    case "rebet": {
      const blocked = needBetting();
      if (blocked) return fail(blocked);
      if (me.bets.length > 0) return fail("Clear the table first");
      if (me.lastBets.length === 0) return fail("No previous bets");
      return add(me.lastBets);
    }
    case "double": {
      const blocked = needBetting();
      if (blocked) return fail(blocked);
      if (me.bets.length === 0) return fail("Nothing to double");
      return add(betTotals(me.bets));
    }
    case "ready": {
      const blocked = needBetting();
      if (blocked) return fail(blocked);
      if (me.bets.length === 0) return fail("Place a bet first");
      return betting(patch(s, actorId, (p) => ({ ...p, ready: true })));
    }
    case "rebuy":
      if (s.phase !== "betting") return fail("Wait for the spin to finish");
      if (me.chips >= MIN_BET || me.bets.length > 0) return fail("You still have chips");
      return done(patch(s, actorId, (p) => ({ ...p, chips: START_CHIPS })));
  }
  return fail("Unknown action");
}

export function serverDeadline(s: RlState): number | null {
  if (s.phase === "betting") return s.spinAt;
  if (s.phase === "spinning") return s.landAt;
  return s.settleAt;
}

export const visibleDeadline = serverDeadline;

export function onDeadline(s: RlState, now: number, rng: Rng = cryptoRng): RlState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "betting") return bump(spin(s, now, rng), s);
  if (s.phase === "spinning") return bump(settle(s, now), s);
  return bump(resetTable(s), s);
}

export function redactRl(s: RlState): RlState {
  return s.phase === "spinning" ? { ...s, result: null } : s;
}
