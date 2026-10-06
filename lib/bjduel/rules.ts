import { SHOE_SIZE, cryptoRng, handValue, isBlackjack, isBust, newShoe, outcomeOf, payout } from "../blackjack/rules.ts";
import type { BjCard, Denom, DuelIntent, DuelPlayer, DuelState } from "./types.ts";

export const MAX_DUEL_PLAYERS = 2;
export const DENOMS: readonly Denom[] = [1, 2, 5];
export const START_CHIPS = 100;
export const MIN_BET = 1;
export const MAX_BET = 25;
export const HANDS = 10; // a match: whoever holds more chips after this many hands wins
export const BET_MS = 15_000; // after the first lock-in, the other player has this long
export const TURN_MS = 20_000; // then the server stands for you
export const SETTLE_MS = 6500; // results, chips paid and swept, then the cards clear to the discard tray
export const HOLE_LEAD_MS = 900; // after the last player acts, a beat before the dealer turns the hole card
export const DEALER_CARD_MS = 1300; // per dealer draw, so each card lands before the next leaves the shoe
export const SHUFFLE_MS = 2800; // a fresh shoe is shuffled on the felt before the first card comes out
export const DEAL_STAGGER_MS = 380; // client deal animation: gap between cards going round the table
export const CARD_SLIDE_MS = 720; // client deal animation: one card's trip from the shoe
const RESHUFFLE_AT = SHOE_SIZE / 4; // cut card at 75% penetration

// The opening deal: two passes, first player, second player, dealer; the first turn's clock starts once it lands.
export const dealAnimMs = (hands: number): number => (2 * (hands + 1) - 1) * DEAL_STAGGER_MS + CARD_SLIDE_MS;

type Rng = () => number;
export type DuelResult = { ok: true; state: DuelState } | { ok: false; error: string };

export const betOf = (p: Pick<DuelPlayer, "stack">): number => p.stack.reduce((a, b) => a + b, 0);

const bump = (s: DuelState, prev: DuelState): DuelState => ({ ...s, seq: prev.seq + 1 });
const patch = (s: DuelState, id: string, fn: (p: DuelPlayer) => DuelPlayer): DuelState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? fn(p) : p)),
});
// Acting order this hand: firstSeat, then the other.
const turnOrder = (s: DuelState) => (p: DuelPlayer) => (p.seat - s.firstSeat + 2) % 2;
export const inHand = (s: DuelState): DuelPlayer[] =>
  s.players.filter((p) => p.cards.length > 0).sort((a, b) => turnOrder(s)(a) - turnOrder(s)(b));
const real = (cards: (BjCard | null)[]): BjCard[] => cards.filter((c): c is BjCard => c !== null);

const fresh = (p: DuelPlayer): DuelPlayer => ({ ...p, stack: [], ready: false, cards: [], done: false, doubled: false, result: null, rematch: false });

export function createDuelGame(rng: Rng = cryptoRng): DuelState {
  return {
    phase: "lobby",
    players: [],
    dealer: [],
    shoe: newShoe(rng),
    shoeLeft: SHOE_SIZE,
    shuffled: false,
    firstSeat: 0,
    turnId: null,
    turnAt: null,
    dealAt: null,
    settleAt: null,
    hand: 0,
    round: 0,
    matches: 0,
    seq: 0,
  };
}

// Fresh bankrolls and a freshly shuffled shoe; the first deal shows the shuffle.
function startMatch(s: DuelState, rng: Rng): DuelState {
  return {
    ...s,
    phase: "betting",
    players: s.players.map((p) => ({ ...fresh(p), chips: START_CHIPS })),
    dealer: [],
    shoe: newShoe(rng),
    turnId: null,
    turnAt: null,
    dealAt: null,
    settleAt: null,
    hand: 0,
    matches: s.matches + 1,
  };
}

export function addDuelPlayer(s: DuelState, p: { id: string; name: string }, rng: Rng = cryptoRng): DuelState {
  if (s.players.length >= MAX_DUEL_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const seat = s.players.some((x) => x.seat === 0) ? 1 : 0;
  const player: DuelPlayer = {
    id: p.id,
    name: p.name,
    connected: true,
    seat,
    chips: START_CHIPS,
    stack: [],
    ready: false,
    cards: [],
    done: false,
    doubled: false,
    result: null,
    rematch: false,
  };
  const next = { ...s, players: [...s.players, player].sort((a, b) => a.seat - b.seat), seq: s.seq + 1 };
  // The challenger's friend sat down: the match starts straight away.
  return next.players.length === MAX_DUEL_PLAYERS ? startMatch(next, rng) : next;
}

export function setDuelConnected(s: DuelState, id: string, connected: boolean): DuelState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  return { ...patch(s, id, (x) => ({ ...x, connected })), seq: s.seq + 1 };
}

