import { createHash, randomInt, randomUUID } from "node:crypto";
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
import type { GameEvent, Intent } from "../lib/engine/types.ts";
import { KICKED_MESSAGE, MAX_PLAYERS, nextRoundDelayMs, REPLACED_CLOSE_CODE, REPLACED_MESSAGE, ROOM_TTL_MS } from "../lib/protocol.ts";
import type { ClientMessage, Room, RoomSummary, ServerMessage } from "../lib/protocol.ts";
import { parseMessage } from "./validate.ts";

const TOO_MANY_JOINS = "Too many joins, try again in a minute";
const MAX_PAYLOAD = 8 * 1024;
const MAX_MSGS_PER_SEC = 30;
const HEARTBEAT_MS = 30_000;
const CLEANUP_MS = 60_000;
const EMPTY_LOBBY_TTL_MS = 10 * 60_000;
const MAX_ROOMS = 2000;
const CREATES_PER_IP_PER_MIN = 5;
const JOINS_PER_IP_PER_MIN = 20;
const MAX_LISTED_ROOMS = 100;
const MAX_SOCKETS_PER_IP = 50;
export const AUTO_PLAY_MS = 30_000;

// The client's id is a secret resume token; everyone else only ever sees this hash of it (and can't forge a bot's "bot-" id).
export const publicId = (secret: string) => createHash("sha256").update(secret).digest("base64url").slice(0, 22);

interface LiveRoom {
  room: Room;
  lastActive: number;
  creatorId: string; // gets host back on return, so a reload or flaky signal doesn't cost the creator the room
  botTimer: NodeJS.Timeout | null;
  nextRound: { round: number; at: number; timer: NodeJS.Timeout } | null; // roundOver: the server deals the next round at `at`
  disconnectedAt: Map<string, number>; // humans who dropped mid-game; they get auto-played after AUTO_PLAY_MS
  awayStays: Map<string, { round: number; event: GameEvent }>; // auto-stays to replay to that human when they return
  kicked: Set<string>; // virtual: removed by the host, rejoin refused. physical: lost their last seat, rejoin as spectator (Late arrival re-seats on purpose)
}

