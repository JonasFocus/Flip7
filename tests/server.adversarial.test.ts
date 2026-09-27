import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import { applyIntent, awaitingPlayerId, chooseBotIntent, removePlayer, addPlayer, createGame } from "../lib/engine/index.ts";
import type { GameState, Intent } from "../lib/engine/types.ts";
import { KICKED_MESSAGE } from "../lib/protocol.ts";
import type { ClientMessage, Room, RoomSummary, ServerMessage } from "../lib/protocol.ts";
import { publicId, startServer } from "../server/index.ts";
import { parseMessage } from "../server/validate.ts";
import type { RunningServer } from "../server/index.ts";

let server: RunningServer;
before(async () => {
  server = await startServer(0, { autoPlayMs: 200, createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity, socketsPerIp: Infinity });
});
after(() => server.close());

type RoomMsg = Extract<ServerMessage, { t: "room" }>;

interface TC {
  ws: WebSocket;
  inbox: ServerMessage[];
  closed: Promise<number>;
  send: (m: ClientMessage) => void;
  raw: (s: string | Buffer) => void;
  waitRoom: (pred: (m: RoomMsg) => boolean, ms?: number) => Promise<RoomMsg>;
  waitError: () => Promise<string>;
}

const isMsg = (v: unknown): v is ServerMessage => typeof v === "object" && v !== null && "t" in v;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(port = server.port): Promise<TC> {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox: ServerMessage[] = [];
  ws.on("message", (d) => {
    const v: unknown = JSON.parse(d.toString());
    if (isMsg(v)) inbox.push(v);
  });
  const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
  await new Promise((r) => ws.once("open", r));
  const waitFor = async <T>(pick: (m: ServerMessage) => T | null, ms = 3000): Promise<T> => {
    const deadline = Date.now() + ms;
    let i = 0;
    while (Date.now() < deadline) {
      for (; i < inbox.length; i++) {
        const m = inbox[i];
        const hit = m ? pick(m) : null;
        if (hit !== null) return hit;
      }
      await sleep(10);
    }
    throw new Error("timed out");
  };
  return {
    ws,
    inbox,
    closed,
    send: (m) => ws.send(JSON.stringify(m)),
    raw: (s) => ws.send(s),
    waitRoom: (pred, ms) => waitFor((m) => (m.t === "room" && pred(m) ? m : null), ms),
    waitError: () => waitFor((m) => (m.t === "error" ? m.message : null)),
  };
}

