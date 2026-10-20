import type { TxActions, TxIntent } from "./types.ts";

// A move picked ahead of your turn. `call` remembers the amount it was picked at.
export type TxPreAction = { kind: "checkFold" } | { kind: "check" } | { kind: "call"; amount: number };

export interface TxPreActionOutcome {
  intent: TxIntent | null; // what to send now, if anything
  clear: boolean; // drop the pre-action: it fired, or the bet changed and it no longer means what was picked
}

// Your turn has arrived: decide what the chosen pre-action does against the real legal actions.
export function resolvePreAction(pre: TxPreAction | null, legal: TxActions | null): TxPreActionOutcome {
  if (!pre || !legal) return { intent: null, clear: false };
  switch (pre.kind) {
    case "checkFold":
      return { intent: { type: legal.canCheck ? "check" : "fold" }, clear: true };
    case "check":
      return { intent: legal.canCheck ? { type: "check" } : null, clear: true };
    case "call":
      return { intent: !legal.canCheck && legal.callAmount === pre.amount ? { type: "call" } : null, clear: true };
  }
}

export function samePreAction(a: TxPreAction | null, b: TxPreAction): boolean {
  return !!a && a.kind === b.kind && (a.kind !== "call" || (b.kind === "call" && a.amount === b.amount));
}
