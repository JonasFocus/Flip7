import { cryptoRng } from "../blackjack/rules.ts";
import { buildPots, evaluate } from "./eval.ts";
import type { Rank, Suit, TxActions, TxCard, TxIntent, TxPhase, TxPlayer, TxState } from "./types.ts";

export const SEATS = 8;
export const MAX_TX_PLAYERS = 12; // 8 seats plus rail watchers
export const START_CHIPS = 2000; // 100 big blinds
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const TURN_MS = 25_000; // then the server checks, or folds if there is a bet to face
export const START_MS = 3000; // two funded players are seated: the next hand is dealt after this beat
export const SHOWDOWN_MS = 7000; // results and the winning hand stay up before the table resets
export const FOLD_WIN_MS = 3500; // everyone folded: a shorter beat, no hands to read
export const REVEAL_MS = 1800; // all-in called: a beat with the hands face up before the next street
export const RUNOUT_MS = 2200; // between streets of an all-in runout
export const DEAL_STAGGER_MS = 200; // client deal animation: gap between cards going round the table
export const CARD_SLIDE_MS = 550; // client deal animation: one card's trip from the deck

// Two passes round the table; the first turn's clock starts once the last card lands.
export const dealAnimMs = (hands: number): number => (2 * hands - 1) * DEAL_STAGGER_MS + CARD_SLIDE_MS;
export const streetAnimMs = (cards: number): number => (cards - 1) * DEAL_STAGGER_MS + CARD_SLIDE_MS;

type Rng = () => number;
export type TxResult = { ok: true; state: TxState } | { ok: false; error: string };

const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: readonly Suit[] = ["s", "h", "d", "c"];

export function newDeck(rng: Rng): TxCard[] {
  const deck: TxCard[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a && b) [deck[i], deck[j]] = [b, a];
  }
  return deck;
}

const seatOf = (p: TxPlayer): number => p.seat ?? -1;
const bySeat = (a: TxPlayer, b: TxPlayer) => seatOf(a) - seatOf(b);
const isLive = (p: TxPlayer): boolean => p.cards.length > 0 && !p.folded;
const canAct = (p: TxPlayer): boolean => isLive(p) && !p.allIn;
const isDealable = (p: TxPlayer): boolean => p.seat !== null && !p.sitOut && !p.gone && p.chips > 0;
const isStreet = (phase: TxPhase): boolean => phase === "preflop" || phase === "flop" || phase === "turn" || phase === "river";
const holeOf = (p: TxPlayer): TxCard[] => p.cards.filter((c): c is TxCard => c !== null);

const seal = (s: TxState, prev: TxState): TxState => ({ ...s, pot: s.players.reduce((n, p) => n + p.total, 0), seq: prev.seq + 1 });
const patch = (s: TxState, id: string, fn: (p: TxPlayer) => TxPlayer): TxState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? fn(p) : p)),
});

// Table order starting just after `seat`, wrapping round to include it last.
function after(players: TxPlayer[], seat: number): TxPlayer[] {
  const sorted = [...players].sort(bySeat);
  return [...sorted.filter((p) => seatOf(p) > seat), ...sorted.filter((p) => seatOf(p) <= seat)];
}

function commit(p: TxPlayer, amount: number): TxPlayer {
  const pay = Math.min(amount, p.chips);
  return { ...p, chips: p.chips - pay, bet: p.bet + pay, total: p.total + pay, allIn: p.chips - pay === 0 };
}

export function createTxGame(): TxState {
  return {
    phase: "lobby",
    players: [],
    board: [],
    deck: [],
    pot: 0,
    button: null,
    sbId: null,
    bbId: null,
    currentBet: 0,
    minRaise: BIG_BLIND,
    turnId: null,
    turnAt: null,
    startAt: null,
    dealAt: null,
    settleAt: null,
    runout: false,
    round: 0,
    seq: 0,
  };
}

// The next hand starts once two funded players are seated; the clock is set once and survives further joins.
function syncLobby(s: TxState, now: number): TxState {
  if (s.phase !== "lobby") return s;
  if (s.players.filter(isDealable).length < 2) return { ...s, startAt: null };
  return { ...s, startAt: s.startAt ?? now + START_MS };
}

export function addTxPlayer(s: TxState, p: { id: string; name: string }): TxState {
  if (s.players.length >= MAX_TX_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const player: TxPlayer = {
    id: p.id,
    name: p.name,
    connected: true,
    seat: null,
    chips: START_CHIPS,
    bet: 0,
    total: 0,
    cards: [],
    folded: false,
    allIn: false,
    acted: false,
    sitOut: false,
    gone: false,
    shown: false,
    result: null,
  };
  return { ...s, players: [...s.players, player], seq: s.seq + 1 };
}

export function setTxConnected(s: TxState, id: string, connected: boolean, now: number): TxState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  return seal(syncLobby(patch(s, id, (x) => ({ ...x, connected, sitOut: !connected })), now), s);
}

