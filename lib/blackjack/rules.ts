import type { BjCard, BjHand, BjIntent, BjPlayer, BjState, Outcome, Rank, Suit } from "./types.ts";

export const SEATS = 5;
export const MAX_BJ_PLAYERS = 10; // 5 seats plus rail watchers
export const START_CHIPS = 1000;
export const MIN_BET = 10;
export const DECKS = 7;
export const STREAK_STEP = 0.1; // each win already in the streak adds this share of the stake to the next win...
export const STREAK_CAP = 5; // ...up to five wins deep (+50%)
export const SHOE_SIZE = 52 * DECKS;
export const DEAL_MS = 10_000; // after the first Deal tap, the rest of the table has this long to bet
export const TURN_MS = 20_000; // then the server stands for you
export const SETTLE_MS = 6000; // results, chip sweeps, then the cards clear to the discard tray
export const HOLE_LEAD_MS = 800; // after the last player acts, a beat before the dealer turns the hole card
export const DEALER_CARD_MS = 1300; // per dealer draw, so the reveal finishes before the read time starts
export const DEAL_STAGGER_MS = 240; // client deal animation: gap between cards going round the table
export const CARD_SLIDE_MS = 620; // client deal animation: one card's trip from the shoe

// The opening deal plays out two passes round the table, dealer last; the first turn's clock starts once it lands.
export const dealAnimMs = (hands: number): number => (2 * (hands + 1) - 1) * DEAL_STAGGER_MS + CARD_SLIDE_MS;
const RESHUFFLE_AT = SHOE_SIZE / 4; // cut card at 75% penetration

type Rng = () => number;

// Uniform in [0, 1) from the platform CSPRNG (Node and browsers), so shuffles aren't predictable from Math.random state.
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 2 ** 32;
};
export type BjResult = { ok: true; state: BjState } | { ok: false; error: string };

const RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: readonly Suit[] = ["s", "h", "d", "c"];

const bump = (s: BjState, prev: BjState): BjState => ({ ...s, seq: prev.seq + 1 });
const bySeat = (a: BjPlayer, b: BjPlayer) => (a.seat ?? 0) - (b.seat ?? 0);
const inHand = (s: BjState): BjPlayer[] => s.players.filter((p) => p.cards.length > 0).sort(bySeat);
const patch = (s: BjState, id: string, fn: (p: BjPlayer) => BjPlayer): BjState => ({
  ...s,
  players: s.players.map((p) => (p.id === id ? fn(p) : p)),
});

export function newShoe(rng: Rng): BjCard[] {
  const shoe: BjCard[] = [];
  for (let d = 0; d < DECKS; d++) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = shoe[i];
    const b = shoe[j];
    if (a && b) [shoe[i], shoe[j]] = [b, a];
  }
  return shoe;
}

const rankValue = (r: Rank): number => (r === "A" ? 1 : r === "J" || r === "Q" || r === "K" ? 10 : Number(r));

