import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rank, Suit } from "../lib/blackjack/types.ts";
import { buildPots, evaluate, handCategory, madeHand } from "../lib/texasholdem/eval.ts";

type Card = { rank: Rank; suit: Suit };

const parse = (s: string): Card[] =>
  s.split(" ").map((t) => ({ rank: t.slice(0, -1) as Rank, suit: t.slice(-1) as Suit }));
const ev = (s: string) => evaluate(parse(s));
const beats = (a: string, b: string) => assert.ok(ev(a).value > ev(b).value, `${a} should beat ${b}`);
const ties = (a: string, b: string) => assert.equal(ev(a).value, ev(b).value);

test("every category is detected and named", () => {
  const cases: [string, string, string][] = [
    ["As Ks Qs Js 10s 2d 3c", "Straight flush", "Royal flush"],
    ["9h 8h 7h 6h 5h Ad Ac", "Straight flush", "Straight flush, Nine high"],
    ["Kd Kh Ks Kc 2d 3c 4h", "Four of a kind", "Four Kings"],
    ["Kd Kh Ks 4c 4d 2c 7h", "Full house", "Full house, Kings over Fours"],
    ["Ad 9d 7d 4d 2d Kc Qh", "Flush", "Flush, Ace high"],
    ["9d 8c 7h 6s 5d 2c 2h", "Straight", "Straight, Nine high"],
    ["Qd Qh Qs 9c 7d 3c 2h", "Three of a kind", "Three Queens"],
    ["Jd Jh 4s 4c 9d 3c 2h", "Two pair", "Two pair, Jacks and Fours"],
    ["Ad Ah 4s 8c 9d 3c 2h", "Pair", "Pair of Aces"],
    ["Ad Kh 4s 8c 9d 3c 2h", "High card", "Ace high"],
  ];
  for (const [hand, category, name] of cases) {
    const r = ev(hand);
    assert.equal(handCategory(r.value), category, hand);
    assert.equal(r.name, name, hand);
    assert.equal(r.best.length, 5);
  }
});

test("category ordering", () => {
  const ladder = [
    "Ad Kh 4s 8c 9d 3c 2h",
    "Ad Ah 4s 8c 9d 3c 2h",
    "Jd Jh 4s 4c 9d 3c 2h",
    "Qd Qh Qs 9c 7d 3c 2h",
    "9d 8c 7h 6s 5d 2c 2h",
    "Ad 9d 7d 4d 2d Kc Qh",
    "Kd Kh Ks 4c 4d 2c 7h",
    "Kd Kh Ks Kc 2d 3c 4h",
    "9h 8h 7h 6h 5h Ad Ac",
    "As Ks Qs Js 10s 2d 3c",
  ];
  ladder.slice(1).forEach((hand, i) => beats(hand, ladder[i] ?? ""));
});

test("kickers decide within a category", () => {
  beats("Ad Ah Ks 5c 3d", "Ac As Qs 5h 3c");
  beats("Ad Ah Ks 6c 3d", "Ac As Ks 5h 3c");
  beats("Ad Ah Ks 5c 4d", "Ac As Ks 5h 3c");
  beats("Kd Kh Qs Qc 3d", "Kc Ks Qh Qd 2c");
  beats("Kd Kh Qs Qc 3d", "Kc Ks Jh Jd Ac");
  beats("Kd Kh Kc 9s 8d", "Kc Ks Kh 9d 7c");
  beats("Kd Kh Kc 3s 3d", "Qc Qs Qh Ad Ac");
  beats("Kd Kh Kc Ks 3d", "Qc Qs Qh Qd Ac");
  beats("Kd Kh Kc Ks 4d", "Kd Kh Kc Ks 3d");
  beats("Ad 9d 7d 4d 3d", "Ac 9c 7c 4c 2c");
  beats("Kd Qd Jd 9d 8d", "Kc Qc Jc 9c 7c");
  beats("9d 8c 7h 6s 5d", "8d 7c 6h 5s 4d");
});

