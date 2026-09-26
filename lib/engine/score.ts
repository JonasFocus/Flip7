import type { Card, HandScore, PhysicalEntry } from "./types.ts";

export function uniqueNumbers(cards: Card[]): number {
  return new Set(cards.flatMap((c) => (c.kind === "number" ? [c.value] : []))).size;
}

// flip7 defaults to "hand has 7 unique numbers". Busted hands are the caller's concern (score 0).
export function scoreHand(cards: Card[], opts: { flip7?: boolean } = {}): HandScore {
  let numberSum = 0;
  let plus = 0;
  let doubled = false;
  for (const c of cards) {
    if (c.kind === "number") numberSum += c.value;
    else if (c.kind === "plus") plus += c.value;
    else if (c.kind === "x2") doubled = true;
  }
  const flip7Bonus = (opts.flip7 ?? uniqueNumbers(cards) >= 7) ? 15 : 0;
  return { numberSum, doubled, plus, flip7Bonus, total: numberSum * (doubled ? 2 : 1) + plus + flip7Bonus };
}

export function scorePhysical(entry: PhysicalEntry): number {
  if (entry.busted) return 0;
  const numbers = [...new Set(entry.numbers)];
  const sum = numbers.reduce((a, b) => a + b, 0);
  const plus = [...new Set(entry.plus)].reduce((a, b) => a + b, 0);
  return sum * (entry.x2 ? 2 : 1) + plus + (numbers.length >= 7 ? 15 : 0);
}