const vgame = (room: Room): GameState => {
  if (room.mode !== "virtual") throw new Error("expected virtual");
  return room.game;
};
const last = (c: TC): Room => {
  const m = c.inbox.findLast((x) => x.t === "room");
  if (!m || m.t !== "room") throw new Error("no room");
  return m.room;
};
async function alive(port = server.port) {
  const c = await connect(port);
  c.send({ t: "ping" });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no pong")), 2000);
    c.ws.on("message", (d) => {
      if (d.toString().includes("pong")) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  c.ws.close();
}

test("fuzz: malformed / wrong-type messages never crash and always get an error", async () => {
  const c = await connect();
  const junk: unknown[] = [
    null, 1, "x", [], [1], {}, { t: 1 }, { t: "create" }, { t: "create", mode: "virtual", name: 5, clientId: "a" },
    { t: "create", mode: "virtual", name: "a", clientId: "" }, { t: "create", mode: "virtual", name: "a", clientId: "x".repeat(65) },
    { t: "create", mode: "evil", name: "a", clientId: "a" }, { t: "join", code: 123456, name: "a", clientId: "a" },
    { t: "join", code: "12345a", name: "a", clientId: "a" }, { t: "intent" }, { t: "intent", intent: null },
    { t: "intent", intent: { type: "ready", ready: "yes" } }, { t: "intent", intent: { type: "chooseTarget", targetId: 1 } },
    { t: "intent", intent: { type: "__proto__" } }, { t: "score", intent: { type: "setGoal", goal: 1.5 } },
    { t: "score", intent: { type: "submitEntry", seatId: "a", entry: { numbers: [1, 1], x2: false, plus: [], busted: false } } },
    { t: "score", intent: { type: "submitEntry", seatId: "a", entry: { numbers: "1", x2: false, plus: [], busted: false } } },
    { t: "removePlayer" }, { t: "removePlayer", playerId: {} }, { __proto__: { t: "ping" } }, { t: "constructor" },
  ];
  for (const j of junk) c.raw(JSON.stringify(j));
  c.raw("{");
  c.raw(Buffer.from([1, 2, 3]));
  await sleep(300);
  const errors = c.inbox.filter((m) => m.t === "error").length;
  assert.equal(errors, junk.length + 2);
  // Valid-shape messages without a room.
  c.send({ t: "intent", intent: { type: "hit" } });
  await sleep(100);
  assert.deepEqual(c.inbox.at(-1), { t: "error", message: "Not in a room" });
  c.ws.close();
  await alive();
});

test("score intents that change rounds must carry the round", () => {
  const score = (intent: unknown) => parseMessage(JSON.stringify({ t: "score", intent }));
  assert.equal(score({ type: "finishRound" }), null);
  assert.equal(score({ type: "undoRound", round: "1" }), null);
  assert.equal(score({ type: "submitEntry", seatId: "a", entry: { numbers: [1], x2: false, plus: [], busted: false } }), null);
  assert.deepEqual(score({ type: "finishRound", round: 3, extra: 1 }), { t: "score", intent: { type: "finishRound", round: 3 } });
});

test("oversized frame closes only that socket", async () => {
  const c = await connect();
  c.raw(JSON.stringify({ t: "ping", pad: "x".repeat(20_000) }));
  assert.equal(await c.closed, 1009);
  await alive();
});

test("rapid spam is rate limited per socket", async () => {
  const c = await connect();
  for (let i = 0; i < 200; i++) c.send({ t: "ping" });
  await sleep(300);
  assert.ok(c.inbox.filter((m) => m.t === "pong").length <= 30);
  c.ws.close();
});

test("same clientId from two sockets: older socket is kicked with 4001", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "dup-1" });
  const code = (await a.waitRoom(() => true)).room.code;
  const a2 = await connect();
  a2.send({ t: "join", code, name: "A", clientId: "dup-1" });
  await a2.waitRoom(() => true);
  assert.equal(await a.closed, 4001);
  await sleep(50);
  const g = vgame(last(a2));
  assert.equal(g.players.length, 1);
  assert.equal(g.players[0]?.connected, true, "kicked tab's close must not mark the seat disconnected");
  a2.ws.close();
});

test("SECURITY: ids in the snapshot can't be used to take over a seat or host", async () => {
  const host = await connect();
  host.send({ t: "create", mode: "virtual", name: "Mom", clientId: "secret-mom-uuid" });
  const code = (await host.waitRoom(() => true)).room.code;
  const kid = await connect();
  kid.send({ t: "join", code, name: "Kid", clientId: "kid-uuid" });
  const seen = await kid.waitRoom(() => true);
  const momId = seen.room.hostId;
  assert.notEqual(momId, "secret-mom-uuid", "the secret is never broadcast");
  assert.ok(!JSON.stringify(seen).includes("secret-mom-uuid"));
  const evil = await connect();
  evil.send({ t: "join", code, name: "whatever", clientId: momId });
  const took = await evil.waitRoom(() => true);
  assert.notEqual(took.you, momId);
  assert.equal(took.room.hostId, momId, "real host keeps host");
  assert.equal(vgame(took.room).players.length, 3, "impersonator got a fresh seat");
  await sleep(100);
  assert.equal(host.ws.readyState, WebSocket.OPEN, "real host was not kicked");
  host.ws.close();
  kid.ws.close();
  evil.ws.close();
});

test("SECURITY: scorekeeper seat ownerIds can't be reused to control another phone's seats", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "physical", name: "A", clientId: "sk-secret-a" });
  const r = await a.waitRoom(() => true);
  if (r.room.mode !== "physical") throw new Error("expected physical");
  const owner = r.room.game.players[0]?.ownerId ?? "";
  assert.notEqual(owner, "sk-secret-a");
  const evil = await connect();
  evil.send({ t: "join", code: r.room.code, name: "x", clientId: owner });
  const e = await evil.waitRoom(() => true);
  assert.notEqual(e.you, owner);
  await sleep(100);
  assert.equal(a.ws.readyState, WebSocket.OPEN);
  a.ws.close();
  evil.ws.close();
});

