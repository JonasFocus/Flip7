// WebSocket wire protocol between the Next.js client and the Railway game server.
import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "./engine/types.ts";

export type RoomMode = "virtual" | "physical";

export type Room =
  // autoPlay: the awaited player is disconnected; the server acts for them in `inMs`.
  // nextRoundInMs: roundOver only; the server deals the next round itself after this long (relative, so phone clock skew can't desync it).
  | { code: string; mode: "virtual"; hostId: string; game: GameState; autoPlay?: { playerId: string; inMs: number }; nextRoundInMs?: number }
  | { code: string; mode: "physical"; hostId: string; game: ScoreState };

export interface RoomSummary {
  code: string;
  mode: RoomMode;
  hostName: string;
  playerCount: number;
  joinable: boolean; // virtual: lobby only; physical: always until gameOver
  lastActive: number;
}

export type ClientMessage =
  | { t: "create"; mode: RoomMode; name: string; clientId: string }
  | { t: "join"; code: string; name: string; clientId: string }
  | { t: "leave" }
  | { t: "intent"; intent: Intent }
  | { t: "score"; intent: ScoreIntent }
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
