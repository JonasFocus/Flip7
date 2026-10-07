// Wire shapes of the game server's /admin endpoints, shared by server/activity.ts and the /admin page.
import type { RoomMode } from "./protocol.ts";

export const ACTIVITY_KINDS = ["create", "join", "rejoin", "start", "action", "addBot", "leave", "drop", "kicked"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  id: number;
  at: number;
  kind: ActivityKind;
  player: string; // anonymous device id (public hash of the client's id), "" for room-level events
  name: string;
  code: string;
  mode: RoomMode | null;
  device: string;
  ms: number | null; // time spent in the room, on the event that ends a visit (leave, drop, kicked)
  detail: unknown; // the intent for actions, player count for start
}

export interface ModeStats {
  mode: RoomMode;
  tables: number; // tables created
  starts: number;
  players: number;
  visits: number;
  avgMs: number;
  totalMs: number;
}

export interface PlayerStats {
  player: string;
  name: string;
  device: string;
  visits: number;
  actions: number;
  avgMs: number;
  totalMs: number;
  firstSeen: number;
  lastSeen: number;
  favorite: RoomMode | null;
}

export interface DayStats {
  day: string; // YYYY-MM-DD, UTC
  players: number;
  visits: number;
  totalMs: number;
}

export interface LiveTable {
  code: string;
  mode: RoomMode;
  phase: string;
  players: { name: string; online: boolean }[];
  idleMs: number;
}

export interface AdminStats {
  days: number | null; // window, null = all time
  players: number;
  visits: number;
  avgMs: number;
  totalMs: number;
  tables: number;
  starts: number;
  actions: number;
  modes: ModeStats[];
  topPlayers: PlayerStats[];
  daily: DayStats[];
  live: LiveTable[];
  persistent: boolean; // false when the log only lives in memory (wiped on restart)
  since: number | null; // oldest event kept
}

export interface AdminEvents {
  events: ActivityEvent[];
  more: boolean;
}