test("SECURITY: a human can't join as a bot by using the bot id from the snapshot", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "botjack-a" });
  const code = (await a.waitRoom(() => true)).room.code;
  a.send({ t: "addBot" });
  const withBot = await a.waitRoom((m) => vgame(m.room).players.some((p) => p.isBot));
  const botId = vgame(withBot.room).players.find((p) => p.isBot)?.id ?? "";
  const evil = await connect();
  evil.send({ t: "join", code, name: "x", clientId: botId });
  const r = await evil.waitRoom(() => true);
  assert.notEqual(r.you, botId, "not attached as the bot");
  assert.equal(vgame(r.room).players.filter((p) => p.isBot).length, 1);
  a.ws.close();
  evil.ws.close();
});

const listRooms = async () => (await (await fetch(`http://localhost:${server.port}/rooms`)).json()) as RoomSummary[];

test("ABUSE: repeated create from one socket leaves only the live room listed", async () => {
  const c = await connect();
  const codes: string[] = [];
  for (let i = 0; i < 20; i++) c.send({ t: "create", mode: "virtual", name: `Spam${i}`, clientId: "spammer" });
  await sleep(300);
  for (const m of c.inbox) if (m.t === "room" && !codes.includes(m.room.code)) codes.push(m.room.code);
  const listed = (await listRooms()).filter((r) => r.joinable && codes.includes(r.code));
  assert.deepEqual(listed.map((r) => r.code), [codes.at(-1)]);
  c.ws.close();
  await sleep(100);
  assert.ok(!(await listRooms()).some((r) => r.joinable && codes.includes(r.code)), "table with nobody online is not joinable");
});

test("offline room stays listed (not joinable) so its player can find the way back", async () => {
  const h = await connect();
  h.send({ t: "create", mode: "virtual", name: "Solo", clientId: "back-h" });
  const code = (await h.waitRoom(() => true)).room.code;
  h.send({ t: "addBot" });
  await h.waitRoom((m) => vgame(m.room).players.length === 2);
  h.send({ t: "intent", intent: { type: "ready", ready: true } });
  h.send({ t: "intent", intent: { type: "start" } });
  await h.waitRoom((m) => vgame(m.room).phase === "playing");
  assert.equal((await listRooms()).find((r) => r.code === code)?.joinable, false);
  h.ws.close();
  await sleep(100);
  const after = (await listRooms()).find((r) => r.code === code);
  assert.ok(after, "still listed after the only human disconnects");
  assert.equal(after.joinable, false);
});

test("full room is listed as not joinable", async () => {
  const h = await connect();
  h.send({ t: "create", mode: "virtual", name: "Full", clientId: "full-h" });
  const code = (await h.waitRoom(() => true)).room.code;
  for (let i = 0; i < 9; i++) h.send({ t: "addBot" });
  await h.waitRoom((m) => vgame(m.room).players.length === 10);
  assert.equal((await listRooms()).find((r) => r.code === code)?.joinable, false);
  h.ws.close();
});

test("a leave that ends the round broadcasts roundEnd", async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const a = await connect();
    a.send({ t: "create", mode: "virtual", name: "A", clientId: `re-a-${attempt}` });
    const code = (await a.waitRoom(() => true)).room.code;
    const b = await connect();
    b.send({ t: "join", code, name: "B", clientId: `re-b-${attempt}` });
    await b.waitRoom(() => true);
    a.send({ t: "intent", intent: { type: "ready", ready: true } });
    b.send({ t: "intent", intent: { type: "ready", ready: true } });
    await a.waitRoom((m) => vgame(m.room).players.every((p) => p.ready));
    a.send({ t: "intent", intent: { type: "start" } });
    const started = await a.waitRoom((m) => vgame(m.room).phase === "playing");
    const aId = started.you;
    // A stays whenever it's their turn and nothing is pending; once only B is active, B leaves.
    for (let i = 0; i < 40; i++) {
      const g = vgame(last(a));
      if (g.phase !== "playing") break;
      const me = g.players.find((p) => p.id === aId);
      if (me && me.status !== "active") break;
      if (awaitingPlayerId(g) === aId) {
        const intent = g.pending ? chooseBotIntent(g, aId) : { type: "stay" as const };
        if (intent) a.send({ t: "intent", intent });
      } else if (awaitingPlayerId(g)) {
        const intent = chooseBotIntent(g, awaitingPlayerId(g) ?? "");
        if (intent) b.send({ t: "intent", intent: intent.type === "stay" ? { type: "hit" } : intent });
      }
      await sleep(40);
    }
    const g = vgame(last(a));
    const onlyBActive = g.phase === "playing" && g.players.filter((p) => p.status === "active").map((p) => p.id).every((id) => id !== aId);
    if (!onlyBActive) {
      a.ws.close();
      b.ws.close();
      continue;
    }
    const seen = a.inbox.length;
    b.send({ t: "leave" });
    const ended = await a.waitRoom((m) => a.inbox.indexOf(m) >= seen && vgame(m.room).players.length === 1);
    assert.ok(ended.events.some((e) => e.type === "roundEnd"), "roundEnd forwarded on leave");
    a.ws.close();
    return;
  }
  assert.fail("never reached a state where only the leaver was active");
});

