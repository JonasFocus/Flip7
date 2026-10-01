import type { Rank, Suit } from "../blackjack/types.ts";

type EvalCard = { rank: Rank; suit: Suit };

export type HandResult<C extends EvalCard = EvalCard> = { value: number; name: string; best: C[] };
export type PotContribution = { id: string; total: number; folded: boolean };
export type Pot = { amount: number; eligible: string[] };

const RANK_VALUE: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14,
};

const SINGULAR = ["", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace"];
const PLURAL = ["", "", "Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights", "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"];

export const HAND_CATEGORIES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

const BASE = 15;

const rv = (c: EvalCard) => RANK_VALUE[c.rank];

function score(category: number, ranks: number[]): number {
  let v = category;
  for (let i = 0; i < 5; i++) v = v * BASE + (ranks[i] ?? 0);
  return v;
}

// Highest straight top card (5 = wheel) among distinct rank values, or 0.
function straightHigh(values: Set<number>): number {
  for (let high = 14; high >= 5; high--) {
    let ok = true;
    for (let r = high; r > high - 5; r--) {
      if (!values.has(r === 1 ? 14 : r)) {
        ok = false;
        break;
      }
    }
    if (ok) return high;
  }
  return 0;
}

function describe(category: number, ranks: number[]): string {
  const [a = 0, b = 0] = ranks;
  switch (category) {
    case 8:
      return a === 14 ? "Royal flush" : `Straight flush, ${SINGULAR[a]} high`;
    case 7:
      return `Four ${PLURAL[a]}`;
    case 6:
      return `Full house, ${PLURAL[a]} over ${PLURAL[b]}`;
    case 5:
      return `Flush, ${SINGULAR[a]} high`;
    case 4:
      return `Straight, ${SINGULAR[a]} high`;
    case 3:
      return `Three ${PLURAL[a]}`;
    case 2:
      return `Two pair, ${PLURAL[a]} and ${PLURAL[b]}`;
    case 1:
      return `Pair of ${PLURAL[a]}`;
    default:
      return `${SINGULAR[a]} high`;
  }
}

export function evaluate<C extends EvalCard>(cards: C[]): HandResult<C> {
  if (cards.length < 5 || cards.length > 7) throw new Error("evaluate needs 5 to 7 cards");
  const sorted = [...cards].sort((x, y) => rv(y) - rv(x));
  const take = (pred: (c: C) => boolean, n: number) => sorted.filter(pred).slice(0, n);

  const result = (category: number, best: C[], ranks: number[]): HandResult<C> => ({
    value: score(category, ranks),
    name: describe(category, ranks),
    best,
  });

  const bySuit = new Map<Suit, C[]>();
  const byRank = new Map<number, C[]>();
  for (const c of sorted) {
    bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]);
    byRank.set(rv(c), [...(byRank.get(rv(c)) ?? []), c]);
  }

  const straightCards = (pool: C[], high: number): C[] => {
    const out: C[] = [];
    for (let r = high; r > high - 5; r--) {
      const want = r === 1 ? 14 : r;
      const found = pool.find((c) => rv(c) === want);
      if (found) out.push(found);
    }
    return out;
  };

  const flushCards = [...bySuit.values()].find((g) => g.length >= 5);
  if (flushCards) {
    const sfHigh = straightHigh(new Set(flushCards.map(rv)));
    if (sfHigh) return result(8, straightCards(flushCards, sfHigh), [sfHigh, sfHigh - 1, sfHigh - 2, sfHigh - 3, sfHigh - 4]);
  }

  // Groups by count desc, then rank desc.
  const groups = [...byRank.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const [g0, g1] = groups;
  const count0 = g0?.[1].length ?? 0;
  const count1 = g1?.[1].length ?? 0;

  if (g0 && count0 === 4) {
    const kicker = take((c) => rv(c) !== g0[0], 1);
    return result(7, [...g0[1], ...kicker], [g0[0], ...kicker.map(rv)]);
  }
  if (g0 && g1 && count0 === 3 && count1 >= 2) {
    return result(6, [...g0[1], ...g1[1].slice(0, 2)], [g0[0], g1[0]]);
  }
  if (flushCards) {
    const best = flushCards.slice(0, 5);
    return result(5, best, best.map(rv));
  }
  const sHigh = straightHigh(new Set(byRank.keys()));
  if (sHigh) {
    const best = straightCards(sorted, sHigh);
    return result(4, best, [sHigh, sHigh - 1, sHigh - 2, sHigh - 3, sHigh - 4]);
  }
  if (g0 && count0 === 3) {
    const kickers = take((c) => rv(c) !== g0[0], 2);
    return result(3, [...g0[1], ...kickers], [g0[0], ...kickers.map(rv)]);
  }
  if (g0 && g1 && count0 === 2 && count1 === 2) {
    const kicker = take((c) => rv(c) !== g0[0] && rv(c) !== g1[0], 1);
    return result(2, [...g0[1], ...g1[1], ...kicker], [g0[0], g1[0], ...kicker.map(rv)]);
  }
  if (g0 && count0 === 2) {
    const kickers = take((c) => rv(c) !== g0[0], 3);
    return result(1, [...g0[1], ...kickers], [g0[0], ...kickers.map(rv)]);
  }
  const best = sorted.slice(0, 5);
  return result(0, best, best.map(rv));
}

export function handCategory(value: number): string {
  return HAND_CATEGORIES[Math.floor(value / BASE ** 5)] ?? HAND_CATEGORIES[0];
}

// Layers by the distinct totals of live players; dead money from folded players rides in the layers it reaches.
// Any folded excess above the top live total joins the last pot.
export function buildPots(contribs: PotContribution[]): Pot[] {
  const levels = [...new Set(contribs.filter((c) => !c.folded && c.total > 0).map((c) => c.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = contribs.reduce((sum, c) => sum + Math.max(0, Math.min(c.total, level) - prev), 0);
    const eligible = contribs.filter((c) => !c.folded && c.total >= level).map((c) => c.id);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  const excess = contribs.reduce((sum, c) => sum + Math.max(0, c.total - prev), 0);
  if (excess > 0) {
    const last = pots[pots.length - 1];
    if (last) last.amount += excess;
    else pots.push({ amount: excess, eligible: [] });
  }
  return pots;
}
