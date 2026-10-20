import { BIG_BLIND } from "./rules.ts";

// Chip buttons add whole big blinds to the raise: +1 BB, +5 BB, +10 BB.
export const RAISE_CHIPS = [1, 5, 10] as const;

// How long Fold must be held before it goes through.
export const FOLD_HOLD_MS = 3000;

// Keep a raise-to amount inside what is legal: at least the minimum raise, at most the stack.
export function clampRaise(amount: number, minRaiseTo: number, maxRaiseTo: number): number {
  const n = Number.isNaN(amount) ? minRaiseTo : Math.round(amount);
  return Math.min(maxRaiseTo, Math.max(minRaiseTo, n));
}

// Stack a chip of `bigBlinds` big blinds onto the current amount (negative removes them), never leaving the legal range.
export function stackRaise(current: number, bigBlinds: number, minRaiseTo: number, maxRaiseTo: number): number {
  return clampRaise(clampRaise(current, minRaiseTo, maxRaiseTo) + bigBlinds * BIG_BLIND, minRaiseTo, maxRaiseTo);
}