test("publicId is stable and never looks like a bot id", () => {
  assert.equal(publicId("x"), publicId("x"));
  assert.notEqual(publicId("x"), "x");
  assert.ok(!publicId("bot-12345678").startsWith("bot-"));
});

test("snapshots never leak the deck", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "leak-a" });
  await a.waitRoom(() => true);
  for (let i = 0; i < 3; i++) a.send({ t: "addBot" });
  a.send({ t: "intent", intent: { type: "ready", ready: true } });
  a.send({ t: "intent", intent: { type: "start" } });
  await a.waitRoom((m) => vgame(m.room).phase === "playing");
  for (let i = 0; i < 15; i++) {
    const g = vgame(last(a));
    if (awaitingPlayerId(g) === publicId("leak-a")) {
      const intent = chooseBotIntent(g, publicId("leak-a"));
      if (intent) a.send({ t: "intent", intent });
    }
    await sleep(150);
  }
  for (const m of a.inbox) if (m.t === "room") assert.equal(vgame(m.room).deck.length, 0);
  a.ws.close();
});

test("host leaves mid-round: game continues, next human is host, bots still play", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "hl-a" });
  const code = (await a.waitRoom(() => true)).room.code;
  const b = await connect();
  b.send({ t: "join", code, name: "B", clientId: "hl-b" });
  await b.waitRoom(() => true);
  a.send({ t: "addBot" });
  await b.waitRoom((m) => vgame(m.room).players.length === 3);
  a.send({ t: "intent", intent: { type: "ready", ready: true } });
  b.send({ t: "intent", intent: { type: "ready", ready: true } });
  await a.waitRoom((m) => vgame(m.room).players.filter((p) => p.ready).length === 3);
  a.send({ t: "intent", intent: { type: "start" } });
  await b.waitRoom((m) => vgame(m.room).phase === "playing");
  a.send({ t: "leave" });
  const r = await b.waitRoom((m) => m.room.hostId === publicId("hl-b") && vgame(m.room).players.length === 2);
  const seq = vgame(r.room).seq;
  // Drive B; bot must keep acting.
  for (let i = 0; i < 20; i++) {
    const g = vgame(last(b));
    if (awaitingPlayerId(g) === publicId("hl-b")) {
      const intent = chooseBotIntent(g, publicId("hl-b"));
      if (intent) b.send({ t: "intent", intent });
    } else if (g.phase === "roundOver") b.send({ t: "intent", intent: { type: "nextRound" } });
    await sleep(200);
  }
  assert.ok(vgame(last(b)).seq > seq + 2);
  a.ws.close();
  b.ws.close();
});

test("bot timers stop after the last human leaves (room deleted) or disconnects", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "bt-a" });
  const code = (await a.waitRoom(() => true)).room.code;
  for (let i = 0; i < 4; i++) a.send({ t: "addBot" });
  a.send({ t: "intent", intent: { type: "ready", ready: true } });
  a.send({ t: "intent", intent: { type: "start" } });
  await a.waitRoom((m) => vgame(m.room).phase === "playing");
  a.send({ t: "leave" });
  await sleep(100);
  const list = (await (await fetch(`http://localhost:${server.port}/rooms`)).json()) as RoomSummary[];
  assert.ok(!list.some((r) => r.code === code), "room with only bots is deleted");
  await sleep(1500); // any stray timer would throw/log here
  a.ws.close();
  await alive();
});

