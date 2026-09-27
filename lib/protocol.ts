// WebSocket wire protocol between the Next.js client and the Railway game server.
import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "./engine/types.ts";
import type { ImposterIntent, ImposterState } from "./imposter/types.ts";
import type { DiceIntent, DiceState } from "./liarsdice/types.ts";
import type { PotatoIntent, PotatoState } from "./hotpotato/types.ts";
import type { SpyIntent, SpyState } from "./spyfall/types.ts";

// Party games share one engine shape (lib/liarsdice, lib/hotpotato, lib/spyfall), so the server drives them from one table.
export interface PartyGames {
  liarsdice: { state: DiceState; intent: DiceIntent };
  hotpotato: { state: PotatoState; intent: PotatoIntent };
  spyfall: { state: SpyState; intent: SpyIntent };
}
export type PartyMode = keyof PartyGames;
// game is redacted per viewer. deadlineInMs: relative ms until the game's visibleDeadline (clock-skew safe, like cluesEndsInMs).
export type PartyRoom<M extends PartyMode = PartyMode> = {
  [K in M]: { code: string; mode: K; hostId: string; game: PartyGames[K]["state"]; deadlineInMs?: number };
}[M];
export type PartyMessage<M extends PartyMode = PartyMode> = { [K in M]: { t: K; intent: PartyGames[K]["intent"] } }[M];

export const ROOM_MODES = ["virtual", "physical", "imposter", "liarsdice", "hotpotato", "spyfall"] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const isRoomMode = (v: unknown): v is RoomMode => ROOM_MODES.some((m) => m === v);
export const isPartyMode = (v: RoomMode): v is PartyMode => v === "liarsdice" || v === "hotpotato" || v === "spyfall";

export type Room =
  // autoPlay: the awaited player is disconnected; the server acts for them in `inMs`.
  // nextRoundInMs: roundOver only; the server deals the next round itself after this long (relative, so phone clock skew can't desync it).
  | { code: string; mode: "virtual"; hostId: string; game: GameState; autoPlay?: { playerId: string; inMs: number }; nextRoundInMs?: number }
  | { code: string; mode: "physical"; hostId: string; game: ScoreState }
  // game is redacted per viewer (lib/imposter redactImposter). cluesEndsInMs: clues phase only, relative ms until voting auto-starts.
  | { code: string; mode: "imposter"; hostId: string; game: ImposterState; cluesEndsInMs?: number }
  | PartyRoom;

export interface RoomSummary {
  code: string;
  mode: RoomMode;
  hostName: string;
  playerCount: number;
  joinable: boolean; // physical: always until gameOver; every other mode: lobby only
  lastActive: number;
}

export type ClientMessage =
  | { t: "create"; mode: RoomMode; name: string; clientId: string }
  | { t: "join"; code: string; name: string; clientId: string }
  | { t: "leave" }
  | { t: "intent"; intent: Intent }
  | { t: "score"; intent: ScoreIntent }
  | { t: "imposter"; intent: ImposterIntent }
  | PartyMessage
  | { t: "addBot" } // host, virtual lobby
  | { t: "removePlayer"; playerId: string } // host, lobby
  | { t: "ping" };

export type ServerMessage =
  | { t: "room"; room: Room; you: string; events: GameEvent[] } // full redacted snapshot after every change
  | { t: "error"; message: string }
  | { t: "pong" };

// HTTP on the same server: GET /rooms → RoomSummary[] (active in last 2h), GET /health → "ok".
export const MAX_PLAYERS = 10;
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

// Error/close reasons the client reacts to specifically; shared so the strings can't drift.
export const KICKED_MESSAGE = "You were removed from the room";
export const REPLACED_CLOSE_CODE = 4001; // same clientId joined from another tab
export const REPLACED_MESSAGE = "Opened in another tab";

// Round over → next round deals itself: the final beats reveal, ~6s to read the summary, then a 3-2-1.
export const ROUND_READ_MS = 6000;
export const ROUND_COUNTDOWN_MS = 3000;
// ponytail: estimates the table's reveal (components/table/useReveal.ts, ~1.04s per narrated beat + 1.56s end hold);
// generous on purpose, a late summary just reads a little shorter. Share the constants if the pacing gets retuned often.
export function nextRoundDelayMs(events: GameEvent[]): number {
  const beats = events.filter((e) => e.type !== "roundEnd" && e.type !== "gameOver" && e.type !== "bust" && e.type !== "secondChanceUsed").length;
  return Math.min(beats, 12) * 1100 + 1600 + ROUND_READ_MS + ROUND_COUNTDOWN_MS;
}
