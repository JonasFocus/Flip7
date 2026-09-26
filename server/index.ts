import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  BOT_NAMES,
  addPlayer,
  addScoreSeat,
  applyIntent,
  applyScoreIntent,
  awaitingPlayerId,
  chooseBotIntent,
  createGame,
  createScoreGame,
  redactGame,
  removePlayer,
  setConnected,
} from "../lib/engine/index.ts";
import type { GameEvent } from "../lib/engine/types.ts";
import { MAX_PLAYERS, ROOM_TTL_MS } from "../lib/protocol.ts";
import type { ClientMessage, Room, RoomSummary, ServerMessage } from "../lib/protocol.ts";
import { parseMessage } from "./validate.ts";

const MAX_PAYLOAD = 8 * 1024;
const MAX_MSGS_PER_SEC = 30;
const HEARTBEAT_MS = 30_000;
const CLEANUP_MS = 5 * 60_000;

interface LiveRoom {
  room: Room;
  lastActive: number;
  creatorId: string; // gets host back on return, so a reload or flaky signal doesn't cost the creator the room
  botTimer: NodeJS.Timeout | null;
}

interface Client {
  ws: WebSocket;
  clientId: string | null;
  code: string | null;
  name: string;
  alive: boolean;
  windowStart: number;
  count: number;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

export function startServer(port: number): Promise<RunningServer> {
  const rooms = new Map<string, LiveRoom>();
  // ponytail: linear scans over all sockets per broadcast; index sockets by room if this ever hosts thousands.
  const clients = new Set<Client>();

  const send = (c: Client, msg: ServerMessage) => {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const fail = (c: Client, message: string) => send(c, { t: "error", message });
  const inRoom = (code: string) => [...clients].filter((c) => c.code === code && c.clientId !== null);
  const isOnline = (code: string, id: string) => inRoom(code).some((c) => c.clientId === id);

  function newCode(): string {
    for (;;) {
      const code = String(randomInt(100000, 1000000));
      if (!rooms.has(code)) return code;
    }
  }

  function redact(room: Room): Room {
    return room.mode === "virtual" ? { ...room, game: redactGame(room.game) } : room;
  }

  function broadcast(live: LiveRoom, events: GameEvent[]) {
    const room = redact(live.room);
    for (const c of inRoom(room.code)) {
      if (c.clientId) send(c, { t: "room", room, you: c.clientId, events });
    }
  }

  function ensureHost(live: LiveRoom) {
    const { room } = live;
    const humans =
      room.mode === "virtual"
        ? room.game.players.filter((p) => !p.isBot).map((p) => p.id)
        : room.game.players.map((p) => p.ownerId);
    const eligible = (id: string) => isOnline(room.code, id) && (room.mode === "physical" || humans.includes(id));
    if (eligible(live.creatorId)) {
      room.hostId = live.creatorId;
      return;
    }
    if (eligible(room.hostId)) return;
    const next = humans.find(eligible) ?? (room.mode === "physical" ? inRoom(room.code)[0]?.clientId : undefined);
    if (next) room.hostId = next;
  }

  function changed(live: LiveRoom, events: GameEvent[]) {
    live.lastActive = Date.now();
    ensureHost(live);
    broadcast(live, events);
    scheduleBot(live);
  }

  function deleteRoom(code: string) {
    const live = rooms.get(code);
    if (live?.botTimer) clearTimeout(live.botTimer);
    rooms.delete(code);
  }

  function scheduleBot(live: LiveRoom) {
    if (live.botTimer) clearTimeout(live.botTimer);
    live.botTimer = null;
    const { room } = live;
    if (room.mode !== "virtual" || inRoom(room.code).length === 0) return;
    const game = room.game;
    const botId = awaitingPlayerId(game);
    if (!botId || !game.players.find((p) => p.id === botId)?.isBot) return;
    const delay = game.pending?.type === "flipThree" ? 450 : 700 + Math.random() * 500;
    const seq = game.seq;
    live.botTimer = setTimeout(() => {
      live.botTimer = null;
      const current = live.room;
      if (current.mode !== "virtual" || current.game.seq !== seq) return;
      const intent = chooseBotIntent(current.game, botId);
      if (!intent) return;
      const res = applyIntent(current.game, botId, intent, { isHost: false });
      if (!res.ok) {
        console.error(`bot ${botId} in ${current.code}: ${res.error}`);
        return;
      }
      current.game = res.state;
      changed(live, res.events);
    }, delay);
  }

  function detach(c: Client, leaving: boolean) {
    const code = c.code;
    const id = c.clientId;
    c.code = null;
    const live = code ? rooms.get(code) : undefined;
    if (!live || !id) return;
    const { room } = live;
    if (room.mode === "virtual") {
      const stillConnected = isOnline(room.code, id);
      if (leaving) room.game = removePlayer(room.game, id);
      else if (!stillConnected) room.game = setConnected(room.game, id, false);
      if (!room.game.players.some((p) => !p.isBot)) return deleteRoom(room.code);
    }
    changed(live, []);
  }

  function attach(c: Client, live: LiveRoom, clientId: string, name: string) {
    for (const other of clients) {
      if (other !== c && other.clientId === clientId && other.code === live.room.code) {
        other.code = null;
        other.ws.close(4001, "Opened in another tab");
      }
    }
    c.clientId = clientId;
    c.name = name;
    c.code = live.room.code;
    changed(live, []);
  }

  function create(c: Client, mode: Room["mode"], name: string, clientId: string) {
    const code = newCode();
    const room: Room =
      mode === "virtual"
        ? { code, mode, hostId: clientId, game: addPlayer(createGame(), { id: clientId, name, isBot: false }) }
        : { code, mode, hostId: clientId, game: addScoreSeat(createScoreGame(), { id: clientId, name, ownerId: clientId }) };
    const live: LiveRoom = { room, lastActive: Date.now(), creatorId: clientId, botTimer: null };
    rooms.set(code, live);
    attach(c, live, clientId, name);
  }

  function join(c: Client, code: string, name: string, clientId: string) {
    const live = rooms.get(code);
    if (!live) return fail(c, "Room not found");
    const { room } = live;
    if (room.mode === "virtual") {
      if (room.game.players.some((p) => p.id === clientId)) {
        room.game = setConnected(room.game, clientId, true);
      } else if (room.game.phase !== "lobby") {
        return fail(c, "Game already started");
      } else if (room.game.players.length >= MAX_PLAYERS) {
        return fail(c, "Room is full");
      } else {
        room.game = addPlayer(room.game, { id: clientId, name, isBot: false });
      }
    } else if (!room.game.players.some((p) => p.ownerId === clientId)) {
      if (room.game.phase === "gameOver") return fail(c, "Game is over");
      if (room.game.players.length >= MAX_PLAYERS) return fail(c, "Room is full");
      room.game = addScoreSeat(room.game, { id: clientId, name, ownerId: clientId });
    }
    attach(c, live, clientId, name);
  }

  function addBot(c: Client, live: LiveRoom) {
    const { room } = live;
    if (room.mode !== "virtual") return fail(c, "Bots are only for virtual rooms");
    if (room.game.phase !== "lobby") return fail(c, "Game already started");
    if (room.game.players.length >= MAX_PLAYERS) return fail(c, "Room is full");
    const taken = new Set(room.game.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${room.game.players.length + 1}`;
    room.game = addPlayer(room.game, { id: `bot-${randomUUID().slice(0, 8)}`, name, isBot: true });
    changed(live, []);
  }

  function kick(c: Client, live: LiveRoom, playerId: string) {
    const { room } = live;
    if (room.mode !== "virtual") return fail(c, "Use seat removal in scorekeeper rooms");
    if (room.game.phase !== "lobby") return fail(c, "Can only remove players in the lobby");
    if (playerId === c.clientId) return fail(c, "Use leave instead");
    if (!room.game.players.some((p) => p.id === playerId)) return fail(c, "No such player");
    room.game = removePlayer(room.game, playerId);
    for (const other of inRoom(room.code)) {
      if (other.clientId === playerId) {
        fail(other, "You were removed from the room");
        other.code = null;
      }
    }
    changed(live, []);
  }

  function handle(c: Client, msg: ClientMessage) {
    switch (msg.t) {
      case "ping":
        return send(c, { t: "pong" });
      case "create":
        detach(c, false);
        return create(c, msg.mode, msg.name, msg.clientId);
      case "join":
        detach(c, false);
        return join(c, msg.code, msg.name, msg.clientId);
      case "leave":
        return detach(c, true);
    }
    const live = c.code ? rooms.get(c.code) : undefined;
    if (!live || !c.clientId) return fail(c, "Not in a room");
    const isHost = live.room.hostId === c.clientId;
    switch (msg.t) {
      case "intent": {
        if (live.room.mode !== "virtual") return fail(c, "Not a virtual room");
        const res = applyIntent(live.room.game, c.clientId, msg.intent, { isHost });
        if (!res.ok) return fail(c, res.error);
        live.room.game = res.state;
        return changed(live, res.events);
      }
      case "score": {
        if (live.room.mode !== "physical") return fail(c, "Not a scorekeeper room");
        const res = applyScoreIntent(live.room.game, c.clientId, msg.intent, { isHost, seatName: c.name });
        if (!res.ok) return fail(c, res.error);
        live.room.game = res.state;
        return changed(live, []);
      }
      case "addBot":
        return isHost ? addBot(c, live) : fail(c, "Only the host can add bots");
      case "removePlayer":
        return isHost ? kick(c, live, msg.playerId) : fail(c, "Only the host can remove players");
    }
  }

  function summaries(): RoomSummary[] {
    const cutoff = Date.now() - ROOM_TTL_MS;
    return [...rooms.values()]
      .filter((l) => l.lastActive >= cutoff)
      .sort((a, b) => b.lastActive - a.lastActive)
      .map(({ room, lastActive }) => {
        const hostName =
          room.mode === "virtual"
            ? room.game.players.find((p) => p.id === room.hostId)?.name
            : room.game.players.find((p) => p.ownerId === room.hostId)?.name;
        return {
          code: room.code,
          mode: room.mode,
          hostName: hostName ?? "?",
          playerCount: room.game.players.length,
          joinable: room.mode === "virtual" ? room.game.phase === "lobby" : room.game.phase !== "gameOver",
          lastActive,
        };
      });
  }

  const http = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
    } else if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    } else if (req.method === "GET" && path === "/rooms") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(summaries()));
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    }
  });

  const wss = new WebSocketServer({ server: http, maxPayload: MAX_PAYLOAD });

  wss.on("connection", (ws) => {
    const c: Client = { ws, clientId: null, code: null, name: "", alive: true, windowStart: Date.now(), count: 0 };
    clients.add(c);
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      const now = Date.now();
      if (now - c.windowStart >= 1000) {
        c.windowStart = now;
        c.count = 0;
      }
      if (++c.count > MAX_MSGS_PER_SEC) return;
      c.alive = true;
      const msg = isBinary ? null : parseMessage(data.toString());
      if (!msg) return fail(c, "Invalid message");
      try {
        handle(c, msg);
      } catch (err) {
        console.error("handler error", err);
        fail(c, "Server error");
      }
    });
    ws.on("close", () => {
      clients.delete(c);
      try {
        detach(c, false);
      } catch (err) {
        console.error("detach error", err);
      }
    });
    ws.on("error", (err) => console.error("socket error", err.message));
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [code, live] of rooms) {
      if (live.lastActive < cutoff && inRoom(code).length === 0) deleteRoom(code);
    }
  }, CLEANUP_MS);

  return new Promise((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, () => {
      const addr = http.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actual,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            clearInterval(cleanup);
            for (const code of [...rooms.keys()]) deleteRoom(code);
            for (const c of clients) c.ws.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  startServer(port).then(
    (s) => console.log(`flip7 server listening on :${s.port}`),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
