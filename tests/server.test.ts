import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import { awaitingPlayerId } from "../lib/engine/index.ts";
import type { Intent } from "../lib/engine/types.ts";
import { KICKED_MESSAGE } from "../lib/protocol.ts";
import type { ClientMessage, Room, ServerMessage } from "../lib/protocol.ts";
import { publicId as P, startServer } from "../server/index.ts";
import type { RunningServer } from "../server/index.ts";

let server: RunningServer;
before(async () => {
  server = await startServer(0, { createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity });
});
after(() => server.close());

type RoomMsg = Extract<ServerMessage, { t: "room" }>;

interface TestClient {
  ws: WebSocket;
  inbox: ServerMessage[];
  send: (m: ClientMessage) => void;
  waitRoom: (pred: (m: RoomMsg) => boolean) => Promise<RoomMsg>;
  waitError: () => Promise<string>;
}

function isServerMessage(v: unknown): v is ServerMessage {
  return typeof v === "object" && v !== null && "t" in v;
}

async function connect(port = server.port): Promise<TestClient> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox: ServerMessage[] = [];
  ws.on("message", (d) => {
    const v: unknown = JSON.parse(d.toString());
    if (isServerMessage(v)) inbox.push(v);
  });
  await new Promise((r) => ws.once("open", r));
  const waitFor = async <T>(pick: (m: ServerMessage) => T | null): Promise<T> => {
    const deadline = Date.now() + 3000;
    let i = 0;
    while (Date.now() < deadline) {
      for (; i < inbox.length; i++) {
        const m = inbox[i];
        const hit = m ? pick(m) : null;
        if (hit !== null) {
          i++;
          return hit;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("timed out waiting for message");
  };
  return {
    ws,
    inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    waitRoom: (pred) => waitFor((m) => (m.t === "room" && pred(m) ? m : null)),
    waitError: () => waitFor((m) => (m.t === "error" ? m.message : null)),
  };
}

function latestRoom(c: TestClient): Room {
  const last = c.inbox.findLast((m) => m.t === "room");
  assert.ok(last && last.t === "room");
  return last.room;
}

function virtualGame(room: Room) {
  assert.equal(room.mode, "virtual");
  if (room.mode !== "virtual") throw new Error("expected virtual room");
  return room.game;
}

test("http health and rooms", async () => {
  const health = await fetch(`http://localhost:${server.port}/health`);
  assert.equal(await health.text(), "ok");
  const rooms = await fetch(`http://localhost:${server.port}/rooms`);
  assert.equal(rooms.headers.get("access-control-allow-origin"), "*");
  assert.ok(Array.isArray(await rooms.json()));
});

test("rejects malformed input", async () => {
  const c = await connect();
  c.ws.send("{not json");
  assert.equal(await c.waitError(), "Invalid message");
  c.send({ t: "join", code: "12", name: "x", clientId: "a" });
  assert.equal(await c.waitError(), "Invalid message");
  c.send({ t: "create", mode: "virtual", name: "   ", clientId: "a" });
  assert.equal(await c.waitError(), "Invalid message");
  c.ws.close();
});

test("two players create, join, play, reconnect", async () => {
  const a = await connect();
  const b = await connect();
  a.send({ t: "create", mode: "virtual", name: "  Mom  ", clientId: "client-a" });
  const created = await a.waitRoom(() => true);
  const code = created.room.code;
  assert.match(code, /^\d{6}$/);
  assert.equal(created.you, P("client-a"));
  assert.equal(created.room.hostId, P("client-a"));
  assert.equal(virtualGame(created.room).players[0]?.name, "Mom");

  b.send({ t: "join", code, name: "Dad", clientId: "client-b" });
  await b.waitRoom((m) => m.you === P("client-b"));
  await a.waitRoom((m) => virtualGame(m.room).players.length === 2);

  a.send({ t: "intent", intent: { type: "ready", ready: true } });
  b.send({ t: "intent", intent: { type: "ready", ready: true } });
  await a.waitRoom((m) => virtualGame(m.room).players.every((p) => p.ready));
  a.send({ t: "intent", intent: { type: "start" } });
  await b.waitRoom((m) => virtualGame(m.room).phase === "playing");

  const byId = { [P("client-a")]: a, [P("client-b")]: b };
  for (let moves = 0; moves < 8; moves++) {
    const game = virtualGame(latestRoom(a));
    if (game.phase !== "playing") break;
    assert.equal(game.deck.length, 0, "deck must be redacted");
    assert.ok(game.deckCount > 0);
    const actor = awaitingPlayerId(game);
    assert.ok(actor === P("client-a") || actor === P("client-b"));
    const pending = game.pending;
    const intent: Intent =
      pending?.type === "chooseTarget" && pending.playerId === actor
        ? { type: "chooseTarget", targetId: pending.options[0] ?? actor }
        : moves % 3 === 2 && !pending
          ? { type: "stay" }
          : { type: "hit" };
    byId[actor]?.send({ t: "intent", intent });
    const seq = game.seq;
    await a.waitRoom((m) => virtualGame(m.room).seq > seq);
    await b.waitRoom((m) => virtualGame(m.room).seq > seq);
  }

  b.ws.close();
  await a.waitRoom((m) => virtualGame(m.room).players.find((p) => p.id === P("client-b"))?.connected === false);

  const b2 = await connect();
  b2.send({ t: "join", code, name: "Dad", clientId: "client-b" });
  const resumed = await b2.waitRoom(() => true);
  assert.equal(resumed.you, P("client-b"));
  const players = virtualGame(resumed.room).players;
  assert.equal(players.length, 2);
  assert.equal(players.find((p) => p.id === P("client-b"))?.connected, true);
  assert.equal(virtualGame(resumed.room).deck.length, 0);

  a.ws.close();
  b2.ws.close();
});

test("host adds a bot and the server plays it", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "Solo", clientId: "client-solo" });
  await a.waitRoom(() => true);
  a.send({ t: "addBot" });
  const withBot = await a.waitRoom((m) => virtualGame(m.room).players.some((p) => p.isBot));
  const botId = virtualGame(withBot.room).players.find((p) => p.isBot)?.id;
  a.send({ t: "intent", intent: { type: "ready", ready: true } });
  a.send({ t: "intent", intent: { type: "start" } });
  const started = await a.waitRoom((m) => virtualGame(m.room).phase === "playing");
  let game = virtualGame(started.room);
  let botActed = false;
  for (let i = 0; i < 10 && !botActed && game.phase === "playing"; i++) {
    const actor = awaitingPlayerId(game);
    const pending = game.pending;
    if (actor === P("client-solo")) {
      const intent: Intent =
        pending?.type === "chooseTarget"
          ? { type: "chooseTarget", targetId: pending.options[0] ?? actor }
          : pending
            ? { type: "hit" }
            : { type: "stay" };
      a.send({ t: "intent", intent });
    }
    const seq = game.seq;
    game = virtualGame((await a.waitRoom((m) => virtualGame(m.room).seq > seq)).room);
    botActed = actor === botId;
  }
  assert.ok(botActed, "bot should act on its own");
  a.ws.close();
});

