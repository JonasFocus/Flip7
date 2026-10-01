import { MAX_OUTSIDE, MIN_BET, SEATS, isRlSpot } from "./rules.ts";
import type { RlIntent } from "./types.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOnly = (o: Record<string, unknown>, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

export function parseRlIntent(v: unknown): RlIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "sit":
      return hasOnly(v, ["type", "seat"]) && typeof v.seat === "number" && Number.isInteger(v.seat) && v.seat >= 0 && v.seat < SEATS
        ? { type: "sit", seat: v.seat }
        : null;
    case "place":
      return hasOnly(v, ["type", "spot", "amount"]) &&
        isRlSpot(v.spot) &&
        typeof v.amount === "number" &&
        Number.isInteger(v.amount) &&
        v.amount >= MIN_BET &&
        v.amount <= MAX_OUTSIDE
        ? { type: "place", spot: v.spot, amount: v.amount }
        : null;
    case "standUp":
    case "undo":
    case "clear":
    case "rebet":
    case "double":
    case "ready":
    case "rebuy":
      return hasOnly(v, ["type"]) ? { type: v.type } : null;
    default:
      return null;
  }
}
