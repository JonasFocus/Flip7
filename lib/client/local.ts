import { addPlayer, applyIntent, BOT_NAMES, createGame } from "../engine/index.ts";
import type { GameEvent, GameState } from "../engine/types.ts";

export const LOCAL_ME = "me";
const KEY = "flip7:solo";

export interface LocalSave {
  game: GameState;
  events: GameEvent[];
}

export function withBot(s: GameState): GameState {
  const used = new Set(s.players.map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${s.players.length}`;
  let n = 1;
  while (s.players.some((p) => p.id === `bot-${n}`)) n++;
  return addPlayer(s, { id: `bot-${n}`, name, isBot: true });
}

export function newLocalGame(name: string, botCount: number): GameState {
  let s = addPlayer(createGame(), { id: LOCAL_ME, name: name.trim() || "You", isBot: false });
  for (let i = 0; i < botCount; i++) s = withBot(s);
  // Solo has nobody to wait for, so you start ready.
  const ready = applyIntent(s, LOCAL_ME, { type: "ready", ready: true }, { isHost: true });
  if (!ready.ok) throw new Error(ready.error);
  return { ...ready.state, seq: 0, lastEvents: [] };
}

export function botDelay(s: GameState, rand: () => number = Math.random): number {
  return s.pending?.type === "flipThree" ? 455 + rand() * 325 : 910 + rand() * 520;
}

function isLocalSave(x: unknown): x is LocalSave {
  if (typeof x !== "object" || x === null || !("game" in x) || !("events" in x)) return false;
  const game = x.game;
  return (
    Array.isArray(x.events) &&
    typeof game === "object" &&
    game !== null &&
    "players" in game &&
    Array.isArray(game.players) &&
    game.players.some((p: unknown) => typeof p === "object" && p !== null && "id" in p && p.id === LOCAL_ME)
  );
}

export function loadLocal(): LocalSave | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return isLocalSave(data) ? data : null;
  } catch {
    return null;
  }
}

export function saveLocal(save: LocalSave | null): void {
  try {
    if (save) sessionStorage.setItem(KEY, JSON.stringify(save));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage full/blocked: game keeps running, it just won't survive a refresh
  }
}
