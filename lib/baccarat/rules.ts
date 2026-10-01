import type { Rank, Suit } from "../blackjack/types.ts";
import { BAC_SPOTS, type BacBets, type BacCard, type BacIntent, type BacPlayer, type BacRound, type BacState } from "./types.ts";

export const SEATS = 5;
export const MAX_BAC_PLAYERS = 10; // 5 seats plus rail watchers
export const START_CHIPS = 1000;
export const MIN_BET = 10;
export const MAX_BET = 5000; // per spot
export const DECKS = 8;
export const SHOE_SIZE = 52 * DECKS;
export const BET_MS = 15_000; // once someone has a bet in, the table has this long to bet and tap Deal
export const DEAL_LEAD_MS = 900; // bets close, a beat before the first card
export const CARD_MS = 1100; // client slide plus a read beat per opening card
export const THIRD_CARD_MS = 1700; // third cards get a longer pause so the tableau is followable
export const SETTLE_MS = 7000; // result, chip sweeps, then the cards clear
export const ROAD_LENGTH = 60;
export const PAIR_PAYOUT = 11;
export const TIE_PAYOUT = 8;
const CUT_AT = 16; // reshuffle before a coup when fewer cards than this remain (a coup uses at most 6)

type Rng = () => number;

// Uniform in [0, 1) from the platform CSPRNG (Node and browsers), so shuffles aren't predictable from Math.random state.
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 2 ** 32;
};
export type BacResult = { ok: true; state: BacState } | { ok: false; error: string };

const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: readonly Suit[] = ["s", "h", "d", "c"];

const bump = (s: BacState, prev: BacState): BacState => ({ ...s, seq: prev.seq + 1 });
const patch = (s: BacState, id: string, fn: (p: BacPlayer) => BacPlayer): BacState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? fn(p) : p)),
});

export const emptyBets = (): BacBets => ({ player: 0, banker: 0, tie: 0, playerPair: 0, bankerPair: 0 });
export const totalBet = (b: BacBets): number => BAC_SPOTS.reduce((n, k) => n + b[k], 0);

export function newShoe(rng: Rng): BacCard[] {
  const shoe: BacCard[] = [];
  for (let d = 0; d < DECKS; d++) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = shoe[i];
    const b = shoe[j];
    if (a && b) [shoe[i], shoe[j]] = [b, a];
  }
  return shoe;
}

export const cardValue = (c: BacCard): number => (c.rank === "A" ? 1 : c.rank === "10" || c.rank === "J" || c.rank === "Q" || c.rank === "K" ? 0 : Number(c.rank));
export const handTotal = (cards: readonly BacCard[]): number => cards.reduce((n, c) => n + cardValue(c), 0) % 10;

export function createBacGame(rng: Rng = cryptoRng): BacState {
  return {
    phase: "betting",
    players: [],
    playerHand: [],
    bankerHand: [],
    result: null,
    road: [],
    shoe: newShoe(rng),
    shoeLeft: SHOE_SIZE,
    dealAt: null,
    stepAt: null,
    settleAt: null,
    round: 0,
    seq: 0,
  };
}

export function addBacPlayer(s: BacState, p: { id: string; name: string }): BacState {
  if (s.players.length >= MAX_BAC_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const player: BacPlayer = {
    id: p.id,
    name: p.name,
    connected: true,
    seat: null,
    chips: START_CHIPS,
    bets: emptyBets(),
    lastBets: null,
    ready: false,
    result: null,
  };
  return { ...s, players: [...s.players, player], seq: s.seq + 1 };
}

export function setBacConnected(s: BacState, id: string, connected: boolean): BacState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  return { ...patch(s, id, (x) => ({ ...x, connected })), seq: s.seq + 1 };
}

// Who draws next under the punto banco tableau; null once the coup is complete.
function nextSide(pl: readonly BacCard[], bk: readonly BacCard[]): "player" | "banker" | null {
  if (pl.length < 2 || bk.length < 2) return pl.length <= bk.length ? "player" : "banker";
  const p = handTotal(pl);
  const b = handTotal(bk);
  if (pl.length === 2 && bk.length === 2) {
    if (p >= 8 || b >= 8) return null;
    if (p <= 5) return "player";
    return b <= 5 ? "banker" : null;
  }
  const third = pl[2];
  if (bk.length !== 2 || !third) return null; // banker has already had his say
  const x = cardValue(third);
  const draws =
    b <= 2 || (b === 3 && x !== 8) || (b === 4 && x >= 2 && x <= 7) || (b === 5 && x >= 4 && x <= 7) || (b === 6 && (x === 6 || x === 7));
  return draws ? "banker" : null;
}

