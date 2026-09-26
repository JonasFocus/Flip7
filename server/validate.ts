import type { Intent, PhysicalEntry, ScoreIntent } from "../lib/engine/types.ts";
import type { ClientMessage } from "../lib/protocol.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const CODE_RE = /^\d{6}$/;

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= 20 ? name : null;
}

function parseIntent(v: unknown): Intent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "ready":
      return typeof v.ready === "boolean" ? { type: "ready", ready: v.ready } : null;
    case "start":
    case "hit":
    case "stay":
    case "nextRound":
    case "playAgain":
      return { type: v.type };
    case "chooseTarget":
      return isId(v.targetId) ? { type: "chooseTarget", targetId: v.targetId } : null;
    default:
      return null;
  }
}

function parseEntry(v: unknown): PhysicalEntry | null {
  if (!isObj(v) || typeof v.x2 !== "boolean" || typeof v.busted !== "boolean") return null;
  if (!Array.isArray(v.numbers) || !Array.isArray(v.plus)) return null;
  const numbers: number[] = [];
  for (const n of v.numbers) {
    if (!isInt(n, 0, 12) || numbers.includes(n)) return null;
    numbers.push(n);
  }
  const plus: number[] = [];
  for (const p of v.plus) {
    if (!isInt(p, 2, 10) || p % 2 !== 0 || plus.includes(p)) return null;
    plus.push(p);
  }
  return { numbers, x2: v.x2, plus, busted: v.busted };
}

function parseScoreIntent(v: unknown): ScoreIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "addSeat": {
      const name = cleanName(v.name);
      return name ? { type: "addSeat", name } : null;
    }
    case "removeSeat":
      return isId(v.seatId) ? { type: "removeSeat", seatId: v.seatId } : null;
    case "clearEntry":
      return isId(v.seatId) ? { type: "clearEntry", seatId: v.seatId } : null;
    case "submitEntry": {
      const entry = parseEntry(v.entry);
      return isId(v.seatId) && entry ? { type: "submitEntry", seatId: v.seatId, entry } : null;
    }
    case "setGoal":
      return isInt(v.goal, 1, 10000) ? { type: "setGoal", goal: v.goal } : null;
    case "start":
    case "finishRound":
    case "undoRound":
    case "playAgain":
      return { type: v.type };
    default:
      return null;
  }
}

export function parseMessage(raw: string): ClientMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.t) {
    case "create": {
      const name = cleanName(v.name);
      if (!name || !isId(v.clientId) || (v.mode !== "virtual" && v.mode !== "physical")) return null;
      return { t: "create", mode: v.mode, name, clientId: v.clientId };
    }
    case "join": {
      const name = cleanName(v.name);
      if (!name || !isId(v.clientId) || typeof v.code !== "string" || !CODE_RE.test(v.code)) return null;
      return { t: "join", code: v.code, name, clientId: v.clientId };
    }
    case "intent": {
      const intent = parseIntent(v.intent);
      return intent ? { t: "intent", intent } : null;
    }
    case "score": {
      const intent = parseScoreIntent(v.intent);
      return intent ? { t: "score", intent } : null;
    }
    case "removePlayer":
      return isId(v.playerId) ? { t: "removePlayer", playerId: v.playerId } : null;
    case "leave":
    case "addBot":
    case "ping":
      return { t: v.t };
    default:
      return null;
  }
}