test("double create from the same socket moves the client; old room loses it", async () => {
  const a = await connect();
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "dc-a" });
  a.send({ t: "create", mode: "virtual", name: "A", clientId: "dc-a" });
  await sleep(200);
  const rooms = a.inbox.filter((m): m is RoomMsg => m.t === "room").map((m) => m.room.code);
  assert.equal(new Set(rooms).size, 2);
  a.ws.close();
});

test("join race: 15 sockets join a lobby at once, cap holds at 10", async () => {
  const h = await connect();
  h.send({ t: "create", mode: "virtual", name: "H", clientId: "race-h" });
  const code = (await h.waitRoom(() => true)).room.code;
  const cs = await Promise.all(Array.from({ length: 15 }, () => connect()));
  cs.forEach((c, i) => c.send({ t: "join", code, name: `P${i}`, clientId: `race-${i}` }));
  await sleep(400);
  assert.equal(vgame(last(h)).players.length, 10);
  assert.equal(cs.filter((c) => c.inbox.some((m) => m.t === "error" && m.message === "Room is full")).length, 6);
  h.ws.close();
  cs.forEach((c) => c.ws.close());
});

test("engine fuzz: random leaves + bot intents never throw (bot timer has no try/catch)", () => {
  for (let g = 0; g < 300; g++) {
    let s = createGame();
    const n = 2 + (g % 9);
    for (let i = 0; i < n; i++) s = addPlayer(s, { id: `p${i}`, name: `P${i}`, isBot: true });
    const host = "p0";
    let res = applyIntent(s, host, { type: "start" }, { isHost: true });
    assert.ok(res.ok);
    s = res.state;
    for (let step = 0; step < 2000 && s.phase !== "gameOver" && s.players.length > 0; step++) {
      if (Math.random() < 0.01 && s.players.length > 1) {
        const victim = s.players[Math.floor(Math.random() * s.players.length)]?.id ?? "";
        s = removePlayer(s, victim);
        continue;
      }
      if (s.phase === "roundOver") {
        const h = s.players[0]?.id ?? "";
        res = applyIntent(s, h, { type: "nextRound" }, { isHost: true });
        assert.ok(res.ok, res.ok ? "" : res.error);
        s = res.state;
        continue;
      }
      const who = awaitingPlayerId(s);
      assert.ok(who, `stuck: nobody awaited in phase ${s.phase}`);
      const intent: Intent | null = chooseBotIntent(s, who);
      assert.ok(intent, "bot has no intent");
      res = applyIntent(s, who, intent, { isHost: false });
      assert.ok(res.ok, res.ok ? "" : res.error);
      s = res.state;
    }
  }
});

test("BUG: a lobby seat kicked while offline keeps its disconnect stamp, so on rejoin the server auto-plays an online human", async () => {
  const h = await connect();
  h.send({ t: "create", mode: "virtual", name: "H", clientId: "ko-h" });
  const code = (await h.waitRoom(() => true)).room.code;
  const k = await connect();
  k.send({ t: "join", code, name: "Kid", clientId: "ko-kid" });
  await h.waitRoom((m) => vgame(m.room).players.length === 2);
  k.ws.close(); // phone drops in the lobby
  await h.waitRoom((m) => vgame(m.room).players.some((p) => !p.connected));
  h.send({ t: "removePlayer", playerId: publicId("ko-kid") });
  await h.waitRoom((m) => vgame(m.room).players.length === 1);
  const k2 = await connect();
  k2.send({ t: "join", code, name: "Kid", clientId: "ko-kid" });
  await h.waitRoom((m) => vgame(m.room).players.length === 2);
  h.send({ t: "intent", intent: { type: "ready", ready: true } });
  k2.send({ t: "intent", intent: { type: "ready", ready: true } });
  await h.waitRoom((m) => vgame(m.room).players.every((p) => p.ready));
  h.send({ t: "intent", intent: { type: "start" } });
  // Kid is online and never acts; nobody should play for them. Host plays its own turns.
  let auto = false;
  for (let i = 0; i < 30 && !auto; i++) {
    const g = vgame(last(h));
    if (awaitingPlayerId(g) === publicId("ko-h")) {
      const intent = g.pending ? chooseBotIntent(g, publicId("ko-h")) : { type: "stay" as const };
      if (intent) h.send({ t: "intent", intent });
    }
    auto = k2.inbox.some((m) => m.t === "room" && ((m.room.mode === "virtual" && m.room.autoPlay?.playerId === publicId("ko-kid")) || m.events.some((e) => e.type === "stay" && "auto" in e && e.auto === true)));
    await sleep(100);
  }
  assert.equal(auto, false, "online rejoined kid got an auto-play countdown / auto-stay");
  h.ws.close();
  k2.ws.close();
});