// A head-to-head needs two: when one walks away the other waits at a clean table for a new challenger.
export function removeDuelPlayer(s: DuelState, id: string): DuelState {
  if (!s.players.some((p) => p.id === id)) return s;
  const players = s.players.filter((p) => p.id !== id).map((p) => ({ ...fresh(p), chips: START_CHIPS }));
  return { ...s, phase: "lobby", players, dealer: [], turnId: null, turnAt: null, dealAt: null, settleAt: null, hand: 0, seq: s.seq + 1 };
}

function draw(s: DuelState, rng: Rng): { card: BjCard; shoe: BjCard[] } {
  // ponytail: a fresh shoe only if one hand eats the last quarter of 7 decks, which two players can't do.
  const shoe = s.shoe.length > 0 ? s.shoe : newShoe(rng);
  const [card, ...rest] = shoe;
  if (!card) throw new Error("empty shoe");
  return { card, shoe: rest };
}

// Dealer stands on all 17s; draws nothing when every hand is already decided (bust or blackjack).
function settle(s: DuelState, now: number, rng: Rng): DuelState {
  let next = s;
  let dealer = real(s.dealer);
  const hands = inHand(s);
  const live = hands.some((p) => !isBust(p.cards));
  const allBlackjack = hands.every((p) => isBlackjack(p.cards));
  while (live && !isBlackjack(dealer) && !allBlackjack && handValue(dealer).total < 17) {
    const d = draw(next, rng);
    dealer = [...dealer, d.card];
    next = { ...next, shoe: d.shoe };
  }
  const players = next.players.map((p) => {
    if (p.cards.length === 0) return p;
    const bet = betOf(p);
    const outcome = outcomeOf(p.cards, dealer);
    const won = payout(outcome, bet);
    return { ...p, chips: p.chips + won, done: true, result: { outcome, net: won - bet } };
  });
  const draws = Math.max(0, dealer.length - 2);
  return { ...next, players, dealer, phase: "settle", turnId: null, turnAt: null, settleAt: now + HOLE_LEAD_MS + draws * DEALER_CARD_MS + SETTLE_MS };
}

function nextTurn(s: DuelState, now: number, rng: Rng): DuelState {
  const p = inHand(s).find((x) => !x.done);
  return p ? { ...s, turnId: p.id, turnAt: now } : settle(s, now, rng);
}

function deal(s: DuelState, now: number, rng: Rng): DuelState {
  const bettors = s.players.filter((p) => betOf(p) >= MIN_BET && betOf(p) <= p.chips);
  if (bettors.length === 0) return { ...s, dealAt: null };
  const reshuffle = s.shoe.length === SHOE_SIZE || s.shoe.length < RESHUFFLE_AT;
  const hand = s.hand + 1;
  let next: DuelState = {
    ...s,
    shoe: s.shoe.length < RESHUFFLE_AT ? newShoe(rng) : s.shoe,
    shuffled: reshuffle,
    firstSeat: hand % 2 === 1 ? 0 : 1,
    dealer: [],
    dealAt: null,
    hand,
    round: s.round + 1,
    players: s.players.map((p) => (bettors.includes(p) ? { ...p, chips: p.chips - betOf(p), ready: false } : { ...p, stack: [], ready: false })),
  };
  const order = inHandOrder(next, bettors);
  // Two passes, dealer last each time, like the real thing.
  for (let pass = 0; pass < 2; pass++) {
    for (const b of order) {
      const d = draw(next, rng);
      next = { ...patch(next, b.id, (p) => ({ ...p, cards: [...p.cards, d.card] })), shoe: d.shoe };
    }
    const d = draw(next, rng);
    next = { ...next, dealer: [...next.dealer, d.card], shoe: d.shoe };
  }
  next = { ...next, phase: "playing", players: next.players.map((p) => (isBlackjack(p.cards) ? { ...p, done: true } : p)) };
  const landed = now + (reshuffle ? SHUFFLE_MS : 0) + dealAnimMs(order.length);
  // Dealer peeks under a ten or ace: a dealer blackjack ends the hand before anyone acts.
  if (isBlackjack(real(next.dealer))) return settle(next, landed, rng);
  return nextTurn(next, landed, rng);
}

const inHandOrder = (s: DuelState, ps: DuelPlayer[]) => [...ps].sort((a, b) => turnOrder(s)(a) - turnOrder(s)(b));

// Deal as soon as both locked in; the first lock-in starts the clock for the other.
function syncBetting(s: DuelState, now: number, rng: Rng): DuelState {
  const ready = s.players.filter((p) => p.ready);
  if (ready.length === s.players.length) return deal(s, now, rng);
  if (ready.length === 0) return { ...s, dealAt: null };
  return { ...s, dealAt: s.dealAt ?? now + BET_MS };
}