function draw(s: BacState, rng: Rng): { card: BacCard; shoe: BacCard[] } {
  const shoe = s.shoe.length > 0 ? s.shoe : newShoe(rng);
  const [card, ...rest] = shoe;
  if (!card) throw new Error("empty shoe");
  return { card, shoe: rest };
}

function roundOf(pl: BacCard[], bk: BacCard[]): BacRound {
  const playerTotal = handTotal(pl);
  const bankerTotal = handTotal(bk);
  const pair = (h: BacCard[]) => h[0] !== undefined && h[0].rank === h[1]?.rank;
  return {
    winner: playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie",
    playerTotal,
    bankerTotal,
    playerPair: pair(pl),
    bankerPair: pair(bk),
    natural: pl.length === 2 && bk.length === 2 && (playerTotal >= 8 || bankerTotal >= 8),
  };
}

// Net per spot: lost = -bet, push = 0, win = profit. Banker pays 0.95:1 (integer chips, floored).
function spotNets(bets: BacBets, r: BacRound): BacBets {
  const lose = (n: number) => 0 - n; // not -n: keeps an unplaced spot at 0 rather than -0
  const side = (spot: "player" | "banker", profit: number) => (r.winner === "tie" ? 0 : r.winner === spot ? profit : lose(bets[spot]));
  return {
    player: side("player", bets.player),
    banker: side("banker", Math.floor((bets.banker * 19) / 20)),
    tie: r.winner === "tie" ? bets.tie * TIE_PAYOUT : lose(bets.tie),
    playerPair: r.playerPair ? bets.playerPair * PAIR_PAYOUT : lose(bets.playerPair),
    bankerPair: r.bankerPair ? bets.bankerPair * PAIR_PAYOUT : lose(bets.bankerPair),
  };
}

function settle(s: BacState, now: number): BacState {
  const result = roundOf(s.playerHand, s.bankerHand);
  const players = s.players.map((p) => {
    const stake = totalBet(p.bets);
    if (stake === 0) return p;
    const spots = spotNets(p.bets, result);
    const net = totalBet(spots);
    return { ...p, chips: p.chips + stake + net, result: { net, spots } };
  });
  return { ...s, players, result, road: [...s.road, result].slice(-ROAD_LENGTH), phase: "settle", stepAt: null, settleAt: now + SETTLE_MS };
}

function deal(s: BacState, now: number, rng: Rng): BacState {
  const bettors = s.players.filter((p) => p.seat !== null && totalBet(p.bets) >= MIN_BET && totalBet(p.bets) <= p.chips);
  if (bettors.length === 0) return { ...s, dealAt: null };
  return {
    ...s,
    shoe: s.shoe.length < CUT_AT ? newShoe(rng) : s.shoe,
    playerHand: [],
    bankerHand: [],
    dealAt: null,
    round: s.round + 1,
    phase: "dealing",
    stepAt: now + DEAL_LEAD_MS,
    players: s.players.map((p) =>
      bettors.includes(p) ? { ...p, chips: p.chips - totalBet(p.bets), lastBets: p.bets, ready: false } : { ...p, bets: emptyBets(), ready: false },
    ),
  };
}

// Turns one card; the pause before the next step (or the settle) is the card's read time.
function step(s: BacState, now: number, rng: Rng): BacState {
  const side = nextSide(s.playerHand, s.bankerHand);
  if (!side) return settle(s, now);
  const d = draw(s, rng);
  const next = side === "player" ? { ...s, playerHand: [...s.playerHand, d.card], shoe: d.shoe } : { ...s, bankerHand: [...s.bankerHand, d.card], shoe: d.shoe };
  const third = next.playerHand.length + next.bankerHand.length > 4;
  return { ...next, stepAt: now + (third ? THIRD_CARD_MS : CARD_MS) };
}

// Deal as soon as every seated bettor tapped Deal; the first bet starts the clock for the rest.
function syncBetting(s: BacState, now: number, rng: Rng): BacState {
  const bettors = s.players.filter((p) => p.seat !== null && totalBet(p.bets) > 0);
  if (bettors.length === 0) return { ...s, dealAt: null };
  if (bettors.every((p) => p.ready)) return deal(s, now, rng);
  return { ...s, dealAt: s.dealAt ?? now + BET_MS };
}

function resetTable(s: BacState): BacState {
  const players = s.players.map((p) => ({ ...p, bets: emptyBets(), ready: false, result: null }));
  return { ...s, phase: "betting", players, playerHand: [], bankerHand: [], result: null, stepAt: null, settleAt: null, dealAt: null };
}