function startHand(s: TxState, now: number, rng: Rng): TxState {
  const pool = s.players.filter(isDealable);
  const btn = after(pool, s.button ?? -1)[0];
  if (pool.length < 2 || !btn) return { ...s, startAt: null };
  const rest = after(pool, seatOf(btn)).filter((p) => p.id !== btn.id);
  const order = [btn, ...rest];
  const headsUp = order.length === 2;
  const sb = headsUp ? btn : order[1];
  const bb = headsUp ? order[1] : order[2];
  if (!sb || !bb) return { ...s, startAt: null };

  const deck = newDeck(rng);
  const hole = new Map<string, TxCard[]>(pool.map((p) => [p.id, []]));
  for (let pass = 0; pass < 2; pass++) {
    for (const p of [...rest, btn]) {
      const card = deck.shift();
      if (card) hole.get(p.id)?.push(card);
    }
  }
  const players = s.players.map((p) => {
    const fresh: TxPlayer = { ...p, bet: 0, total: 0, cards: hole.get(p.id) ?? [], folded: false, allIn: false, acted: false, shown: false, result: null };
    if (p.id === sb.id) return commit(fresh, SMALL_BLIND);
    if (p.id === bb.id) return commit(fresh, BIG_BLIND);
    return fresh;
  });
  const dealt: TxState = {
    ...s,
    phase: "preflop",
    players,
    board: [],
    deck,
    button: seatOf(btn),
    sbId: sb.id,
    bbId: bb.id,
    currentBet: BIG_BLIND,
    minRaise: BIG_BLIND,
    turnId: null,
    turnAt: null,
    startAt: null,
    dealAt: null,
    settleAt: null,
    runout: false,
    round: s.round + 1,
  };
  return proceed(dealt, seatOf(bb), now + dealAnimMs(order.length), rng);
}

const phaseOf = (boardLen: number): TxPhase => (boardLen === 0 ? "preflop" : boardLen === 3 ? "flop" : boardLen === 4 ? "turn" : "river");

function dealStreet(s: TxState): { state: TxState; cards: number } {
  const cards = s.board.length === 0 ? 3 : 1;
  const board = [...s.board, ...s.deck.slice(0, cards)];
  return { state: { ...s, board, deck: s.deck.slice(cards), phase: phaseOf(board.length) }, cards };
}

// Hands the turn to the next player who still owes an action, else closes the street.
function proceed(s: TxState, fromSeat: number, now: number, rng: Rng): TxState {
  const live = s.players.filter(isLive);
  if (live.length === 1) return awardUncontested(s, now);
  const actors = live.filter((p) => !p.allIn);
  const owes = (p: TxPlayer) => !p.allIn && (p.bet < s.currentBet || (!p.acted && actors.length > 1));
  const next = after(live, fromSeat).find(owes);
  if (next) return { ...s, turnId: next.id, turnAt: now };
  return closeStreet(s, now, rng);
}

function closeStreet(s: TxState, now: number, rng: Rng): TxState {
  const base: TxState = {
    ...s,
    players: s.players.map((p) => ({ ...p, bet: 0, acted: false })),
    currentBet: 0,
    minRaise: BIG_BLIND,
    turnId: null,
    turnAt: null,
  };
  if (s.board.length === 5) return showdown(base, now);
  if (base.players.filter(canAct).length <= 1) return { ...base, runout: true, dealAt: now + REVEAL_MS };
  const { state, cards } = dealStreet(base);
  return proceed(state, state.button ?? -1, now + streetAnimMs(cards), rng);
}

function runoutStep(s: TxState, now: number): TxState {
  if (s.board.length === 5) return showdown({ ...s, dealAt: null }, now);
  return { ...dealStreet(s).state, dealAt: now + RUNOUT_MS };
}

function awardUncontested(s: TxState, now: number): TxState {
  const pot = s.players.reduce((n, p) => n + p.total, 0);
  const players = s.players.map((p) => {
    if (p.cards.length === 0) return p;
    const won = isLive(p) ? pot : 0;
    return { ...p, bet: 0, chips: p.chips + won, result: { won, net: won - p.total, hand: null, best: [] } };
  });
  return { ...s, players, phase: "showdown", turnId: null, turnAt: null, dealAt: null, runout: false, settleAt: now + FOLD_WIN_MS };
}