test("ABUSE: one attacker fills MAX_ROOMS in about a second and locks everyone out of creating tables", async () => {
  const s = await startServer(0, { createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity, socketsPerIp: Infinity });
  try {
    const bots = await Promise.all(Array.from({ length: 70 }, () => connect(s.port)));
    bots.forEach((b, i) => {
      for (let j = 0; j < 29; j++) b.send({ t: "create", mode: "virtual", name: "x", clientId: `flood-${i}` });
    });
    await sleep(1500);
    bots.forEach((b) => b.ws.close());
    await sleep(200);
    const victim = await connect(s.port);
    victim.send({ t: "create", mode: "virtual", name: "Mom", clientId: "victim" });
    const err = await victim.waitError().catch(() => null);
    assert.notEqual(err, "Server is busy, try again soon", "abandoned flood lobbies (kept 10 min) block real families");
    victim.ws.close();
  } finally {
    await s.close();
  }
});

test("names: invisible / bidi-override names are rejected", () => {
  for (const name of ["​", "⠀⠀", "‮gnp.exe", "á́́́́́́́́́́́́́́́́́"]) {
    const m = parseMessage(JSON.stringify({ t: "create", mode: "virtual", name, clientId: "n" }));
    assert.equal(m, null, `accepted ${JSON.stringify(name)}`);
  }
});

test("names: real names, accents and ZWJ emoji still pass; stray zero-width chars are dropped", () => {
  const ok = (name: string) => {
    const m = parseMessage(JSON.stringify({ t: "create", mode: "virtual", name, clientId: "n" }));
    return m && m.t === "create" ? m.name : null;
  };
  assert.equal(ok("José"), "José");
  assert.equal(ok("  Zoë   2 "), "Zoë 2");
  assert.equal(ok("👨‍👩‍👧"), "👨‍👩‍👧");
  assert.equal(ok("Ma​x"), "Max");
  assert.equal(ok("\u0000x"), null);
  assert.equal(ok("‍"), null);
});

test("a player removed while offline gets the kicked message on reconnect instead of silently rejoining", async () => {
  const h = await connect();
  h.send({ t: "create", mode: "virtual", name: "H", clientId: "kr-h" });
  const code = (await h.waitRoom(() => true)).room.code;
  const g = await connect();
  g.send({ t: "join", code, name: "Guest", clientId: "kr-g" });
  await h.waitRoom((m) => vgame(m.room).players.length === 2);
  g.ws.terminate();
  await h.waitRoom((m) => vgame(m.room).players.some((p) => !p.connected));
  h.send({ t: "removePlayer", playerId: publicId("kr-g") });
  await h.waitRoom((m) => vgame(m.room).players.length === 1);
  const g2 = await connect();
  g2.send({ t: "join", code, name: "Guest", clientId: "kr-g" });
  assert.equal(await g2.waitError(), KICKED_MESSAGE);
  await sleep(100);
  assert.equal(vgame(last(h)).players.length, 1);
  h.ws.close();
  g2.ws.close();
});

