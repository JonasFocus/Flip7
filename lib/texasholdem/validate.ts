import type { TxIntent } from "./types.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const onlyKeys = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).every((k) => k === "type" || keys.includes(k));

export function parseTxIntent(v: unknown): TxIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "sit":
      return onlyKeys(v, ["seat"]) && isInt(v.seat, 0, 9) ? { type: "sit", seat: v.seat } : null;
    case "bet":
      return onlyKeys(v, ["amount"]) && isInt(v.amount, 1, 1_000_000_000) ? { type: "bet", amount: v.amount } : null;
    case "standUp":
    case "sitOut":
    case "sitIn":
    case "rebuy":
    case "fold":
    case "check":
    case "call":
    case "allIn":
    case "show":
      return onlyKeys(v, []) ? { type: v.type } : null;
    default:
      return null;
  }
}