test("wheel is the lowest straight and ace plays low only there", () => {
  const wheel = ev("Ad 2c 3h 4s 5d");
  assert.equal(wheel.name, "Straight, Five high");
  assert.deepEqual(wheel.best.map((c) => c.rank), ["5", "4", "3", "2", "A"]);
  beats("2d 3c 4h 5s 6d", "Ad 2c 3h 4s 5d");
  beats("Ad 2c 3h 4s 5d", "Ac Ad Kh Qc 2s");
  assert.equal(handCategory(ev("Qd Kc Ah 2s 3d").value), "High card");
  assert.equal(ev("Ah Kd Qc Js 10d").name, "Straight, Ace high");
  const sf = ev("Ad 2d 3d 4d 5d Kc Kh");
  assert.equal(sf.name, "Straight flush, Five high");
  assert.equal(handCategory(sf.value), "Straight flush");
});

test("7 cards: best of 21 picks the right pieces", () => {
  assert.equal(ev("Ad Kd 2d 7d 9d Ac As").name, "Flush, Ace high");
  assert.equal(ev("Ad Ac Ah Kd Kc Ks 2h").name, "Full house, Aces over Kings");
  assert.equal(ev("Ad Ac Kd Kc Qd Qc 2h").name, "Two pair, Aces and Kings");
  assert.deepEqual(ev("Ad Ac Kd Kc Qd Qc 2h").best.map((c) => c.rank).sort(), ["A", "A", "K", "K", "Q"]);
  assert.equal(ev("2d 3d 4d 5d 6d 7d Kd").name, "Straight flush, Seven high");
  assert.equal(ev("2c 3d 4h 5s 6d 7c 9h").name, "Straight, Seven high");
  // flush beats the straight also present; straight flush needs same suit
  assert.equal(handCategory(ev("2d 3d 4d 5d 6c 9d 7h").value), "Flush");
  // board plays: both players tie
  ties("Ad Kd Qs Js 10c 2h 3h", "Ah Ks Qs Js 10c 4d 5d");
  // quads with a pair kicker choice
  const q = ev("9d 9h 9s 9c Kd Kh 2c");
  assert.deepEqual(q.best.map((c) => c.rank).sort(), ["9", "9", "9", "9", "K"]);
});

test("best hand uses only the input cards and ignores extra pair noise", () => {
  const input = parse("Ad Ac Kd Kc Qd Qc 2h");
  const r = evaluate(input);
  for (const c of r.best) assert.ok(input.includes(c));
});

