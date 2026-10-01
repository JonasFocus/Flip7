import { SEATS } from "./rules.ts";
import { BAC_SPOTS, type BacIntent, type BacSpot } from "./types.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isSpot = (v: unknown): v is BacSpot => BAC_SPOTS.some((s) => s === v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]): boolean => Object.keys(v).every((k) => k === "type" || keys.includes(k));

export function parseBacIntent(v: unknown): BacIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "sit":
      return onlyKeys(v, ["seat"]) && isInt(v.seat, 0, SEATS - 1) ? { type: "sit", seat: v.seat } : null;
    case "bet":
      return onlyKeys(v, ["spot", "amount"]) && isSpot(v.spot) && isInt(v.amount, 0, 10_000_000) ? { type: "bet", spot: v.spot, amount: v.amount } : null;
    case "standUp":
    case "clearBets":
    case "rebet":
    case "deal":
    case "rebuy":
      return onlyKeys(v, []) ? { type: v.type } : null;
    default:
      return null;
  }
}
