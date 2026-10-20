import type { TxActions, TxIntent, TxPlayer, TxState } from "./types.ts";

// A move queued before your turn. Lives on the client only; the fired intent goes through the normal validation.
export type PreAction = { type: "checkFold" } | { type: "check" } | { type: "call"; amount: number } | { type: "callAny" };

export type Facing = Pick<TxActions, "canCheck" | "callAmount">;

// The intents a queued move can turn into; none carries an amount.
export type QueuedIntent = Extract<TxIntent, { type: "check" | "call" | "fold" }>;

// What the table asks of a player right now, with the same numbers legalActions gives once it is their turn.
export function facing(s: TxState, p: TxPlayer): Facing {
  return { canCheck: p.bet >= s.currentBet, callAmount: Math.max(0, Math.min(s.currentBet - p.bet, p.chips)) };
}

// The intent a queued move turns into, or null when the bet moved so it is no longer what was chosen.
export function preActionIntent(pre: PreAction, now: Facing): QueuedIntent | null {
  switch (pre.type) {
    case "checkFold":
      return { type: now.canCheck ? "check" : "fold" };
    case "check":
      return now.canCheck ? { type: "check" } : null;
    case "call":
      return !now.canCheck && now.callAmount === pre.amount ? { type: "call" } : null;
    case "callAny":
      return { type: now.canCheck ? "check" : "call" };
  }
}