// Independent oracle: best 5-card score over all 21 subsets, scored by a naive tuple comparison.
function oracleScore(five: Card[]): number[] {
  const suit0 = five[0]?.suit;
  const v = (c: Card) => ({ "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 })[c.rank];
  const vals = five.map(v).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const x of vals) counts.set(x, (counts.get(x) ?? 0) + 1);
  const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = five.every((c) => c.suit === suit0);
  let straightTop = 0;
  if (counts.size === 5) {
    if ((vals[0] ?? 0) - (vals[4] ?? 0) === 4) straightTop = vals[0] ?? 0;
    else if (vals.join() === "14,5,4,3,2") straightTop = 5;
  }
  const shape = grouped.map((g) => g[1]).join("");
  const ranks = grouped.map((g) => g[0]);
  if (straightTop && flush) return [8, straightTop];
  if (shape === "41") return [7, ...ranks];
  if (shape === "32") return [6, ...ranks];
  if (flush) return [5, ...vals];
  if (straightTop) return [4, straightTop];
  if (shape === "311") return [3, ...ranks];
  if (shape === "221") return [2, ...ranks];
  if (shape === "2111") return [1, ...ranks];
  return [0, ...vals];
}
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
function combos<T>(xs: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [h, ...t] = xs as [T, ...T[]];
  return [...combos(t, k - 1).map((rest) => [h, ...rest]), ...combos(t, k)];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS: Suit[] = ["s", "h", "d", "c"];
const deck = (): Card[] => RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
function deal(r: () => number, n: number): Card[] {
  const d = deck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [d[i], d[j]] = [d[j] as Card, d[i] as Card];
  }
  return d.slice(0, n);
}

test("random 5/6/7-card hands agree with brute force on ordering", () => {
  const r = rng(7);
  const hands: { cards: Card[]; oracle: number[]; value: number }[] = [];
  for (let i = 0; i < 4000; i++) {
    const cards = deal(r, 5 + (i % 3));
    const oracle = combos(cards, 5).map(oracleScore).reduce((a, b) => (cmp(a, b) >= 0 ? a : b));
    const res = evaluate(cards);
    // best must itself be a valid 5-card subset achieving the oracle score
    assert.equal(res.best.length, 5);
    assert.equal(cmp(oracleScore(res.best), oracle), 0, cards.map((c) => c.rank + c.suit).join(" "));
    hands.push({ cards, oracle, value: res.value });
  }
  for (let i = 1; i < hands.length; i++) {
    const a = hands[i - 1];
    const b = hands[i];
    if (!a || !b) throw new Error("unreachable");
    assert.equal(Math.sign(a.value - b.value), Math.sign(cmp(a.oracle, b.oracle)));
  }
});

test("exhaustive 5-card category frequencies", () => {
  const counts: Record<string, number> = {};
  for (const five of combos(deck(), 5)) {
    const c = handCategory(evaluate(five).value);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  assert.deepEqual(counts, {
    "High card": 1302540,
    Pair: 1098240,
    "Two pair": 123552,
    "Three of a kind": 54912,
    Straight: 10200,
    Flush: 5108,
    "Full house": 3744,
    "Four of a kind": 624,
    "Straight flush": 40,
  });
});

test("rejects bad card counts", () => {
  assert.throws(() => evaluate(parse("Ad Kd Qd Jd")));
  assert.throws(() => evaluate(parse("Ad Kd Qd Jd 9c 8c 7c 6c")));
});

// buildPots
const c = (id: string, total: number, folded = false) => ({ id, total, folded });
const sum = (pots: { amount: number }[]) => pots.reduce((s, p) => s + p.amount, 0);

test("single pot when everyone matches", () => {
  assert.deepEqual(buildPots([c("a", 100), c("b", 100), c("c", 100)]), [{ amount: 300, eligible: ["a", "b", "c"] }]);
});

test("folded dead money stays in the pot but not eligible", () => {
  assert.deepEqual(buildPots([c("a", 100), c("b", 100), c("c", 20, true)]), [{ amount: 220, eligible: ["a", "b"] }]);
});

test("one short all-in makes main and side pot", () => {
  assert.deepEqual(buildPots([c("a", 50), c("b", 200), c("c", 200)]), [
    { amount: 150, eligible: ["a", "b", "c"] },
    { amount: 300, eligible: ["b", "c"] },
  ]);
});

test("multiple all-ins plus fold in between", () => {
  const input = [c("a", 30), c("b", 100), c("c", 60, true), c("d", 100), c("e", 80)];
  const pots = buildPots(input);
  assert.deepEqual(pots, [
    { amount: 150, eligible: ["a", "b", "d", "e"] },
    { amount: 50 + 50 + 30 + 50, eligible: ["b", "d", "e"] },
    { amount: 40, eligible: ["b", "d"] },
  ]);
  assert.equal(sum(pots), 370);
});

test("folded player who put in more than every live player adds to the last pot", () => {
  const pots = buildPots([c("a", 40), c("b", 100, true), c("c", 40)]);
  assert.deepEqual(pots, [{ amount: 180, eligible: ["a", "c"] }]);
});

test("pot totals always equal contributions on random scenarios", () => {
  const r = rng(11);
  for (let i = 0; i < 500; i++) {
    const n = 2 + Math.floor(r() * 7);
    const input = Array.from({ length: n }, (_, k) => c(`p${k}`, Math.floor(r() * 5) * 25, r() < 0.3));
    const pots = buildPots(input);
    assert.equal(sum(pots), input.reduce((s, x) => s + x.total, 0));
    for (const pot of pots) for (const id of pot.eligible) assert.ok(!input.find((x) => x.id === id)?.folded);
  }
});

test("empty and zero contributions", () => {
  assert.deepEqual(buildPots([]), []);
  assert.deepEqual(buildPots([c("a", 0), c("b", 0)]), []);
});

test("madeHand names the hole cards before the flop and the best hand after", () => {
  assert.equal(madeHand(parse("Kd Kh")), "Pair of Kings");
  assert.equal(madeHand(parse("4c Qh")), "Queen high");
  assert.equal(madeHand(parse("Kd 9h Ks 9c 2d")), "Two pair, Kings and Nines");
  assert.equal(madeHand(parse("9d 8c 7h 6s 5d 2c")), "Straight, Nine high");
  assert.equal(madeHand(parse("Ad Kd 4d 8d 9d 3c 2h")), "Flush, Ace high");
});
