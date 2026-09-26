import type { ClientMessage, RoomMode, RoomSummary, ServerMessage } from "../protocol.ts";
import { getClientId } from "./identity.ts";

export function wsUrl(): string {
  return (process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8787").replace(/\/+$/, "");
}

export function httpUrl(): string {
  return wsUrl().replace(/^ws/, "http");
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

// ponytail: shallow check of our own server's messages; deep validation lives server-side
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(msg)) return null;
  if (msg.t === "pong") return { t: "pong" };
  if (msg.t === "error" && typeof msg.message === "string") return { t: "error", message: msg.message };
  if (msg.t === "room" && isServerRoomMessage(msg)) return msg;
  return null;
}

function isServerRoomMessage(msg: Record<string, unknown>): msg is Extract<ServerMessage, { t: "room" }> {
  const room = msg.room;
  return (
    typeof msg.you === "string" &&
    Array.isArray(msg.events) &&
    isObject(room) &&
    typeof room.code === "string" &&
    typeof room.hostId === "string" &&
    (room.mode === "virtual" || room.mode === "physical") &&
    isObject(room.game) &&
    Array.isArray(room.game.players)
  );
}

function isRoomSummary(x: unknown): x is RoomSummary {
  return (
    isObject(x) &&
    typeof x.code === "string" &&
    (x.mode === "virtual" || x.mode === "physical") &&
    typeof x.hostName === "string" &&
    typeof x.playerCount === "number" &&
    typeof x.joinable === "boolean" &&
    typeof x.lastActive === "number"
  );
}

export async function fetchOpenRooms(signal?: AbortSignal): Promise<RoomSummary[]> {
  const res = await fetch(`${httpUrl()}/rooms`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`Could not load tables (${res.status})`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("Unexpected response from game server");
  return data.filter(isRoomSummary);
}

// Opens a short-lived socket, creates the room and resolves its code. The room
// page then joins with the same clientId, which the server resumes as the host seat.
export function createRoom(mode: RoomMode, name: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      reject(new Error("Could not reach the game server"));
      return;
    }
    let done = false;
    const finish = (result: { code: string } | { error: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      if ("code" in result) resolve(result.code);
      else reject(new Error(result.error));
    };
    const timer = setTimeout(() => finish({ error: "Game server took too long to respond" }), timeoutMs);
    ws.onopen = () => {
      const msg: ClientMessage = { t: "create", mode, name: name.trim(), clientId: getClientId() };
      ws.send(JSON.stringify(msg));
    };
    ws.onmessage = (e) => {
      const msg = parseServerMessage(e.data);
      if (msg?.t === "room") finish({ code: msg.room.code });
      else if (msg?.t === "error") finish({ error: msg.message });
    };
    ws.onclose = () => finish({ error: "Could not reach the game server" });
  });
}
