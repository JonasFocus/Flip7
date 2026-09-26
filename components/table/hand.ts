import { scoreHand } from "@/lib/engine";
import type { Card, HandScore, Player } from "@/lib/engine/types";

export function roundScore(p: Player): HandScore {
  const s = scoreHand(p.hand, { flip7: p.status === "flip7" });
  return p.status === "busted" ? { ...s, total: 0 } : s;
}

function rank(c: Card): number {
  switch (c.kind) {
    case "number":
      return c.value;
    case "x2":
      return 100;
    case "plus":
      return 100 + c.value;
    default:
      return 200;
  }
}

// Numbers ascending, then modifiers and Second Chance grouped.
export function splitHand(cards: Card[]): { numbers: Card[]; specials: Card[] } {
  const sorted = [...cards].sort((a, b) => rank(a) - rank(b));
  return { numbers: sorted.filter((c) => c.kind === "number"), specials: sorted.filter((c) => c.kind !== "number") };
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