interface Client {
  ws: WebSocket;
  clientId: string | null;
  code: string | null;
  name: string;
  alive: boolean;
  windowStart: number;
  count: number;
  ip: string;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

export interface ServerOptions {
  autoPlayMs?: number;
  nextRoundMs?: number; // fixed round-over wait instead of the reveal-based one (tests)
  maxRooms?: number;
  createsPerIpPerMin?: number;
  socketsPerIp?: number;
  joinsPerIpPerMin?: number;
}

export function startServer(port: number, opts: ServerOptions = {}): Promise<RunningServer> {
  const autoPlayMs = opts.autoPlayMs ?? AUTO_PLAY_MS;
  const nextRoundMs = (events: GameEvent[]) => opts.nextRoundMs ?? nextRoundDelayMs(events);
  const maxRooms = opts.maxRooms ?? MAX_ROOMS;
  const createsPerIpPerMin = opts.createsPerIpPerMin ?? CREATES_PER_IP_PER_MIN;
  const socketsPerIp = opts.socketsPerIp ?? MAX_SOCKETS_PER_IP;
  const joinsPerIpPerMin = opts.joinsPerIpPerMin ?? JOINS_PER_IP_PER_MIN;
  const rooms = new Map<string, LiveRoom>();
  // ponytail: in-memory per-IP window, pruned by cleanup; fine for one Railway instance.
  const createsByIp = new Map<string, { count: number; windowStart: number }>();
  const joinsByIp = new Map<string, { count: number; windowStart: number }>();
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

  function redact(live: LiveRoom): Room {
    const { room } = live;
    if (room.mode !== "virtual") return room;
    const game = redactGame(room.game);
    const awaited = awaitingPlayerId(game);
    const since = awaited ? live.disconnectedAt.get(awaited) : undefined;
    const autoPlay = awaited && since !== undefined ? { playerId: awaited, inMs: Math.max(0, since + autoPlayMs - Date.now()) } : undefined;
    const nextRoundInMs = live.nextRound ? Math.max(0, live.nextRound.at - Date.now()) : undefined;
    return { ...room, game, autoPlay, nextRoundInMs };
  }

  function broadcast(live: LiveRoom, events: GameEvent[]) {
    const room = redact(live);
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
    const present = inRoom(room.code);
    const online = new Set(present.map((c) => c.clientId));
    const eligible = (id: string) => online.has(id) && (room.mode === "physical" || humans.includes(id));
    if (eligible(live.creatorId)) {
      room.hostId = live.creatorId;
      return;
    }
    if (eligible(room.hostId)) return;
    const next = humans.find(eligible) ?? (room.mode === "physical" ? present[0]?.clientId : undefined);
    if (next) room.hostId = next;
  }

  function changed(live: LiveRoom, events: GameEvent[]) {
    live.lastActive = Date.now();
    ensureHost(live);
    scheduleNextRound(live, events);
    broadcast(live, events);
    scheduleBot(live);
  }

  function deleteRoom(code: string) {
    const live = rooms.get(code);
    if (live?.botTimer) clearTimeout(live.botTimer);
    if (live?.nextRound) clearTimeout(live.nextRound.timer);
    rooms.delete(code);
  }

  // Everyone's phone counts down to the same deal, so nobody waits on the host to tap. Kept across reconnects
  // (same round), dropped on any move out of roundOver (host's "Start now", someone leaving ends the game, delete).
  function scheduleNextRound(live: LiveRoom, events: GameEvent[]) {
    const { room } = live;
    const round = room.mode === "virtual" && room.game.phase === "roundOver" ? room.game.round : null;
    if (live.nextRound && live.nextRound.round === round) return;
    if (live.nextRound) clearTimeout(live.nextRound.timer);
    live.nextRound = null;
    if (round === null || inRoom(room.code).length === 0) return;
    const delay = nextRoundMs(events);
    const timer = setTimeout(() => {
      live.nextRound = null;
      const current = live.room;
      if (current.mode !== "virtual" || current.game.phase !== "roundOver" || current.game.round !== round) return;
      if (inRoom(current.code).length === 0) return; // nobody watching; the next reconnect restarts the wait
      const res = applyIntent(current.game, current.hostId, { type: "nextRound" }, { isHost: true });
      if (!res.ok) {
        console.error(`next round in ${current.code}: ${res.error}`);
        return;
      }
      current.game = res.state;
      changed(live, res.events);
    }, delay);
    live.nextRound = { round, at: Date.now() + delay, timer };
  }

  function scheduleBot(live: LiveRoom) {
    if (live.botTimer) clearTimeout(live.botTimer);
    live.botTimer = null;
    const { room } = live;
    if (room.mode !== "virtual" || inRoom(room.code).length === 0) return;
    const game = room.game;
    const botId = awaitingPlayerId(game);
    const player = game.players.find((p) => p.id === botId);
    if (!botId || !player) return;
    const since = live.disconnectedAt.get(botId);
    if (!player.isBot && (since === undefined || isOnline(room.code, botId))) return;
    const pace = game.pending?.type === "flipThree" ? 585 : 910 + Math.random() * 650;
    const delay = since === undefined ? pace : Math.max(pace, since + autoPlayMs - Date.now());
    const seq = game.seq;
    live.botTimer = setTimeout(() => {
      live.botTimer = null;
      try {
        const current = live.room;
        if (current.mode !== "virtual" || current.game.seq !== seq) return;
        // An absent human just banks on a hit/stay turn; target picks and Flip Three draws need the bot brain.
        const intent: Intent | null = player.isBot || current.game.pending ? chooseBotIntent(current.game, botId) : { type: "stay" };
        if (!intent) return;
        const res = applyIntent(current.game, botId, intent, { isHost: false });
        if (!res.ok) {
          console.error(`bot ${botId} in ${current.code}: ${res.error}`);
          return;
        }
        current.game = res.state;
        const events = player.isBot ? res.events : res.events.map((e) => (e.type === "stay" ? { ...e, auto: true as const } : e));
        const stay = events.find((e) => e.type === "stay");
        if (stay) live.awayStays.set(botId, { round: current.game.round, event: stay });
        changed(live, events);
      } catch (err) {
        console.error("bot error", err);
      }
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
      if (leaving) {
        room.game = removePlayer(room.game, id);
        live.disconnectedAt.delete(id);
      } else if (!stillConnected) {
        room.game = setConnected(room.game, id, false);
        live.disconnectedAt.set(id, Date.now());
      }
      if (!room.game.players.some((p) => !p.isBot)) return deleteRoom(room.code);
    } else if (leaving && room.game.phase === "lobby") {
      // Mid-game seats stay so their round history survives; the host can remove them from the board.
      const gone = new Set(room.game.players.filter((p) => p.ownerId === id).map((p) => p.id));
      const entries = Object.fromEntries(Object.entries(room.game.entries).filter(([seatId]) => !gone.has(seatId)));
      room.game = { ...room.game, players: room.game.players.filter((p) => !gone.has(p.id)), entries };
    }
    // removePlayer can end the round/game; its events live in lastEvents. setConnected keeps stale ones, so only forward on leave.
    changed(live, room.mode === "virtual" && leaving ? room.game.lastEvents : []);
  }

  function attach(c: Client, live: LiveRoom, clientId: string, name: string) {
    for (const other of clients) {
      if (other !== c && other.clientId === clientId && other.code === live.room.code) {
        other.code = null;
        other.ws.close(REPLACED_CLOSE_CODE, REPLACED_MESSAGE);
      }
    }
    c.clientId = clientId;
    c.name = name;
    c.code = live.room.code;
    changed(live, []);
    const away = live.awayStays.get(clientId);
    live.awayStays.delete(clientId);
    const { room } = live;
    // Tell a returning human the server banked for them; stale once the round has moved on.
    if (away && room.mode === "virtual" && room.game.round === away.round) {
      send(c, { t: "room", room: redact(live), you: clientId, events: [away.event] });
    }
  }

  function allow(byIp: Map<string, { count: number; windowStart: number }>, ip: string, limit: number): boolean {
    const now = Date.now();
    const w = byIp.get(ip);
    if (!w || now - w.windowStart >= 60_000) {
      byIp.set(ip, { count: 1, windowStart: now });
      return true;
    }
    return ++w.count <= limit;
  }

  // Full server: drop the stalest lobby nobody is sitting in rather than refusing a real family.
  function makeRoomSpace(): boolean {
    if (rooms.size < maxRooms) return true;
    let oldest: LiveRoom | undefined;
    for (const live of rooms.values()) {
      if (live.room.game.phase !== "lobby" || inRoom(live.room.code).length > 0) continue;
      if (!oldest || live.lastActive < oldest.lastActive) oldest = live;
    }
    if (!oldest) return false;
    deleteRoom(oldest.room.code);
    return true;
  }

  // A lobby this client made and nobody else is in dies when they move on, so repeat creates don't pile up orphans.
  function isSoloLobby(live: LiveRoom, clientId: string): boolean {
    const { room } = live;
    if (room.game.phase !== "lobby") return false;
    return room.mode === "virtual"
      ? !room.game.players.some((p) => !p.isBot && p.id !== clientId)
      : !room.game.players.some((p) => p.ownerId !== clientId) && inRoom(room.code).every((o) => o.clientId === clientId);
  }

  function create(c: Client, mode: Room["mode"], name: string, clientId: string) {
    if (!allow(createsByIp, c.ip, createsPerIpPerMin)) return fail(c, "Too many new tables, try again in a minute");
    if (!makeRoomSpace()) return fail(c, "Server is busy, try again soon");
    const code = newCode();
    const room: Room =
      mode === "virtual"
        ? { code, mode, hostId: clientId, game: addPlayer(createGame(), { id: clientId, name, isBot: false }) }
        : { code, mode, hostId: clientId, game: addScoreSeat(createScoreGame(), { id: clientId, name, ownerId: clientId }) };
    const live: LiveRoom = { room, lastActive: Date.now(), creatorId: clientId, botTimer: null, nextRound: null, disconnectedAt: new Map(), awayStays: new Map(), kicked: new Set() };
    rooms.set(code, live);
    attach(c, live, clientId, name);
  }

  function join(c: Client, code: string, name: string, clientId: string) {
    const live = rooms.get(code);
    if (!live) return fail(c, "Room not found");
    const { room } = live;
    if (room.mode === "virtual") {
      if (live.kicked.has(clientId)) return fail(c, KICKED_MESSAGE);
      if (room.game.players.some((p) => p.id === clientId)) {
        room.game = setConnected(room.game, clientId, true);
        live.disconnectedAt.delete(clientId);
      } else if (room.game.phase !== "lobby") {
        return fail(c, "Game already started");
      } else if (room.game.players.length >= MAX_PLAYERS) {
        return fail(c, "Room is full");
      } else if (!allow(joinsByIp, c.ip, joinsPerIpPerMin)) {
        return fail(c, TOO_MANY_JOINS);
      } else {
        room.game = addPlayer(room.game, { id: clientId, name, isBot: false });
        live.disconnectedAt.delete(clientId);
      }
    } else if (!room.game.players.some((p) => p.ownerId === clientId) && !live.kicked.has(clientId)) {
      if (room.game.phase === "gameOver") return fail(c, "Game is over");
      if (room.game.players.length >= MAX_PLAYERS) return fail(c, "Room is full");
      if (!allow(joinsByIp, c.ip, joinsPerIpPerMin)) return fail(c, TOO_MANY_JOINS);
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
    live.disconnectedAt.delete(playerId);
    live.awayStays.delete(playerId);
    live.kicked.add(playerId);
    for (const other of inRoom(room.code)) {
      if (other.clientId === playerId) {
        fail(other, KICKED_MESSAGE);
        other.code = null;
      }
    }
    changed(live, []);
  }

  // A socket that switches identity gives up its old lobby seat, so one socket can't stack offline ghost seats.
  function detachForSwitch(c: Client, nextId: string) {
    const prev = c.code ? rooms.get(c.code) : undefined;
    detach(c, prev?.room.game.phase === "lobby" && c.clientId !== null && c.clientId !== nextId);
  }

  function handle(c: Client, msg: ClientMessage) {
    switch (msg.t) {
      case "ping":
        return send(c, { t: "pong" });
      case "create": {
        const prev = c.code ? rooms.get(c.code) : undefined;
        const solo = prev !== undefined && c.clientId !== null && isSoloLobby(prev, c.clientId);
        const id = publicId(msg.clientId);
        detachForSwitch(c, id);
        if (prev && solo && inRoom(prev.room.code).length === 0) deleteRoom(prev.room.code);
        return create(c, msg.mode, msg.name, id);
      }
      case "join": {
        const id = publicId(msg.clientId);
        detachForSwitch(c, id);
        return join(c, msg.code, msg.name, id);
      }
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
        if (msg.intent.type === "removeSeat") {
          const { seatId } = msg.intent;
          const ownerId = live.room.game.players.find((p) => p.id === seatId)?.ownerId;
          if (ownerId && !res.state.players.some((p) => p.ownerId === ownerId)) live.kicked.add(ownerId);
        }
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
    const online = new Map<string, number>();
    for (const c of clients) if (c.code && c.clientId) online.set(c.code, (online.get(c.code) ?? 0) + 1);
    return [...rooms.values()]
      // Offline rooms stay listed (not joinable) so home can still offer "Back to your table".
      .filter((l) => l.lastActive >= cutoff)
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, MAX_LISTED_ROOMS)
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
          joinable:
            (online.get(room.code) ?? 0) > 0 &&
            room.game.players.length < MAX_PLAYERS &&
            (room.mode === "virtual" ? room.game.phase === "lobby" : room.game.phase !== "gameOver"),
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

  wss.on("connection", (ws, req) => {
    // Railway's proxy appends the real peer to X-Forwarded-For; the last hop is the one a client can't forge.
    const forwarded = req.headers["x-forwarded-for"];
    const hops = (Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "")).split(",").map((h) => h.trim()).filter(Boolean);
    const ip = hops.at(-1) ?? req.socket.remoteAddress ?? "unknown";
    // ponytail: O(clients) scan per connect, keep a per-IP count map if connection volume ever matters
    let fromIp = 0;
    for (const other of clients) if (other.ip === ip) fromIp++;
    if (fromIp >= socketsPerIp) return ws.close(1008, "Too many connections");
    const c: Client = { ws, clientId: null, code: null, name: "", alive: true, windowStart: Date.now(), count: 0, ip };
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
    const now = Date.now();
    for (const byIp of [createsByIp, joinsByIp]) for (const [ip, w] of byIp) if (now - w.windowStart >= 60_000) byIp.delete(ip);
    for (const [code, live] of rooms) {
      if (inRoom(code).length > 0) continue;
      const lobby = live.room.game.phase === "lobby";
      if (live.lastActive < now - ROOM_TTL_MS || (lobby && live.lastActive < now - EMPTY_LOBBY_TTL_MS)) deleteRoom(code);
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
