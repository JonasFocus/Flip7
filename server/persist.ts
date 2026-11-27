import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isRoomMode, type Room } from "../lib/protocol.ts";
import type { GameEvent } from "../lib/engine/types.ts";

// Tables written to disk so a deploy or crash restart picks the games up where they were.
// On Railway the file belongs on the volume (RAILWAY_VOLUME_MOUNT_PATH), like the activity log.

export interface SavedRoom {
  room: Room;
  creatorId: string;
  lastActive: number;
  kicked: string[];
  phase: string;
  awayStays: [string, { round: number; event: GameEvent }][];
}

const VERSION = 1;

export function saveRooms(path: string, rooms: SavedRoom[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: VERSION, savedAt: Date.now(), rooms }));
  renameSync(tmp, path); // atomic: a kill mid-write leaves the previous snapshot intact
}

// Missing, unreadable or unknown-version files mean a fresh start, never a crash.
export function loadRooms(path: string): SavedRoom[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || !("v" in data) || data.v !== VERSION || !("rooms" in data) || !Array.isArray(data.rooms)) return [];
    return data.rooms.filter(isSavedRoom);
  } catch (err) {
    console.error("could not read saved tables", err);
    return [];
  }
}

function isSavedRoom(v: unknown): v is SavedRoom {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<SavedRoom>;
  return (
    typeof r.room === "object" && r.room !== null &&
    typeof r.room.code === "string" && isRoomMode(r.room.mode) &&
    typeof r.room.hostId === "string" &&
    typeof r.room.game === "object" && r.room.game !== null && Array.isArray(r.room.game.players) &&
    typeof r.creatorId === "string" && typeof r.lastActive === "number" &&
    Array.isArray(r.kicked) && typeof r.phase === "string" && Array.isArray(r.awayStays)
  );
}