// After the results: the same bet rides again (a double comes back off), unless the match is decided.
function nextHand(s: DuelState): DuelState {
  const players = s.players.map((p) => {
    const stack = p.doubled ? p.stack.slice(0, p.stack.length / 2) : p.stack;
    return { ...p, stack: betOf({ stack }) <= p.chips ? stack : [], ready: false, cards: [], done: false, doubled: false, result: null };
  });
  const over = s.hand >= HANDS || players.some((p) => p.chips < MIN_BET);
  // At the final whistle everyone's chips come off the felt.
  return { ...s, phase: over ? "over" : "betting", players: over ? players.map((p) => ({ ...p, stack: [] })) : players, dealer: [], turnId: null, turnAt: null, settleAt: null, dealAt: null };
}

function act(s: DuelState, id: string, move: "hit" | "stand" | "double", now: number, rng: Rng): DuelState {
  if (move === "stand") return nextTurn(patch(s, id, (p) => ({ ...p, done: true })), now, rng);
  const d = draw(s, rng);
  const next = {
    ...patch(s, id, (p) => {
      const cards = [...p.cards, d.card];
      if (move === "double") return { ...p, cards, chips: p.chips - betOf(p), stack: [...p.stack, ...p.stack], doubled: true, done: true };
      return { ...p, cards, done: handValue(cards).total >= 21 };
    }),
    shoe: d.shoe,
  };
  const me = next.players.find((p) => p.id === id);
  return me?.done ? nextTurn(next, now, rng) : { ...next, turnAt: now };
}

export function applyDuelIntent(s: DuelState, actorId: string, intent: DuelIntent, opts: { isHost: boolean; now: number; rng?: Rng }): DuelResult {
  const me = s.players.find((p) => p.id === actorId);
  if (!me) return { ok: false, error: "You are not at this table" };
  const rng = opts.rng ?? cryptoRng;
  const { now } = opts;
  const done = (state: DuelState): DuelResult => ({ ok: true, state: bump(state, s) });
  const fail = (error: string): DuelResult => ({ ok: false, error });
  const bet = betOf(me);

  switch (intent.type) {
    case "chip":
    case "undo":
    case "clear": {
      if (s.phase !== "betting") return fail("Bets are closed");
      if (me.ready) return fail("You've locked in");
      if (intent.type === "chip") {
        if (!DENOMS.includes(intent.value)) return fail("No such chip");
        if (bet + intent.value > me.chips) return fail("Not enough chips");
        if (bet + intent.value > MAX_BET) return fail(`Table max is $${MAX_BET}`);
        return done(patch(s, actorId, (p) => ({ ...p, stack: [...p.stack, intent.value] })));
      }
      if (me.stack.length === 0) return fail("No chips to take back");
      return done(patch(s, actorId, (p) => ({ ...p, stack: intent.type === "undo" ? p.stack.slice(0, -1) : [] })));
    }
    case "lock":
      if (s.phase !== "betting") return fail("Bets are closed");
      if (me.ready) return fail("You've locked in");
      if (bet < MIN_BET) return fail("Place a bet first");
      return done(syncBetting(patch(s, actorId, (p) => ({ ...p, ready: true })), now, rng));
    case "hit":
    case "stand":
    case "double":
      if (s.phase !== "playing") return fail("No hand in play");
      if (s.turnId !== actorId) return fail("It's not your turn");
      if (s.turnAt !== null && now < s.turnAt) return fail("Still dealing");
      if (intent.type === "double" && me.cards.length !== 2) return fail("Double only on your first two cards");
      if (intent.type === "double" && me.chips < bet) return fail("Not enough chips to double");
      return done(act(s, actorId, intent.type, now, rng));
    case "rematch": {
      if (s.phase !== "over") return fail("The match isn't over");
      if (me.rematch) return fail("Waiting on your opponent");
      const next = patch(s, actorId, (p) => ({ ...p, rematch: true }));
      const all = next.players.length === MAX_DUEL_PLAYERS && next.players.every((p) => p.rematch);
      return done(all ? startMatch(next, rng) : next);
    }
  }
  return fail("Unknown action");
}

export function serverDeadline(s: DuelState): number | null {
  if (s.phase === "betting") return s.dealAt;
  if (s.phase === "playing") return s.turnAt === null ? null : s.turnAt + TURN_MS;
  if (s.phase === "settle") return s.settleAt;
  return null;
}

export const visibleDeadline = serverDeadline;

export function onDeadline(s: DuelState, now: number, rng: Rng = cryptoRng): DuelState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "betting") return bump(deal(s, now, rng), s);
  if (s.phase === "settle") return bump(nextHand(s), s);
  return s.turnId ? bump(act(s, s.turnId, "stand", now, rng), s) : s;
}

export function redactDuel(s: DuelState): DuelState {
  const dealer = s.phase === "playing" ? s.dealer.map((c, i) => (i === 1 ? null : c)) : s.dealer;
  return { ...s, shoe: [], shoeLeft: s.shoe.length, dealer };
}