test("ABUSE: creates are capped per IP (last X-Forwarded-For hop), other IPs unaffected", async () => {
  const s = await startServer(0, { createsPerIpPerMin: 3 });
  const as = (ip: string) => {
    const ws = new WebSocket(`ws://localhost:${s.port}`, { headers: { "x-forwarded-for": `9.9.9.9, ${ip}` } });
    const inbox: ServerMessage[] = [];
    ws.on("message", (d) => {
      const v: unknown = JSON.parse(d.toString());
      if (isMsg(v)) inbox.push(v);
    });
    return new Promise<{ ws: WebSocket; inbox: ServerMessage[] }>((r) => ws.once("open", () => r({ ws, inbox })));
  };
  try {
    const a = await as("1.1.1.1");
    for (let i = 0; i < 5; i++) a.ws.send(JSON.stringify({ t: "create", mode: "virtual", name: "A", clientId: "ip-a" }));
    const b = await as("2.2.2.2");
    b.ws.send(JSON.stringify({ t: "create", mode: "virtual", name: "B", clientId: "ip-b" }));
    await sleep(300);
    assert.equal(a.inbox.filter((m) => m.t === "room").length, 3);
    assert.equal(a.inbox.filter((m) => m.t === "error").length, 2);
    assert.ok(b.inbox.some((m) => m.t === "room"));
    a.ws.close();
    b.ws.close();
  } finally {
    await s.close();
  }
});

test("full server evicts the oldest lobby nobody is in instead of refusing", async () => {
  const s = await startServer(0, { maxRooms: 3, createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity });
  try {
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await connect(s.port);
      c.send({ t: "create", mode: "virtual", name: "x", clientId: `ev-${i}` });
      codes.push((await c.waitRoom(() => true)).room.code);
      c.ws.close();
      await sleep(20);
    }
    await sleep(100);
    const v = await connect(s.port);
    v.send({ t: "create", mode: "virtual", name: "Mom", clientId: "ev-v" });
    await v.waitRoom(() => true);
    const late = await connect(s.port);
    late.send({ t: "join", code: codes[0] ?? "", name: "x", clientId: "ev-0" });
    assert.equal(await late.waitError(), "Room not found");
    v.ws.close();
    late.ws.close();
  } finally {
    await s.close();
  }
});

test("ABUSE: one socket re-joining under fresh clientIds leaves no ghost seats", async () => {
  const host = await connect();
  host.send({ t: "create", mode: "virtual", name: "Mom", clientId: "ghost-host" });
  const code = (await host.waitRoom(() => true)).room.code;
  const griefer = await connect();
  for (let i = 0; i < 9; i++) griefer.send({ t: "join", code, name: "x", clientId: `ghost-${i}` });
  await griefer.waitRoom((m) => m.you === publicId("ghost-8"));
  await sleep(100);
  const now = vgame(last(host));
  assert.equal(now.players.filter((p) => !p.isBot && !p.connected).length, 0, "no offline ghost seats");
  assert.equal(now.players.length, 2);
  const kid = await connect();
  kid.send({ t: "join", code, name: "Kid", clientId: "ghost-kid" });
  await host.waitRoom((m) => vgame(m.room).players.some((p) => p.id === publicId("ghost-kid")));
  host.ws.close();
  griefer.ws.close();
  kid.ws.close();
});

test("ABUSE: new-seat joins are capped per IP; reconnects stay free", async () => {
  const s = await startServer(0, { createsPerIpPerMin: Infinity, joinsPerIpPerMin: 2 });
  try {
    const host = await connect(s.port);
    host.send({ t: "create", mode: "virtual", name: "Mom", clientId: "jl-host" });
    const code = (await host.waitRoom(() => true)).room.code;
    for (let i = 0; i < 2; i++) {
      const g = await connect(s.port);
      g.send({ t: "join", code, name: "g", clientId: `jl-${i}` });
      await g.waitRoom(() => true);
      g.ws.close();
    }
    const third = await connect(s.port);
    third.send({ t: "join", code, name: "g", clientId: "jl-2" });
    assert.match(await third.waitError(), /Too many joins/);
    third.send({ t: "join", code, name: "g", clientId: "jl-0" });
    await third.waitRoom((m) => m.you === publicId("jl-0"));
    host.ws.close();
    third.ws.close();
  } finally {
    await s.close();
  }
});