function showdown(s: TxState, now: number): TxState {
  const live = s.players.filter(isLive);
  const hands = new Map(live.map((p) => [p.id, evaluate([...holeOf(p), ...s.board])]));
  const won = new Map<string, number>();
  const pots = buildPots(s.players.filter((p) => p.total > 0).map((p) => ({ id: p.id, total: p.total, folded: !isLive(p) })));
  for (const pot of pots) {
    const contenders = live.filter((p) => pot.eligible.includes(p.id));
    const top = Math.max(...contenders.map((p) => hands.get(p.id)?.value ?? 0));
    const winners = after(
      contenders.filter((p) => hands.get(p.id)?.value === top),
      s.button ?? -1,
    );
    if (winners.length === 0) continue;
    const share = Math.floor(pot.amount / winners.length);
    const odd = pot.amount - share * winners.length; // odd chips go one each from the seat left of the button
    winners.forEach((w, i) => won.set(w.id, (won.get(w.id) ?? 0) + share + (i < odd ? 1 : 0)));
  }
  const players = s.players.map((p) => {
    if (p.cards.length === 0) return p;
    const take = won.get(p.id) ?? 0;
    const hand = hands.get(p.id);
    return { ...p, chips: p.chips + take, result: { won: take, net: take - p.total, hand: hand?.name ?? null, best: hand?.best ?? [] } };
  });
  return { ...s, players, phase: "showdown", turnId: null, turnAt: null, dealAt: null, runout: false, settleAt: now + SHOWDOWN_MS };
}

function resetTable(s: TxState, now: number): TxState {
  const players = s.players
    .filter((p) => !p.gone)
    .map((p) => ({ ...p, bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, shown: false, result: null }));
  return syncLobby(
    { ...s, phase: "lobby", players, board: [], deck: [], currentBet: 0, minRaise: BIG_BLIND, turnId: null, turnAt: null, dealAt: null, settleAt: null, sbId: null, bbId: null, runout: false, startAt: null },
    now,
  );
}

// After someone other than the current actor folds or leaves: end the hand if one player is left, or move on if the actor no longer owes anything.
function resume(s: TxState, now: number, rng: Rng): TxState {
  const live = s.players.filter(isLive);
  if (live.length === 1) return awardUncontested(s, now);
  const actor = s.players.find((p) => p.id === s.turnId);
  if (!actor || s.runout) return s;
  const actors = live.filter((p) => !p.allIn);
  const owes = actor.bet < s.currentBet || (!actor.acted && actors.length > 1);
  return owes ? s : proceed(s, seatOf(actor), now, rng);
}

export function legalActions(s: TxState, id: string): TxActions | null {
  const p = s.players.find((x) => x.id === id);
  if (!p || s.turnId !== id || !isStreet(s.phase) || s.runout) return null;
  const maxRaiseTo = p.bet + p.chips;
  const canRaise = !p.acted && maxRaiseTo > s.currentBet && s.players.some((o) => o.id !== id && canAct(o));
  return {
    canCheck: p.bet >= s.currentBet,
    callAmount: Math.max(0, Math.min(s.currentBet - p.bet, p.chips)),
    canRaise,
    minRaiseTo: Math.min(s.currentBet + s.minRaise, maxRaiseTo),
    maxRaiseTo,
  };
}

export function removeTxPlayer(s: TxState, id: string, opts: { now: number; rng?: Rng }): TxState {
  const me = s.players.find((p) => p.id === id);
  if (!me) return s;
  const rng = opts.rng ?? cryptoRng;
  if (me.cards.length === 0) return syncLobby({ ...s, players: s.players.filter((p) => p.id !== id), seq: s.seq + 1 }, opts.now);
  // Their chips stay in the pot, so the seat lingers (folded) until the hand ends.
  const folded = patch(s, id, (p) => ({ ...p, folded: true, gone: true, connected: false, sitOut: true }));
  if (s.phase === "showdown") return { ...folded, seq: s.seq + 1 };
  if (s.turnId === id) return seal(proceed(folded, seatOf(me), opts.now, rng), s);
  return seal(resume(folded, opts.now, rng), s);
}

