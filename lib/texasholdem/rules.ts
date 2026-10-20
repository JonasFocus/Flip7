import { cryptoRng } from "../blackjack/rules.ts";
import { buildPots, evaluate } from "./eval.ts";
import type { Rank, Suit, TxActions, TxCard, TxHandResult, TxIntent, TxPhase, TxPlayer, TxState } from "./types.ts";

export const SEATS = 8;
export const MAX_TX_PLAYERS = 12; // 8 seats plus rail watchers
export const MAX_TX_BOTS = 7; // a table always keeps a seat for a human
export const START_CHIPS = 2000; // 100 big blinds
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const TURN_MS = 25_000; // then the server checks, or folds if there is a bet to face
export const AWAY_TURN_MS = 2000; // an offline or sitting-out actor gets this short clock instead of TURN_MS
export const START_MS = 3000; // two funded players are seated: the next hand is dealt after this beat
export const AFTER_HAND_MS = 1200; // the table is cleared and everyone seated still has chips: the next hand follows after this shorter beat
export const SHOWDOWN_MS = 5000; // results and the winning hand stay up before the table resets
export const FOLD_WIN_MS = 3500; // everyone folded: a shorter beat, no hands to read
export const REVEAL_MS = 1800; // all-in called: a beat with the hands face up before the next street
export const RUNOUT_MS = 1500; // between streets of an all-in runout
export const RUN_TWICE_ASK_MS = 5000; // everyone in the pot gets this long to agree to run it twice
export const RUN_TWICE_BEAT_MS = 1200; // everyone agreed: a beat before the first board runs out
export const DEAL_STAGGER_MS = 200; // client deal animation: gap between cards going round the table
export const CARD_SLIDE_MS = 550; // client deal animation: one card's trip from the deck
export const REACTION_COOLDOWN_MS = 1500; // between emoji reactions from one player
export const DROP_GRACE_MS = 75_000; // a dropped player keeps their seat this long; after it they are cleared at the next hand boundary

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
const isDealable = (p: TxPlayer): boolean => p.seat !== null && p.connected && !p.sitOut && !p.gone && p.chips > 0;
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

// Human ids are hashes from publicId, so the "bot-" prefix the virtual bots use cannot clash.
export const isTxBotId = (id: string): boolean => id.startsWith("bot-");

// A player who leaves with chips keeps them for the id; only a bust (0 chips) earns a fresh stack. A removed bot never returns.
function keepStack(stacks: Record<string, number>, p: TxPlayer): Record<string, number> {
  return p.chips > 0 && !isTxBotId(p.id) ? { ...stacks, [p.id]: p.chips } : stacks;
}

export function createTxGame(): TxState {
  return {
    phase: "lobby",
    players: [],
    board: [],
    deck: [],
    stacks: {},
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
    runTwice: true,
    ask: null,
    second: null,
    round: 0,
    seq: 0,
  };
}

// The next hand starts once two funded players are seated; the clock is set once and survives further joins.
function syncLobby(s: TxState, now: number, delay = START_MS): TxState {
  if (s.phase !== "lobby") return s;
  if (s.players.filter(isDealable).length < 2) return { ...s, startAt: null };
  return { ...s, startAt: s.startAt ?? now + delay };
}

export function addTxPlayer(s: TxState, p: { id: string; name: string }): TxState {
  if (s.players.length >= MAX_TX_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const { [p.id]: kept, ...stacks } = s.stacks;
  const player: TxPlayer = {
    id: p.id,
    name: p.name,
    connected: true,
    droppedAt: null,
    seat: null,
    chips: kept ?? START_CHIPS,
    bet: 0,
    total: 0,
    cards: [],
    folded: false,
    allIn: false,
    acted: false,
    sitOut: false,
    timedOut: false,
    gone: false,
    shown: false,
    result: null,
    reaction: null,
  };
  return { ...s, players: [...s.players, player], stacks, seq: s.seq + 1 };
}

// A player offline past the grace period who is not in a hand (no chips in the pot).
const isStale = (p: TxPlayer, now: number): boolean => !p.connected && p.droppedAt !== null && now - p.droppedAt >= DROP_GRACE_MS;

function pruneDropped(s: TxState, now: number): TxState {
  const keep = (p: TxPlayer) => p.cards.length > 0 || !isStale(p, now);
  return s.players.every(keep) ? s : { ...s, players: s.players.filter(keep) };
}

export function setTxConnected(s: TxState, id: string, connected: boolean, now: number): TxState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  // Rejoining cancels a mid-hand leave: still folded this hand, but kept at the table.
  const next = patch(s, id, (x) => ({ ...x, connected, droppedAt: connected ? null : now, gone: connected ? false : x.gone }));
  return seal(syncLobby(pruneDropped(next, now), now), s);
}

