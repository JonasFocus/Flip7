import { categoryIndex, evaluate, rankValue } from "./eval.ts";
import { legalActions } from "./rules.ts";
import type { TxActions, TxCard, TxIntent, TxState } from "./types.ts";

export type TxPersonality = "tight" | "maniac" | "station";

export const TX_BOT_STYLES: readonly { name: string; personality: TxPersonality }[] = [
  { name: "Rock", personality: "tight" },
  { name: "Maverick", personality: "maniac" },
  { name: "Sally", personality: "station" },
  { name: "Granite", personality: "tight" },
  { name: "Rocket", personality: "maniac" },
  { name: "Casper", personality: "station" },
];

interface Knobs {
  openTier: number; // lowest preflop tier that pays to see a flop
  raiseTier: number; // lowest tier that bets or raises for value
  bluffRate: number; // chance to bet or raise with anything
  callSlack: number; // extra pot-odds leniency when calling
  betSizeFrac: number; // bet as a fraction of the pot
}

const KNOBS: Record<TxPersonality, Knobs> = {
  tight: { openTier: 2, raiseTier: 3, bluffRate: 0.03, callSlack: 0, betSizeFrac: 0.6 },
  maniac: { openTier: 0, raiseTier: 1, bluffRate: 0.35, callSlack: 0.25, betSizeFrac: 1 },
  station: { openTier: 0, raiseTier: 4, bluffRate: 0, callSlack: 0.5, betSizeFrac: 0.4 },
};

const SHOVE_FRAC = 0.6; // a bet this deep into the stack goes all in
const HIGH_CARD = 0.15;
const WEAK_PAIR = 0.3;
const TOP_PAIR = 0.5;
const DRAW_BUMP = 0.2; // one tier
const CATEGORY_STRENGTH = [HIGH_CARD, WEAK_PAIR, 0.7, 0.78, 0.85, 0.9, 0.95, 1, 1];
const tierOf = (strength: number): number => Math.min(4, Math.floor(strength * 5));

// Chen-style score, since evaluate needs 5+ cards: top card, pair, suited, and how close the two cards are.
export function preflopTier(hole: readonly [TxCard, TxCard]): number {
  const [hi, lo] = [...hole].sort((a, b) => rankValue(b) - rankValue(a));
  if (!hi || !lo) return 0;
  const high = rankValue(hi);
  const gap = high - rankValue(lo) - 1;
  const points = high === 14 ? 10 : high === 13 ? 8 : high === 12 ? 7 : high === 11 ? 6 : high / 2;
  let score = Math.max(5, points * 2);
  if (gap >= 0) {
    score = points + (hi.suit === lo.suit ? 2 : 0) - (gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5);
    if (gap <= 1 && high < 12) score += 1;
  }
  return score >= 14 ? 4 : score >= 10 ? 3 : score >= 7 ? 2 : score >= 4.5 ? 1 : 0;
}

// Four to a flush or four in a row that use a hole card; worth one more tier on the flop and turn.
function hasDraw(hole: readonly TxCard[], board: readonly TxCard[]): boolean {
  const all = [...hole, ...board];
  if (hole.some((h) => all.filter((c) => c.suit === h.suit).length === 4)) return true;
  const values = new Set(all.map(rankValue));
  const mine = new Set(hole.map(rankValue));
  if (values.has(14)) values.add(1);
  if (mine.has(14)) mine.add(1);
  for (let low = 2; low <= 10; low++) {
    const run = [low, low + 1, low + 2, low + 3];
    if (run.every((v) => values.has(v)) && run.some((v) => mine.has(v))) return true;
  }
  return false;
}

function strengthOf(hole: readonly [TxCard, TxCard], board: readonly TxCard[]): number {
  if (board.length === 0) return (preflopTier(hole) + 1) / 5 - 0.1;
  const made = evaluate([...hole, ...board]);
  const category = categoryIndex(made.value);
  let strength = CATEGORY_STRENGTH[category] ?? HIGH_CARD;
  if (category === 1) {
    const pair = made.best[0];
    const pairValue = pair ? rankValue(pair) : 0;
    if (!hole.some((c) => rankValue(c) === pairValue)) strength = HIGH_CARD; // the board's pair, not ours
    else if (pairValue >= Math.max(...board.map(rankValue))) strength = TOP_PAIR;
  }
  return board.length < 5 && category < 4 && hasDraw(hole, board) ? Math.min(1, strength + DRAW_BUMP) : strength;
}

// Last line of defence: whatever was chosen, the result is something applyTxIntent accepts.
function legalize(intent: TxIntent, legal: TxActions): TxIntent {
  const passive: TxIntent = legal.canCheck ? { type: "check" } : { type: "call" };
  switch (intent.type) {
    case "bet":
      return legal.canRaise ? { type: "bet", amount: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(intent.amount))) } : passive;
    case "allIn":
      return legal.canRaise ? intent : passive;
    case "check":
      return legal.canCheck ? intent : { type: "fold" };
    case "call":
    case "fold":
      return legal.canCheck ? { type: "check" } : intent;
    default:
      return passive;
  }
}

export function chooseTxIntent(s: TxState, botId: string, personality: TxPersonality, rng: () => number): TxIntent | null {
  const legal = legalActions(s, botId);
  const me = s.players.find((p) => p.id === botId);
  if (!legal || !me) return null;
  const [a, b, ...extra] = me.cards;
  if (!a || !b || extra.length > 0) return null;

  const knobs = KNOBS[personality];
  const strength = strengthOf([a, b], s.board);
  const tier = tierOf(strength);
  const bluff = rng() < knobs.bluffRate;

  if (legal.canRaise && (tier >= knobs.raiseTier || bluff)) {
    const target = Math.round(s.currentBet + (s.pot + legal.callAmount) * knobs.betSizeFrac);
    const bet = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, target));
    return legalize(bet >= legal.maxRaiseTo * SHOVE_FRAC ? { type: "allIn" } : { type: "bet", amount: bet }, legal);
  }
  if (legal.canCheck) return { type: "check" };

  const potOdds = legal.callAmount / (s.pot + legal.callAmount);
  const worthPlaying = s.board.length > 0 || tier >= knobs.openTier;
  return legalize(worthPlaying && strength > potOdds - knobs.callSlack ? { type: "call" } : { type: "fold" }, legal);
}