test("PERF: GET /rooms stays fast and capped with 1500 rooms + sockets", async () => {
  const s = await startServer(0, { createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity, socketsPerIp: Infinity });
  const socks: TC[] = [];
  try {
    for (let i = 0; i < 1500; i++) {
      const c = await connect(s.port);
      c.send({ t: "create", mode: "virtual", name: "x", clientId: `perf-${i}` });
      socks.push(c);
    }
    await sleep(500);
    const t0 = performance.now();
    const res = await fetch(`http://localhost:${s.port}/rooms`);
    const body = await res.text();
    const ms = performance.now() - t0;
    console.log(`/rooms with 1500 rooms + 1500 sockets: ${ms.toFixed(1)}ms, ${body.length} bytes`);
    const list: unknown = JSON.parse(body);
    assert.ok(Array.isArray(list) && list.length === 100, "listing capped at 100");
  } finally {
    for (const c of socks) c.ws.close();
    await s.close();
  }
});

test("R4 BUG: a scorekeeper phone the host removed gets silently re-seated on its next reconnect", async () => {
  const host = await connect();
  host.send({ t: "create", mode: "physical", name: "Mom", clientId: "r4-sk-host" });
  const code = (await host.waitRoom(() => true)).room.code;
  const kid = await connect();
  kid.send({ t: "join", code, name: "Kid", clientId: "r4-sk-kid" });
  const kidSeat = publicId("r4-sk-kid");
  await host.waitRoom((m) => m.room.game.players.some((p) => p.id === kidSeat));
  host.send({ t: "score", intent: { type: "start" } });
  await host.waitRoom((m) => m.room.game.phase === "playing");
  host.send({ t: "score", intent: { type: "removeSeat", seatId: kidSeat } });
  await host.waitRoom((m) => m.room.game.phase === "playing" && !m.room.game.players.some((p) => p.id === kidSeat));
  kid.ws.close(); // flaky signal / tab refocus
  const back = await connect();
  back.send({ t: "join", code, name: "Kid", clientId: "r4-sk-kid" });
  const r = await back.waitRoom(() => true);
  const reseated = r.room.game.players.some((p) => p.id === kidSeat);
  host.ws.close();
  back.ws.close();
  assert.equal(reseated, false, "removed seat came back on reconnect");
});

test("R4: removing your own only scorekeeper seat sticks across a reconnect, and Late arrival re-seats you", async () => {
  const host = await connect();
  host.send({ t: "create", mode: "physical", name: "Mom", clientId: "r4-self-host" });
  const code = (await host.waitRoom(() => true)).room.code;
  const kid = await connect();
  kid.send({ t: "join", code, name: "Kid", clientId: "r4-self-kid" });
  const kidSeat = publicId("r4-self-kid");
  await host.waitRoom((m) => m.room.game.players.some((p) => p.id === kidSeat));
  host.send({ t: "score", intent: { type: "start" } });
  await host.waitRoom((m) => m.room.game.phase === "playing");
  kid.send({ t: "score", intent: { type: "removeSeat", seatId: kidSeat } });
  await host.waitRoom((m) => !m.room.game.players.some((p) => p.id === kidSeat));
  kid.ws.close();
  const back = await connect();
  back.send({ t: "join", code, name: "Kid", clientId: "r4-self-kid" });
  const r = await back.waitRoom(() => true);
  assert.equal(r.room.game.players.some((p) => "ownerId" in p && p.ownerId === kidSeat), false, "self-removed seat came back on reconnect");
  back.send({ t: "score", intent: { type: "addSeat", name: "Kid" } });
  const again = await back.waitRoom((m) => m.room.game.players.some((p) => "ownerId" in p && p.ownerId === kidSeat));
  assert.ok(again);
  host.ws.close();
  back.ws.close();
});

test("R4 ABUSE: one IP is capped on open sockets, other IPs unaffected", async () => {
  const s = await startServer(0, { socketsPerIp: 3 });
  const as = (ip: string) => new WebSocket(`ws://localhost:${s.port}`, { headers: { "x-forwarded-for": ip } });
  const socks = [...Array.from({ length: 5 }, () => as("1.1.1.1")), as("2.2.2.2")];
  try {
    await sleep(300);
    const open = socks.map((w) => w.readyState === WebSocket.OPEN);
    assert.equal(open.slice(0, 5).filter(Boolean).length, 3);
    assert.ok(open[5], "other IP was refused");
  } finally {
    for (const w of socks) w.close();
    await s.close();
  }
});