test("creator gets host back after reconnecting", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "Ann", clientId: "creator-a" });
  const code = (await a.waitRoom(() => true)).room.code;
  const b = await connect();
  b.send({ t: "join", code, name: "Ben", clientId: "joiner-b" });
  await b.waitRoom((m) => m.room.hostId === P("creator-a"));
  a.ws.close();
  await b.waitRoom((m) => m.room.hostId === P("joiner-b"));
  const a2 = await connect();
  a2.send({ t: "join", code, name: "Ann", clientId: "creator-a" });
  await a2.waitRoom((m) => m.room.hostId === P("creator-a"));
  a2.ws.close();
  b.ws.close();
});

test("auto-plays a disconnected human after the grace period, unless they come back", async () => {
  const fast = await startServer(0, { autoPlayMs: 500, createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity });
  try {
    const a = await connect(fast.port);
    a.send({ t: "create", mode: "virtual", name: "Mom", clientId: "auto-a" });
    const code = (await a.waitRoom(() => true)).room.code;
    const b = await connect(fast.port);
    b.send({ t: "join", code, name: "Dad", clientId: "auto-b" });
    await b.waitRoom(() => true);
    a.send({ t: "intent", intent: { type: "ready", ready: true } });
    b.send({ t: "intent", intent: { type: "ready", ready: true } });
    await a.waitRoom((m) => virtualGame(m.room).players.every((p) => p.ready));
    a.send({ t: "intent", intent: { type: "start" } });
    let game = virtualGame((await a.waitRoom((m) => virtualGame(m.room).phase === "playing")).room);

    // Play Mom's moves until the game waits on Dad.
    for (let i = 0; i < 20 && awaitingPlayerId(game) !== P("auto-b"); i++) {
      const pending = game.pending;
      const intent: Intent =
        game.phase !== "playing"
          ? { type: "nextRound" }
          : pending?.type === "chooseTarget"
            ? { type: "chooseTarget", targetId: pending.options.includes(P("auto-b")) ? P("auto-b") : (pending.options[0] ?? P("auto-a")) }
            : pending
              ? { type: "hit" }
              : { type: "stay" };
      a.send({ t: "intent", intent });
      const seq = game.seq;
      game = virtualGame((await a.waitRoom((m) => virtualGame(m.room).seq > seq)).room);
    }
    assert.equal(awaitingPlayerId(game), P("auto-b"));
    const seq = game.seq;

    b.ws.close();
    const dropped = await a.waitRoom((m) => m.room.mode === "virtual" && m.room.autoPlay?.playerId === P("auto-b"));
    assert.ok(dropped.room.mode === "virtual" && (dropped.room.autoPlay?.inMs ?? 0) > 0);

    // Coming back in time cancels the takeover.
    const b2 = await connect(fast.port);
    b2.send({ t: "join", code, name: "Dad", clientId: "auto-b" });
    const back = await a.waitRoom((m) => virtualGame(m.room).players.find((p) => p.id === P("auto-b"))?.connected === true);
    assert.ok(back.room.mode === "virtual" && back.room.autoPlay === undefined);
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(virtualGame(latestRoom(a)).seq, seq, "must not act for a reconnected player");

    // Gone for good: the server acts for Dad.
    const goneAt = Date.now();
    b2.ws.close();
    await a.waitRoom((m) => virtualGame(m.room).seq > seq);
    assert.ok(Date.now() - goneAt >= 400, "waits out the grace period first");

    // A plain hit/stay turn is banked, flagged as auto, and replayed to Dad when he returns.
    if (!game.pending) {
      const isAutoStay = (m: RoomMsg) => m.events.some((e) => e.type === "stay" && e.playerId === P("auto-b") && e.auto === true);
      await a.waitRoom(isAutoStay);
      const b3 = await connect(fast.port);
      b3.send({ t: "join", code, name: "Dad", clientId: "auto-b" });
      await b3.waitRoom(isAutoStay);
      b3.ws.close();
    }
    a.ws.close();
  } finally {
    await fast.close();
  }
});

