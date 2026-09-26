import type { Card } from "./types.ts";

export type Rng = () => number;

// Ids are stable across games so clients can diff visible cards against the full deck.
export function buildDeck(): Card[] {
  const cards: Card[] = [{ id: "n0", kind: "number", value: 0 }];
  for (let v = 1; v <= 12; v++) {
    for (let i = 0; i < v; i++) cards.push({ id: `n${v}-${i}`, kind: "number", value: v });
  }
  for (const v of [2, 4, 6, 8, 10] as const) cards.push({ id: `p${v}`, kind: "plus", value: v });
  cards.push({ id: "x2", kind: "x2" });
  for (let i = 0; i < 3; i++) {
    cards.push({ id: `fr${i}`, kind: "freeze" }, { id: `ft${i}`, kind: "flipThree" }, { id: `sc${i}`, kind: "secondChance" });
  }
  return cards;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const x = a[i];
    const y = a[j];
    if (x === undefined || y === undefined) continue;
    a[i] = y;
    a[j] = x;
  }
  return a;
}