// Stakes already on a live coup are forfeit; in betting they were never taken from the bankroll.
export function removeBacPlayer(s: BacState, id: string, opts: { now: number; rng?: Rng }): BacState {
  if (!s.players.some((p) => p.id === id)) return s;
  const next: BacState = { ...s, players: s.players.filter((p) => p.id !== id), seq: s.seq + 1 };
  return s.phase === "betting" ? syncBetting(next, opts.now, opts.rng ?? cryptoRng) : next;
}

export function applyBacIntent(s: BacState, actorId: string, intent: BacIntent, opts: { isHost: boolean; now: number; rng?: Rng }): BacResult {
  const me = s.players.find((p) => p.id === actorId);
  if (!me) return { ok: false, error: "You are not at this table" };
  const rng = opts.rng ?? cryptoRng;
  const { now } = opts;
  const done = (state: BacState): BacResult => ({ ok: true, state: bump(state, s) });
  const fail = (error: string): BacResult => ({ ok: false, error });
  const betting = (state: BacState): BacResult => done(syncBetting(state, now, rng));
  const live = s.phase !== "betting" && totalBet(me.bets) > 0;

  switch (intent.type) {
    case "sit": {
      const { seat } = intent;
      if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) return fail("No such seat");
      if (live) return fail("Finish your coup first");
      if (s.players.some((p) => p.seat === seat)) return fail("Seat taken");
      const next = patch(s, actorId, (p) => ({ ...p, seat, ready: false }));
      return s.phase === "betting" ? betting(next) : done(next);
    }
    case "standUp": {
      if (me.seat === null) return fail("You're not seated");
      if (live) return fail("Finish your coup first");
      const next = patch(s, actorId, (p) => ({ ...p, seat: null, bets: emptyBets(), ready: false }));
      return s.phase === "betting" ? betting(next) : done(next);
    }
    case "bet": {
      const { spot, amount } = intent;
      if (s.phase !== "betting") return fail("Bets are closed");
      if (me.seat === null) return fail("Take a seat first");
      if (!BAC_SPOTS.includes(spot)) return fail("No such bet");
      if (!Number.isInteger(amount) || amount < 0) return fail("Invalid amount");
      if (amount > 0 && amount < MIN_BET) return fail(`Minimum bet is ${MIN_BET}`);
      if (amount > MAX_BET) return fail(`Maximum bet is ${MAX_BET}`);
      const bets = { ...me.bets, [spot]: amount };
      if (totalBet(bets) > me.chips) return fail("Not enough chips");
      return betting(patch(s, actorId, (p) => ({ ...p, bets, ready: false })));
    }
    case "clearBets":
      if (s.phase !== "betting") return fail("Bets are closed");
      return betting(patch(s, actorId, (p) => ({ ...p, bets: emptyBets(), ready: false })));
    case "rebet": {
      if (s.phase !== "betting") return fail("Bets are closed");
      if (me.seat === null) return fail("Take a seat first");
      if (!me.lastBets) return fail("No previous bet");
      if (totalBet(me.lastBets) > me.chips) return fail("Not enough chips");
      const bets = me.lastBets;
      return betting(patch(s, actorId, (p) => ({ ...p, bets, ready: false })));
    }
    case "deal":
      if (s.phase !== "betting") return fail("Coup in progress");
      if (me.seat === null) return fail("Take a seat first");
      if (totalBet(me.bets) < MIN_BET) return fail("Place a bet first");
      return betting(patch(s, actorId, (p) => ({ ...p, ready: true })));
    case "rebuy":
      if (s.phase !== "betting") return fail("Wait for the coup to finish");
      if (me.chips >= MIN_BET) return fail("You still have chips");
      return done(patch(s, actorId, (p) => ({ ...p, chips: START_CHIPS, bets: emptyBets(), ready: false })));
  }
  return fail("Unknown action");
}

export function serverDeadline(s: BacState): number | null {
  if (s.phase === "betting") return s.dealAt;
  if (s.phase === "dealing") return s.stepAt;
  return s.settleAt;
}

// No countdown while cards are turning.
export const visibleDeadline = (s: BacState): number | null => (s.phase === "dealing" ? null : serverDeadline(s));

export function onDeadline(s: BacState, now: number, rng: Rng = cryptoRng): BacState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "betting") return bump(deal(s, now, rng), s);
  if (s.phase === "dealing") return bump(step(s, now, rng), s);
  return bump(resetTable(s), s);
}

export function redactBac(s: BacState): BacState {
  return { ...s, shoe: [], shoeLeft: s.shoe.length };
}
