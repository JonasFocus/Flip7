import type { Intent, PhysicalEntry, ScoreIntent } from "../lib/engine/types.ts";
import type { ImposterIntent } from "../lib/imposter/types.ts";
import type { DiceIntent } from "../lib/liarsdice/types.ts";
import type { PotatoIntent } from "../lib/hotpotato/types.ts";
import type { SpyIntent } from "../lib/spyfall/types.ts";
import type { BjIntent } from "../lib/blackjack/types.ts";
import { parseBacIntent } from "../lib/baccarat/validate.ts";
import { parseRlIntent } from "../lib/roulette/validate.ts";
import { parseTxIntent } from "../lib/texasholdem/validate.ts";
import { isRoomMode, type ClientMessage } from "../lib/protocol.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= 64;
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const CODE_RE = /^\d{6}$/;

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const spaced = v.normalize("NFC").replace(/\s+/g, " ");
  // Controls and bidi overrides (which flip the surrounding rail/narration text) and tall combining stacks are rejected outright.
  if (/[\p{Cc}؜‎‏‪-‮⁦-⁩]|\p{M}{3,}/u.test(spaced)) return null;
  // Other invisible format chars and blank lookalikes are dropped; ZWJ stays so family/profession emoji survive.
  const name = spaced.replace(/(?!‍)[\p{Cf}⠀ㅤﾠᅟᅠ]/gu, "").replace(/ +/g, " ").trim();
  return name.length >= 1 && name.length <= 20 && /[\p{L}\p{N}\p{S}]/u.test(name) ? name : null;
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
    case "restart":
    case "endGame":
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
      return isId(v.seatId) && isInt(v.round, 0, 10000) ? { type: "clearEntry", seatId: v.seatId, round: v.round } : null;
    case "submitEntry": {
      const entry = parseEntry(v.entry);
      return isId(v.seatId) && entry && isInt(v.round, 0, 10000)
        ? { type: "submitEntry", seatId: v.seatId, entry, round: v.round }
        : null;
    }
    case "setGoal":
      return isInt(v.goal, 1, 10000) ? { type: "setGoal", goal: v.goal } : null;
    case "finishRound":
    case "undoRound":
      return isInt(v.round, 0, 10000) ? { type: v.type, round: v.round } : null;
    case "start":
    case "playAgain":
      return { type: v.type };
    default:
      return null;
  }
}

function parseImposterIntent(v: unknown): ImposterIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "setCategory":
      return typeof v.categoryId === "string" && v.categoryId.length >= 1 && v.categoryId.length <= 40
        ? { type: "setCategory", categoryId: v.categoryId }
        : null;
    case "setTimer":
      return v.sec === 90 || v.sec === 120 || v.sec === 300 ? { type: "setTimer", sec: v.sec } : null;
    case "vote":
      return isId(v.targetId) ? { type: "vote", targetId: v.targetId } : null;
    case "start":
    case "startVoting":
    case "nextRound":
    case "playAgain":
      return { type: v.type };
    default:
      return null;
  }
}

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length >= 1 && v.length <= max;

function parseDiceIntent(v: unknown): DiceIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "setDice":
      return v.count === 3 || v.count === 4 || v.count === 5 ? { type: "setDice", count: v.count } : null;
    case "bid":
      return isInt(v.count, 1, 40) && isInt(v.face, 2, 6) ? { type: "bid", count: v.count, face: v.face } : null;
    case "start":
    case "liar":
    case "nextRound":
    case "playAgain":
      return { type: v.type };
    default:
      return null;
  }
}

function parsePotatoIntent(v: unknown): PotatoIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "setLives":
      return v.lives === 1 || v.lives === 2 || v.lives === 3 || v.lives === 5 ? { type: "setLives", lives: v.lives } : null;
    case "setCategory":
      return isText(v.categoryId, 40) ? { type: "setCategory", categoryId: v.categoryId } : null;
    case "start":
    case "pass":
    case "playAgain":
      return { type: v.type };
    default:
      return null;
  }
}

function parseSpyIntent(v: unknown): SpyIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "setTimer":
      return v.minutes === 4 || v.minutes === 6 || v.minutes === 8 ? { type: "setTimer", minutes: v.minutes } : null;
    case "guess":
      return isText(v.location, 60) ? { type: "guess", location: v.location } : null;
    case "vote":
      return isId(v.targetId) ? { type: "vote", targetId: v.targetId } : null;
    case "start":
    case "startVoting":
    case "playAgain":
      return { type: v.type };
    default:
      return null;
  }
}

function parseBjIntent(v: unknown): BjIntent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case "sit":
      return isInt(v.seat, 0, 9) ? { type: "sit", seat: v.seat } : null;
    case "bet":
      return isInt(v.amount, 0, 10_000_000) ? { type: "bet", amount: v.amount } : null;
    case "standUp":
    case "deal":
    case "hit":
    case "stand":
    case "double":
    case "rebuy":
      return { type: v.type };
    default:
      return null;
  }
}

// A create for a game this server build doesn't know yet (the website deployed ahead of the server).
export function isUnknownGame(raw: string): boolean {
  try {
    const v: unknown = JSON.parse(raw);
    return isObj(v) && v.t === "create" && typeof v.mode === "string" && !isRoomMode(v.mode);
  } catch {
    return false;
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
      if (!name || !isId(v.clientId) || !isRoomMode(v.mode)) return null;
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
    case "imposter": {
      const intent = parseImposterIntent(v.intent);
      return intent ? { t: "imposter", intent } : null;
    }
    case "liarsdice": {
      const intent = parseDiceIntent(v.intent);
      return intent ? { t: "liarsdice", intent } : null;
    }
    case "hotpotato": {
      const intent = parsePotatoIntent(v.intent);
      return intent ? { t: "hotpotato", intent } : null;
    }
    case "spyfall": {
      const intent = parseSpyIntent(v.intent);
      return intent ? { t: "spyfall", intent } : null;
    }
    case "blackjack": {
      const intent = parseBjIntent(v.intent);
      return intent ? { t: "blackjack", intent } : null;
    }
    case "baccarat": {
      const intent = parseBacIntent(v.intent);
      return intent ? { t: "baccarat", intent } : null;
    }
    case "roulette": {
      const intent = parseRlIntent(v.intent);
      return intent ? { t: "roulette", intent } : null;
    }
    case "texasholdem": {
      const intent = parseTxIntent(v.intent);
      return intent ? { t: "texasholdem", intent } : null;
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