function startHand(table: TxState, now: number, rng: Rng): TxState {
  const s = pruneDropped(table, now);
  const pool = s.players.filter(isDealable);
  // Heads-up after a bust: last hand's big blind takes the button and small blind, so nobody posts the big blind twice.
  const prevBb = pool.length === 2 ? pool.find((p) => p.id === s.bbId) : undefined;
  const btn = prevBb ?? after(pool, s.button ?? -1)[0];
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
  // Heads-up, a short big blind can post less than the small blind. Nobody owes more than the largest posted blind.
  const posted = headsUp ? Math.max(...players.map((p) => p.bet)) : BIG_BLIND;
  const dealt: TxState = {
    ...s,
    phase: "preflop",
    players,
    board: [],
    deck,
    button: seatOf(btn),
    sbId: sb.id,
    bbId: bb.id,
    currentBet: posted,
    minRaise: BIG_BLIND,
    turnId: null,
    turnAt: null,
    startAt: null,
    dealAt: null,
    settleAt: null,
    runout: false,
    ask: null,
    second: null,
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
  if (base.players.filter(canAct).length <= 1) return startRunout(base, now);
  const { state, cards } = dealStreet(base);
  return proceed(state, state.button ?? -1, now + streetAnimMs(cards), rng);
}

// Bots have no opinion and always agree. Nobody is asked when a human is offline: they cannot answer, so the board runs once.
function startRunout(s: TxState, now: number): TxState {
  const voters = s.players.filter((p) => isLive(p) && !isTxBotId(p.id));
  if (!s.runTwice || voters.length === 0 || !voters.every((p) => p.connected)) return { ...s, runout: true, dealAt: now + REVEAL_MS };
  return { ...s, runout: true, ask: { ids: voters.map((p) => p.id), yes: [] }, dealAt: now + RUN_TWICE_ASK_MS };
}

// Anyone who left the hand since the question was asked no longer has a say.
const allAgreed = (s: TxState): boolean => !!s.ask && s.ask.ids.every((id) => s.ask?.yes.includes(id) || !s.players.some((p) => p.id === id && isLive(p)));

function settleAsk(s: TxState, twice: boolean, now: number): TxState {
  if (!twice) return runoutStep({ ...s, ask: null }, now);
  return { ...s, ask: null, second: s.board, dealAt: now + RUN_TWICE_BEAT_MS };
}

// Deals the next street of the first board, then of the second when running it twice, then pays out.
function runoutStep(s: TxState, now: number): TxState {
  if (s.board.length < 5) return { ...dealStreet(s).state, dealAt: now + RUNOUT_MS };
  if (s.second && s.second.length < 5) {
    const cards = s.second.length === 0 ? 3 : 1;
    return { ...s, second: [...s.second, ...s.deck.slice(0, cards)], deck: s.deck.slice(cards), dealAt: now + RUNOUT_MS };
  }
  return showdown({ ...s, dealAt: null }, now);
}

function awardUncontested(s: TxState, now: number): TxState {
  const pot = s.players.reduce((n, p) => n + p.total, 0);
  const players = s.players.map((p) => {
    if (p.cards.length === 0) return p;
    const won = isLive(p) ? pot : 0;
    return { ...p, bet: 0, chips: p.chips + won, result: { won, net: won - p.total, hand: null, best: [] } };
  });
  return { ...s, players, phase: "showdown", turnId: null, turnAt: null, dealAt: null, runout: false, ask: null, second: null, settleAt: now + FOLD_WIN_MS };
}

function showdown(s: TxState, now: number): TxState {
  const live = s.players.filter(isLive);
  const rank = (board: TxCard[]) => new Map(live.map((p) => [p.id, evaluate([...holeOf(p), ...board])]));
  const hands = rank(s.board);
  const hands2 = s.second ? rank(s.second) : null;
  const runs = hands2 ? [hands, hands2] : [hands];
  const won = new Map<string, number>();
  const wonSecond = new Map<string, number>();
  const [top, next] = [...s.players].sort((a, b) => b.total - a.total);
  // A bet nobody matched goes back to its owner untouched; it is not a pot win.
  const refund = top && isLive(top) ? top.total - (next?.total ?? 0) : 0;
  const pots = buildPots(s.players.filter((p) => p.total > 0).map((p) => ({ id: p.id, total: p.id === top?.id ? top.total - refund : p.total, folded: !isLive(p) })));
  for (const pot of pots) {
    const contenders = live.filter((p) => pot.eligible.includes(p.id));
    // Running it twice splits every pot, side pots included, in half; the odd chip rides the first board.
    const halves = runs.length === 2 ? [Math.ceil(pot.amount / 2), Math.floor(pot.amount / 2)] : [pot.amount];
    runs.forEach((ranked, run) => {
      const top = Math.max(...contenders.map((p) => ranked.get(p.id)?.value ?? 0));
      const winners = after(
        contenders.filter((p) => ranked.get(p.id)?.value === top),
        s.button ?? -1,
      );
      const amount = halves[run] ?? 0;
      if (winners.length === 0) return;
      const share = Math.floor(amount / winners.length);
      const odd = amount - share * winners.length; // odd chips go one each from the seat left of the button
      winners.forEach((w, i) => {
        const take = share + (i < odd ? 1 : 0);
        won.set(w.id, (won.get(w.id) ?? 0) + take);
        if (run === 1) wonSecond.set(w.id, (wonSecond.get(w.id) ?? 0) + take);
      });
    });
  }
  const players = s.players.map((p) => {
    if (p.cards.length === 0) return p;
    const take = won.get(p.id) ?? 0;
    const hand = hands.get(p.id);
    const back = p.id === top?.id ? refund : 0;
    const hand2 = hands2?.get(p.id);
    const result: TxHandResult = { won: take, net: take + back - p.total, hand: hand?.name ?? null, best: hand?.best ?? [] };
    if (hands2) result.second = { hand: hand2?.name ?? null, best: hand2?.best ?? [], won: wonSecond.get(p.id) ?? 0 };
    return { ...p, chips: p.chips + take + back, result };
  });
  return { ...s, players, phase: "showdown", turnId: null, turnAt: null, dealAt: null, runout: false, ask: null, settleAt: now + SHOWDOWN_MS };
}

function resetTable(s: TxState, now: number): TxState {
  const stacks = s.players.filter((p) => p.gone).reduce(keepStack, s.stacks);
  const players = s.players
    .filter((p) => !p.gone && !isStale(p, now))
    .map((p) => ({ ...p, bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, shown: false, result: null }));
  const brokeAtTable = players.some((p) => p.seat !== null && p.chips === 0); // keep the full beat so they can rebuy before the deal
  return syncLobby(
    { ...s, phase: "lobby", players, stacks, board: [], deck: [], currentBet: 0, minRaise: BIG_BLIND, turnId: null, turnAt: null, dealAt: null, settleAt: null, sbId: null, bbId: null, runout: false, ask: null, second: null, startAt: null },
    now,
    brokeAtTable ? START_MS : AFTER_HAND_MS,
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

// Rebuy and stand-up depend on whether the player holds cards in the current hand, not on the table phase.
export const canRebuyTx = (p: TxPlayer): boolean => p.cards.length === 0 && p.chips === 0;
export const canStandUpTx = (p: TxPlayer): boolean => p.seat !== null && !isLive(p);

// The host may remove someone between hands, or at any time once they are offline, sitting out or a bot.
export function canKickTx(s: TxState, id: string): boolean {
  const p = s.players.find((x) => x.id === id);
  if (!p) return false;
  if (s.phase === "lobby") return true;
  return !p.gone && (!p.connected || p.sitOut || isTxBotId(id));
}

export function removeTxPlayer(s: TxState, id: string, opts: { now: number; rng?: Rng }): TxState {
  const me = s.players.find((p) => p.id === id);
  if (!me) return s;
  const rng = opts.rng ?? cryptoRng;
  if (me.cards.length === 0) return syncLobby({ ...s, players: s.players.filter((p) => p.id !== id), stacks: keepStack(s.stacks, me), seq: s.seq + 1 }, opts.now);
  // Their chips stay in the pot, so the seat lingers (folded) until the hand ends.
  const folded = patch(s, id, (p) => ({ ...p, folded: true, gone: true, connected: false, droppedAt: p.droppedAt ?? opts.now }));
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
      return lobby(patch(s, actorId, (p) => ({ ...p, seat, sitOut: false, timedOut: false })));
    }
    case "standUp":
      if (me.seat === null) return fail("You're not seated");
      if (!canStandUpTx(me)) return fail("Finish your hand first");
      return lobby(patch(s, actorId, (p) => ({ ...p, seat: null, timedOut: false })));
    case "sitOut":
      return lobby(patch(s, actorId, (p) => ({ ...p, sitOut: true, timedOut: false })));
    case "sitIn":
      if (me.seat === null) return fail("Take a seat first");
      return lobby(patch(s, actorId, (p) => ({ ...p, sitOut: false, timedOut: false })));
    case "rebuy":
      if (inHand) return fail("Wait for the hand to finish");
      if (!canRebuyTx(me)) return fail("You still have chips");
      return lobby(patch(s, actorId, (p) => ({ ...p, chips: START_CHIPS })));
    case "react":
      if (me.seat === null) return fail("Take a seat first");
      if (me.reaction && now - me.reaction.at < REACTION_COOLDOWN_MS) return fail("Slow down");
      return done(patch(s, actorId, (p) => ({ ...p, reaction: { emoji: intent.emoji, at: now } })));
    case "show":
      if (s.phase !== "showdown" || !isLive(me)) return fail("Nothing to show");
      return done(patch(s, actorId, (p) => ({ ...p, shown: true })));
    case "setRunTwice":
      if (!opts.isHost) return fail("Only the host can change this");
      if (s.phase !== "lobby") return fail("Change this between hands");
      return done({ ...s, runTwice: intent.on });
    case "runTwice": {
      const { ask } = s;
      if (!ask || !s.runout) return fail("Nothing to vote on");
      if (!ask.ids.includes(actorId) || !isLive(me)) return fail("You're not in this pot");
      if (!intent.yes) return done(settleAsk(s, false, now));
      const agreed: TxState = { ...s, ask: { ...ask, yes: [...new Set([...ask.yes, actorId])] } };
      return done(allAgreed(agreed) ? settleAsk(agreed, true, now) : agreed);
    }
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

  const base = me.sitOut ? patch(s, actorId, (p) => ({ ...p, sitOut: false, timedOut: false })) : s; // acting is coming back
  if (intent.type === "fold") return done(proceed(patch(base, actorId, (p) => ({ ...p, folded: true })), seatOf(me), now, rng));
  if (intent.type === "check") {
    if (!legal.canCheck) return fail("You must call or fold");
    return done(proceed(patch(base, actorId, (p) => ({ ...p, acted: true })), seatOf(me), now, rng));
  }
  const call = (): TxResult => done(proceed(patch(base, actorId, (p) => ({ ...commit(p, s.currentBet - p.bet), acted: true })), seatOf(me), now, rng));
  if (intent.type === "call") return legal.canCheck ? fail("Nothing to call") : call();

  const target = intent.type === "allIn" ? legal.maxRaiseTo : intent.amount;
  if (intent.type === "allIn" && (!legal.canRaise || target <= s.currentBet)) return legal.canCheck ? fail("Nothing to call") : call();
  if (!legal.canRaise) return fail("You can't raise here");
  if (!Number.isInteger(target) || target > legal.maxRaiseTo) return fail("Not enough chips");
  if (target <= s.currentBet) return fail("Raise must top the current bet");
  if (target < legal.minRaiseTo) return fail(`Minimum raise is to ${legal.minRaiseTo}`);

  const size = target - s.currentBet;
  const full = size >= s.minRaise; // a short all-in does not reopen the betting for players who already acted
  const players = base.players.map((p) => {
    if (p.id === actorId) return { ...commit(p, target - p.bet), acted: true };
    return full && canAct(p) ? { ...p, acted: false } : p;
  });
  return done(proceed({ ...base, players, currentBet: target, minRaise: full ? size : s.minRaise }, seatOf(me), now, rng));
}

export function serverDeadline(s: TxState): number | null {
  if (s.phase === "lobby") {
    // An idle lobby still wakes up to clear players who stayed offline past the grace period.
    const expiries = s.players.flatMap((p) => (!p.connected && p.droppedAt !== null ? [p.droppedAt + DROP_GRACE_MS] : []));
    const due = [...expiries, ...(s.startAt === null ? [] : [s.startAt])];
    return due.length === 0 ? null : Math.min(...due);
  }
  if (s.phase === "showdown") return s.settleAt;
  if (s.runout) return s.dealAt;
  if (s.turnAt === null) return null;
  const actor = s.players.find((p) => p.id === s.turnId);
  if (!actor || (actor.connected && !actor.sitOut)) return s.turnAt + TURN_MS;
  return Math.max(s.turnAt, actor.droppedAt ?? 0) + AWAY_TURN_MS; // a socket that drops mid-turn gets the full short clock from the drop
}

// The clock players see: ghost cleanup in an idle lobby is not a countdown.
export const visibleDeadline = (s: TxState): number | null => (s.phase === "lobby" ? s.startAt : serverDeadline(s));

export function onDeadline(s: TxState, now: number, rng: Rng = cryptoRng): TxState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "lobby") {
    if (s.startAt === null || now < s.startAt) return seal(syncLobby(pruneDropped(s, now), now), s);
    return seal(startHand(s, now, rng), s);
  }
  if (s.phase === "showdown") return seal(resetTable(s, now), s);
  if (s.runout) return seal(s.ask ? settleAsk(s, allAgreed(s), now) : runoutStep(s, now), s);
  const actor = s.players.find((p) => p.id === s.turnId);
  if (!actor) return s;
  const timedOut = patch(s, actor.id, (p) => ({ ...p, sitOut: true, timedOut: true }));
  if (actor.bet >= s.currentBet) return seal(proceed(patch(timedOut, actor.id, (p) => ({ ...p, acted: true })), seatOf(actor), now, rng), s);
  return seal(proceed(patch(timedOut, actor.id, (p) => ({ ...p, folded: true })), seatOf(actor), now, rng), s);
}

// The player who just shoved, for the table's all-in moment. A blind posted all-in at the deal doesn't count.
export function wentAllIn(prev: TxState, next: TxState): TxPlayer | null {
  if (prev.round !== next.round) return null;
  return next.players.filter((p) => p.allIn && !p.folded && !prev.players.find((q) => q.id === p.id)?.allIn).at(-1) ?? null;
}

// Your own cards always show; everyone else's stay face down until they are shown down (or run out all-in).
export function redactTx(s: TxState, viewerId: string): TxState {
  const players = s.players.map((p) => {
    // A hand name is only set when the hand was actually ranked at a contested showdown. That stays true
    // after a player leaves (and so folds), which keeps the reveal on screen for the rest of the table.
    const shownDown = s.phase === "showdown" && p.result?.hand != null;
    const visible = p.id === viewerId || shownDown || (isLive(p) && (s.runout || p.shown));
    return visible ? p : { ...p, cards: p.cards.map(() => null) };
  });
  return { ...s, players, deck: [], stacks: {} };
}
