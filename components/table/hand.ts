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

// Part of the pair that caused a bust.
export function isDuplicate(hand: Card[], c: Card): boolean {
  return c.kind === "number" && hand.filter((x) => x.kind === "number" && x.value === c.value).length > 1;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// A player as the table has revealed them so far: queued cards left out, and the status they had
// before those cards (a bust or Flip 7 lands with its card, not before it). `pendingStatus` holds
// players whose stay / freeze / Flip 7 line is still queued, so their badge waits for it too.
export function shownPlayer(p: Player, hidden: Set<string>, pendingStatus?: Set<string>): Player {
  const hand = p.hand.filter((c) => !hidden.has(c.id));
  if (hand.length === p.hand.length && !pendingStatus?.has(p.id)) return p;
  return { ...p, hand, status: "active" };
}