// Nulls (the hidden hole card) count as nothing, so the client can total what it sees.
export function handValue(cards: readonly (BjCard | null)[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = false;
  for (const c of cards) {
    if (!c) continue;
    total += rankValue(c.rank);
    if (c.rank === "A") aces = true;
  }
  return aces && total + 10 <= 21 ? { total: total + 10, soft: true } : { total, soft: false };
}

export const isBlackjack = (cards: readonly (BjCard | null)[]): boolean => cards.length === 2 && handValue(cards).total === 21;
export const isBust = (cards: readonly (BjCard | null)[]): boolean => handValue(cards).total > 21;

export function createBjGame(rng: Rng = cryptoRng): BjState {
  return {
    phase: "lobby",
    players: [],
    dealer: [],
    shoe: newShoe(rng),
    shoeLeft: SHOE_SIZE,
    turnId: null,
    turnAt: null,
    dealAt: null,
    settleAt: null,
    round: 0,
    seq: 0,
  };
}

export function addBjPlayer(s: BjState, p: { id: string; name: string }): BjState {
  if (s.players.length >= MAX_BJ_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const player: BjPlayer = {
    id: p.id,
    name: p.name,
    connected: true,
    seat: null,
    chips: START_CHIPS,
    bet: 0,
    ready: false,
    cards: [],
    done: false,
    doubled: false,
    hand2: null,
    streak: 0,
    stats: { hands: 0, wins: 0, pushes: 0, bestStreak: 0, biggestWin: 0, net: 0 },
    result: null,
  };
  return { ...s, players: [...s.players, player], seq: s.seq + 1 };
}

export function setBjConnected(s: BjState, id: string, connected: boolean): BjState {
  const p = s.players.find((x) => x.id === id);
  if (!p || p.connected === connected) return s;
  return { ...patch(s, id, (x) => ({ ...x, connected })), seq: s.seq + 1 };
}

function draw(s: BjState, rng: Rng): { card: BjCard; shoe: BjCard[] } {
  // ponytail: a fresh shoe only if one hand eats the last quarter of 7 decks, which 5 seats can't do.
  const shoe = s.shoe.length > 0 ? s.shoe : newShoe(rng);
  const [card, ...rest] = shoe;
  if (!card) throw new Error("empty shoe");
  return { card, shoe: rest };
}

export function payout(outcome: Outcome, bet: number): number {
  if (outcome === "blackjack") return bet + Math.floor((bet * 3) / 2);
  if (outcome === "win") return bet * 2;
  if (outcome === "push") return bet;
  return 0;
}

// A winning hand pays extra for each win already in the streak, on top of the normal payout.
export function streakBonus(streak: number, bet: number): number {
  return Math.floor(bet * STREAK_STEP * Math.min(streak, STREAK_CAP));
}

// A 21 on a split hand is just 21, never a blackjack.
export function outcomeOf(cards: BjCard[], dealer: BjCard[], split = false): Outcome {
  if (isBust(cards)) return "lose";
  const dealerBj = isBlackjack(dealer);
  if (!split && isBlackjack(cards)) return dealerBj ? "push" : "blackjack";
  if (dealerBj) return "lose";
  const me = handValue(cards).total;
  const them = handValue(dealer).total;
  if (them > 21 || me > them) return "win";
  return me === them ? "push" : "lose";
}

// Hand 1 is done and hand 2 (if any) is done too.
export const handDone = (p: BjPlayer): boolean => p.done && (p.hand2?.done ?? true);
// The hand taking actions: hand 2 only once hand 1 is finished.
export const activeHand = (p: BjPlayer): BjHand => (p.done && p.hand2 && !p.hand2.done ? p.hand2 : p);
// ponytail: one split per round, no re-splitting; move to a hands[] array if more are wanted.
export const canSplit = (p: BjPlayer): boolean => {
  const [a, b] = p.cards;
  return !p.hand2 && p.cards.length === 2 && !!a && !!b && rankValue(a.rank) === rankValue(b.rank) && p.chips >= p.bet;
};

const real = (cards: (BjCard | null)[]): BjCard[] => cards.filter((c): c is BjCard => c !== null);

// Dealer stands on all 17s; draws nothing when every hand already busted.
function settle(s: BjState, now: number, rng: Rng): BjState {
  let next = s;
  let dealer = real(s.dealer);
  const hands = (p: BjPlayer): BjHand[] => (p.hand2 ? [p, p.hand2] : [p]);
  const live = inHand(s).some((p) => hands(p).some((h) => !isBust(h.cards)));
  const dealerBj = isBlackjack(dealer);
  const allBlackjack = inHand(s).every((p) => !p.hand2 && isBlackjack(p.cards));
  while (live && !dealerBj && !allBlackjack && handValue(dealer).total < 17) {
    const d = draw(next, rng);
    dealer = [...dealer, d.card];
    next = { ...next, shoe: d.shoe };
  }
  const players = next.players.map((p) => {
    if (p.cards.length === 0) return p;
    const split = p.hand2 !== null;
    const parts = hands(p).map((h) => {
      const outcome = outcomeOf(h.cards, dealer, split);
      const bonus = outcome === "win" || outcome === "blackjack" ? streakBonus(p.streak, h.bet) : 0;
      const won = payout(outcome, h.bet) + bonus;
      return { outcome, bonus, won, net: won - h.bet };
    });
    const won = parts.reduce((n, x) => n + x.won, 0);
    const bonus = parts.reduce((n, x) => n + x.bonus, 0);
    const net = parts.reduce((n, x) => n + x.net, 0);
    // A split round counts once for streak and stats, judged by its combined net.
    const outcome: Outcome = !split ? (parts[0]?.outcome ?? "lose") : net > 0 ? "win" : net < 0 ? "lose" : "push";
    const wins = outcome === "win" || outcome === "blackjack";
    const streak = wins ? p.streak + 1 : outcome === "push" ? p.streak : 0;
    const stats = {
      hands: p.stats.hands + 1,
      wins: p.stats.wins + (wins ? 1 : 0),
      pushes: p.stats.pushes + (outcome === "push" ? 1 : 0),
      bestStreak: Math.max(p.stats.bestStreak, streak),
      biggestWin: Math.max(p.stats.biggestWin, net),
      net: p.stats.net + net,
    };
    const result = { outcome, net, bonus, ...(split && { split: parts.map((x) => ({ outcome: x.outcome, net: x.net })) }) };
    return { ...p, chips: p.chips + won, streak, stats, done: true, hand2: p.hand2 && { ...p.hand2, done: true }, result };
  });
  const draws = Math.max(0, dealer.length - 2);
  return { ...next, players, dealer, phase: "settle", turnId: null, turnAt: null, settleAt: now + HOLE_LEAD_MS + draws * DEALER_CARD_MS + SETTLE_MS };
}

function nextTurn(s: BjState, now: number, rng: Rng): BjState {
  const p = inHand(s).find((x) => !handDone(x));
  return p ? { ...s, turnId: p.id, turnAt: now } : settle(s, now, rng);
}

function deal(s: BjState, now: number, rng: Rng): BjState {
  const bettors = s.players.filter((p) => p.seat !== null && p.bet >= MIN_BET && p.bet <= p.chips).sort(bySeat);
  if (bettors.length === 0) return { ...s, dealAt: null };
  let next: BjState = {
    ...s,
    shoe: s.shoe.length < RESHUFFLE_AT ? newShoe(rng) : s.shoe,
    dealer: [],
    dealAt: null,
    round: s.round + 1,
    players: s.players.map((p) => (bettors.includes(p) ? { ...p, chips: p.chips - p.bet, ready: false } : { ...p, bet: 0, ready: false })),
  };
  // Two passes round the table, dealer last each time, like the real thing.
  for (let pass = 0; pass < 2; pass++) {
    for (const b of bettors) {
      const d = draw(next, rng);
      next = { ...patch(next, b.id, (p) => ({ ...p, cards: [...p.cards, d.card] })), shoe: d.shoe };
    }
    const d = draw(next, rng);
    next = { ...next, dealer: [...next.dealer, d.card], shoe: d.shoe };
  }
  next = { ...next, phase: "playing", players: next.players.map((p) => (isBlackjack(p.cards) ? { ...p, done: true } : p)) };
  // Dealer peeks under a ten or ace: a dealer blackjack ends the hand before anyone acts.
  const landed = now + dealAnimMs(bettors.length);
  if (isBlackjack(real(next.dealer))) return settle(next, landed, rng);
  return nextTurn(next, landed, rng);
}

// Deal as soon as every seated player tapped Deal; the first tap starts the clock for the rest.
function syncLobby(s: BjState, now: number, rng: Rng): BjState {
  const seated = s.players.filter((p) => p.seat !== null);
  const ready = seated.filter((p) => p.ready);
  if (seated.length > 0 && ready.length === seated.length) return deal(s, now, rng);
  if (ready.length === 0) return { ...s, dealAt: null };
  return { ...s, dealAt: s.dealAt ?? now + DEAL_MS };
}

function resetTable(s: BjState): BjState {
  const players = s.players.map((p) => {
    const stake = p.doubled ? p.bet / 2 : p.bet;
    const bet = p.seat !== null && stake <= p.chips ? stake : 0;
    return { ...p, bet, ready: false, cards: [], done: false, doubled: false, hand2: null, result: null };
  });
  return { ...s, phase: "lobby", players, dealer: [], turnId: null, turnAt: null, settleAt: null, dealAt: null };
}

function act(s: BjState, id: string, move: "hit" | "stand" | "double", now: number, rng: Rng): BjState {
  const me = s.players.find((p) => p.id === id);
  if (!me) return s;
  const h = activeHand(me);
  const second = h !== me;
  const d = move === "stand" ? null : draw(s, rng);
  const cards = d ? [...h.cards, d.card] : h.cards;
  const hand: BjHand =
    move === "double" ? { ...h, cards, bet: h.bet * 2, doubled: true, done: true } : { ...h, cards, done: move === "stand" || handValue(cards).total >= 21 };
  const spent = move === "double" ? h.bet : 0;
  const next: BjState = {
    ...patch(s, id, (p) => ({ ...p, ...(second ? { hand2: hand } : hand), chips: p.chips - spent })),
    shoe: d ? d.shoe : s.shoe,
  };
  return hand.done ? nextTurn(next, now, rng) : { ...next, turnAt: now };
}

function split(s: BjState, id: string, now: number, rng: Rng): BjState {
  const me = s.players.find((p) => p.id === id);
  const [a, b] = me?.cards ?? [];
  if (!me || !a || !b) return s;
  const d1 = draw(s, rng);
  const d2 = draw({ ...s, shoe: d1.shoe }, rng);
  const first = [a, d1.card];
  const second = [b, d2.card];
  const aces = a.rank === "A"; // split aces take one card each and stand
  const settled = (cards: BjCard[]) => aces || handValue(cards).total >= 21;
  const next: BjState = {
    ...patch(s, id, (p) => ({
      ...p,
      chips: p.chips - p.bet,
      cards: first,
      done: settled(first),
      hand2: { cards: second, bet: p.bet, done: settled(second), doubled: false },
    })),
    shoe: d2.shoe,
  };
  return nextTurn(next, now, rng);
}

export function removeBjPlayer(s: BjState, id: string, opts: { now: number; rng?: Rng }): BjState {
  if (!s.players.some((p) => p.id === id)) return s;
  const rng = opts.rng ?? cryptoRng;
  const next: BjState = { ...s, players: s.players.filter((p) => p.id !== id), seq: s.seq + 1 };
  if (s.phase === "lobby") return syncLobby(next, opts.now, rng);
  if (s.phase === "playing" && s.turnId === id) return nextTurn(next, opts.now, rng);
  return next;
}

export function applyBjIntent(s: BjState, actorId: string, intent: BjIntent, opts: { isHost: boolean; now: number; rng?: Rng }): BjResult {
  const me = s.players.find((p) => p.id === actorId);
  if (!me) return { ok: false, error: "You are not at this table" };
  const rng = opts.rng ?? cryptoRng;
  const { now } = opts;
  const done = (state: BjState): BjResult => ({ ok: true, state: bump(state, s) });
  const fail = (error: string): BjResult => ({ ok: false, error });
  const lobby = (state: BjState): BjResult => done(syncLobby(state, now, rng));

  switch (intent.type) {
    case "sit": {
      const { seat } = intent;
      if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS) return fail("No such seat");
      if (me.cards.length > 0) return fail("Finish your hand first");
      if (s.players.some((p) => p.seat === seat)) return fail("Seat taken");
      const next = patch(s, actorId, (p) => ({ ...p, seat, ready: false }));
      return s.phase === "lobby" ? lobby(next) : done(next);
    }
    case "standUp": {
      if (me.seat === null) return fail("You're not seated");
      if (me.cards.length > 0) return fail("Finish your hand first");
      const next = patch(s, actorId, (p) => ({ ...p, seat: null, bet: 0, ready: false }));
      return s.phase === "lobby" ? lobby(next) : done(next);
    }
    case "bet": {
      const { amount } = intent;
      if (s.phase !== "lobby") return fail("Bets are closed");
      if (me.seat === null) return fail("Take a seat first");
      if (!Number.isInteger(amount) || amount < 0 || amount > me.chips) return fail("Not enough chips");
      if (amount > 0 && amount < MIN_BET) return fail(`Minimum bet is ${MIN_BET}`);
      return lobby(patch(s, actorId, (p) => ({ ...p, bet: amount, ready: false })));
    }
    case "deal":
      if (s.phase !== "lobby") return fail("Hand in progress");
      if (me.seat === null) return fail("Take a seat first");
      if (me.bet < MIN_BET) return fail("Place a bet first");
      return lobby(patch(s, actorId, (p) => ({ ...p, ready: true })));
    case "rebuy":
      if (s.phase !== "lobby") return fail("Wait for the hand to finish");
      if (me.chips >= MIN_BET) return fail("You still have chips");
      return done(patch(s, actorId, (p) => ({ ...p, chips: START_CHIPS, bet: 0 })));
    case "hit":
    case "stand":
    case "double":
      if (s.phase !== "playing") return fail("No hand in play");
      if (s.turnId !== actorId) return fail("It's not your turn");
      if (intent.type === "double" && activeHand(me).cards.length !== 2) return fail("Double only on your first two cards");
      if (intent.type === "double" && me.chips < activeHand(me).bet) return fail("Not enough chips to double");
      return done(act(s, actorId, intent.type, now, rng));
    case "split":
      if (s.phase !== "playing") return fail("No hand in play");
      if (s.turnId !== actorId) return fail("It's not your turn");
      if (!canSplit(me)) return fail("Can't split this hand");
      return done(split(s, actorId, now, rng));
  }
  return fail("Unknown action");
}

export function serverDeadline(s: BjState): number | null {
  if (s.phase === "lobby") return s.dealAt;
  if (s.phase === "playing") return s.turnAt === null ? null : s.turnAt + TURN_MS;
  return s.settleAt;
}

export const visibleDeadline = serverDeadline;

export function onDeadline(s: BjState, now: number, rng: Rng = cryptoRng): BjState {
  const due = serverDeadline(s);
  if (due === null || now < due) return s;
  if (s.phase === "lobby") return bump(deal(s, now, rng), s);
  if (s.phase === "settle") return bump(resetTable(s), s);
  return s.turnId ? bump(act(s, s.turnId, "stand", now, rng), s) : s;
}

export function redactBj(s: BjState): BjState {
  const dealer = s.phase === "playing" ? s.dealer.map((c, i) => (i === 1 ? null : c)) : s.dealer;
  return { ...s, shoe: [], shoeLeft: s.shoe.length, dealer };
}