test("kicked player gets the shared kick message and is out of the room", async () => {
  const a = await connect();
  const b = await connect();
  a.send({ t: "create", mode: "virtual", name: "Host", clientId: "kick-a" });
  const code = (await a.waitRoom(() => true)).room.code;
  b.send({ t: "join", code, name: "Kid", clientId: "kick-b" });
  await a.waitRoom((m) => virtualGame(m.room).players.length === 2);
  a.send({ t: "removePlayer", playerId: P("kick-b") });
  assert.equal(await b.waitError(), KICKED_MESSAGE);
  await a.waitRoom((m) => virtualGame(m.room).players.length === 1);
  b.send({ t: "intent", intent: { type: "ready", ready: true } });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(b.inbox.some((m) => m.t === "error" && m.message === "Not in a room"));
  a.ws.close();
  b.ws.close();
});

test("leaving a scorekeeper lobby removes that phone's seats; leaving mid-game keeps them", async () => {
  const a = await connect();
  const b = await connect();
  const seats = (m: RoomMsg) => (m.room.mode === "physical" ? m.room.game.players.map((p) => p.name) : []);
  a.send({ t: "create", mode: "physical", name: "Host", clientId: "sk-leave-a" });
  const code = (await a.waitRoom(() => true)).room.code;
  b.send({ t: "join", code, name: "Bob", clientId: "sk-leave-b" });
  await b.waitRoom((m) => seats(m).length === 2);
  b.send({ t: "score", intent: { type: "addSeat", name: "Kid" } });
  await a.waitRoom((m) => seats(m).length === 3);
  b.send({ t: "leave" });
  const after = await a.waitRoom((m) => seats(m).length === 1);
  assert.deepEqual(seats(after), ["Host"]);
  assert.ok(after.room.mode === "physical" && Object.keys(after.room.game.entries).length === 1);

  const c = await connect();
  c.send({ t: "join", code, name: "Cy", clientId: "sk-leave-c" });
  await a.waitRoom((m) => seats(m).length === 2);
  a.send({ t: "score", intent: { type: "start" } });
  await c.waitRoom((m) => m.room.mode === "physical" && m.room.game.phase === "playing");
  c.send({ t: "leave" });
  await new Promise((r) => setTimeout(r, 100));
  const mid = latestRoom(a);
  assert.deepEqual(mid.mode === "physical" ? mid.game.players.map((p) => p.name) : [], ["Host", "Cy"]);
  a.ws.close();
  b.ws.close();
  c.ws.close();
});