export function applyTxIntent(s: TxState, actorId: string, intent: TxIntent, opts: { isHost: boolean; now: number; rng?: Rng }): TxResult {
  const me = s.players.find((p) => p.id === actorId);
  if (!me) return { ok: false, error: "You are not at this table" };
  const rng = opts.rng ?? cryptoRng;
  const { now } = opts;
  const done = (state: TxState): TxResult => ({ ok: true, state: seal(state, s) });
  const fail = (error: string): TxResult => ({ ok: false, error });
  const lobby = (state: TxState): TxResult => done(syncLobby(state, now));
  const inHand = me.cards.length > 0;

  switch (intent.type) {
    case "sit": {
      const { seat } = intent;
      if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) return fail("No such seat");
      if (inHand) return fail("Finish your hand first");
      if (s.players.some((p) => p.seat === seat && p.id !== actorId)) return fail("Seat taken");
      return lobby(patch(s, actorId, (p) => ({ ...p, seat, sitOut: false })));
    }
    case "standUp":
      if (me.seat === null) return fail("You're not seated");
      if (isLive(me)) return fail("Finish your hand first");
      return lobby(patch(s, actorId, (p) => ({ ...p, seat: null })));
    case "sitOut":
      return lobby(patch(s, actorId, (p) => ({ ...p, sitOut: true })));
    case "sitIn":
      if (me.seat === null) return fail("Take a seat first");
      return lobby(patch(s, actorId, (p) => ({ ...p, sitOut: false })));
    case "rebuy":
      if (inHand) return fail("Wait for the hand to finish");
      if (me.chips >= BIG_BLIND) return fail("You still have chips");
      return lobby(patch(s, actorId, (p) => ({ ...p, chips: START_CHIPS })));
    case "show":
      if (s.phase !== "showdown" || !isLive(me)) return fail("Nothing to show");
      return done(patch(s, actorId, (p) => ({ ...p, shown: true })));
    case "fold":
    case "check":
    case "call":
    case "bet":
    case "allIn":
      break;
    default:
      return fail("Unknown action");
  }

  if (!isStreet(s.phase) || s.runout) return fail("No hand in play");
  if (s.turnId !== actorId) return fail("It's not your turn");
  const legal = legalActions(s, actorId);
  if (!legal) return fail("It's not your turn");

  if (intent.type === "fold") return done(proceed(patch(s, actorId, (p) => ({ ...p, folded: true })), seatOf(me), now, rng));
  if (intent.type === "check") {
    if (!legal.canCheck) return fail("You must call or fold");
    return done(proceed(patch(s, actorId, (p) => ({ ...p, acted: true })), seatOf(me), now, rng));
  }
  const call = (): TxResult => done(proceed(patch(s, actorId, (p) => ({ ...commit(p, s.currentBet - p.bet), acted: true })), seatOf(me), now, rng));
  if (intent.type === "call") return legal.canCheck ? fail("Nothing to call") : call();

  const target = intent.type === "allIn" ? legal.maxRaiseTo : intent.amount;
  if (intent.type === "allIn" && (!legal.canRaise || target <= s.currentBet)) return legal.canCheck ? fail("Nothing to call") : call();
  if (!legal.canRaise) return fail("You can't raise here");
  if (!Number.isInteger(target) || target > legal.maxRaiseTo) return fail("Not enough chips");
  if (target <= s.currentBet) return fail("Raise must top the current bet");
  if (target < legal.minRaiseTo) return fail(`Minimum raise is to ${legal.minRaiseTo}`);

  const size = target - s.currentBet;
  const full = size >= s.minRaise; // a short all-in does not reopen the betting for players who already acted
  const players = s.players.map((p) => {
    if (p.id === actorId) return { ...commit(p, target - p.bet), acted: true };
    return full && canAct(p) ? { ...p, acted: false } : p;
  });
  return done(proceed({ ...s, players, currentBet: target, minRaise: full ? size : s.minRaise }, seatOf(me), now, rng));
}

export function serverDeadline(s: TxState): number | null {
  if (s.phase === "lobby") return s.startAt;
  if (s.phase === "showdown") return s.settleAt;
  if (s.runout) return s.dealAt;
  return s.turnAt === null ? null : s.turnAt + TURN_MS;
}

export const visibleDeadline = serverDeadline;

export function onDeadline(s: TxState, now: number, rng: Rng = cryptoRng): TxState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "lobby") return seal(startHand(s, now, rng), s);
  if (s.phase === "showdown") return seal(resetTable(s, now), s);
  if (s.runout) return seal(runoutStep(s, now), s);
  const actor = s.players.find((p) => p.id === s.turnId);
  if (!actor) return s;
  const timedOut = patch(s, actor.id, (p) => ({ ...p, sitOut: true }));
  if (actor.bet >= s.currentBet) return seal(proceed(patch(timedOut, actor.id, (p) => ({ ...p, acted: true })), seatOf(actor), now, rng), s);
  return seal(proceed(patch(timedOut, actor.id, (p) => ({ ...p, folded: true })), seatOf(actor), now, rng), s);
}

// Your own cards always show; everyone else's stay face down until they are shown down (or run out all-in).
export function redactTx(s: TxState, viewerId: string): TxState {
  const contested = s.players.filter(isLive).length > 1;
  const revealed = s.runout || (s.phase === "showdown" && contested);
  const players = s.players.map((p) => {
    const visible = p.id === viewerId || (isLive(p) && (revealed || p.shown));
    return visible ? p : { ...p, cards: p.cards.map(() => null) };
  });
  return { ...s, players, deck: [] };
}
