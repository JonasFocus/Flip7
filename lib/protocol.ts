// WebSocket wire protocol between the Next.js client and the Railway game server.
import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "./engine/types.ts";

export type RoomMode = "virtual" | "physical";

export type Room =
  // autoPlay: the awaited player is disconnected; the server acts for them in `inMs`.
  | { code: string; mode: "virtual"; hostId: string; game: GameState; autoPlay?: { playerId: string; inMs: number } }
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
