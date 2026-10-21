import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import type { ClientMessage, Room, ServerMessage } from "../lib/protocol.ts";
import { startServer } from "../server/index.ts";
import type { RunningServer } from "../server/index.ts";
import { TX_BOT_STYLES, isTxBotId, legalActions, type TxState } from "../lib/texasholdem/index.ts";

let server: RunningServer;
before(async () => {
  server = await startServer(0, { createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity });
});
after(() => server.close());

interface Client {
  ws: WebSocket;
  inbox: ServerMessage[];
  send: (m: ClientMessage) => void;
}

function isServerMessage(v: unknown): v is ServerMessage {
  return typeof v === "object" && v !== null && "t" in v;
}

async function connect(): Promise<Client> {
  const ws = new WebSocket(`ws://localhost:${server.port}`);
  const inbox: ServerMessage[] = [];
  ws.on("message", (d) => {
    const v: unknown = JSON.parse(d.toString());
    if (isServerMessage(v)) inbox.push(v);
  });
  await new Promise((r) => ws.once("open", r));
  return { ws, inbox, send: (m) => ws.send(JSON.stringify(m)) };
}

async function until<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const v = read();
    if (v !== null && v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function latest(c: Client): Room | null {
  const m = c.inbox.findLast((x) => x.t === "room");
  return m && m.t === "room" ? m.room : null;
}

function inHand(c: Client): boolean {
  const room = latest(c);
  return room !== null && room.mode === "texasholdem" && room.game.players.some((p) => p.cards.length > 0);
}

async function roomExists(code: string): Promise<boolean> {
  const list: unknown = await (await fetch(`http://localhost:${server.port}/rooms`)).json();
  return Array.isArray(list) && list.some((r: unknown) => typeof r === "object" && r !== null && "code" in r && r.code === code);
}

test("texasholdem room is deleted once every remaining player left mid-hand", async () => {
  const a = await connect();
  const b = await connect();
  a.send({ t: "create", mode: "texasholdem", name: "Ann", clientId: "tx-clean-a" });
  const code = (await until(() => latest(a), "created room")).code;
  b.send({ t: "join", code, name: "Bob", clientId: "tx-clean-b" });
  await until(() => latest(b), "joined room");
  a.send({ t: "texasholdem", intent: { type: "sit", seat: 0 } });
  b.send({ t: "texasholdem", intent: { type: "sit", seat: 1 } });
  await until(() => (inHand(a) && inHand(b) ? true : null), "hand dealt");

  a.send({ t: "leave" });
  await until(() => {
    const room = latest(b);
    return room && room.mode === "texasholdem" && room.game.players.some((p) => p.gone) ? true : null;
  }, "first leaver marked gone");
  assert.equal(await roomExists(code), true, "a remaining non-gone player keeps the room alive");

  b.send({ t: "leave" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await roomExists(code), false);
  a.ws.close();
  b.ws.close();
});

async function untilSlow<T>(read: () => T | null | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const v = read();
    if (v !== null && v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function game(c: Client): TxState | null {
  const room = latest(c);
  return room && room.mode === "texasholdem" ? room.game : null;
}

function errored(c: Client, message: string): true | null {
  return c.inbox.some((m) => m.t === "error" && m.message === message) ? true : null;
}

test("a solo host plays a hand to showdown against two bots, and a removed bot leaves at the hand boundary", async () => {
  const host = await connect();
  host.send({ t: "create", mode: "texasholdem", name: "Solo", clientId: "tx-solo-host" });
  const code = (await until(() => latest(host), "created room")).code;
  host.send({ t: "texasholdem", intent: { type: "sit", seat: 0 } });
  host.send({ t: "addBot" });
  host.send({ t: "addBot" });
  const seated = await until(() => {
    const g = game(host);
    return g && g.players.filter((p) => isTxBotId(p.id) && p.seat !== null).length === 2 ? g : null;
  }, "two bots seated");
  const names = seated.players.filter((p) => isTxBotId(p.id)).map((p) => p.name);
  assert.equal(new Set(names).size, 2, "bots get distinct names");
  assert.ok(names.every((n) => TX_BOT_STYLES.some((b) => b.name === n)));

  const hostId = seated.players.find((p) => !isTxBotId(p.id))?.id ?? "";
  let botTurns = 0;
  await untilSlow(() => {
    const g = game(host);
    if (!g) return null;
    if (g.phase === "showdown") return g;
    if (g.turnId === hostId && !g.runout) {
      const canCheck = legalActions(g, hostId)?.canCheck;
      host.send({ t: "texasholdem", intent: { type: canCheck ? "check" : "call" } });
    } else if (g.turnId !== null) botTurns++;
    return null;
  }, "showdown against the bots");
  assert.ok(botTurns > 0, "the bots took their turns on their own");

  const victim = game(host)?.players.find((p) => isTxBotId(p.id));
  assert.ok(victim);
  host.send({ t: "removePlayer", playerId: victim.id });
  await untilSlow(() => {
    const g = game(host);
    return g && !g.players.some((p) => p.id === victim.id) ? true : null;
  }, "removed bot cleared at the hand boundary");

  host.send({ t: "leave" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await roomExists(code), false, "bots do not keep a room alive");
  host.ws.close();
});

test("a table holds seven bots at most and only the host can seat them", async () => {
  const host = await connect();
  const guest = await connect();
  host.send({ t: "create", mode: "texasholdem", name: "Cap", clientId: "tx-cap-host" });
  const code = (await until(() => latest(host), "created room")).code;
  guest.send({ t: "join", code, name: "Guest", clientId: "tx-cap-guest" });
  await until(() => latest(guest), "joined room");
  guest.send({ t: "addBot" });
  await until(() => errored(guest, "Only the host can add bots"), "guest refused");
  for (let i = 0; i < 8; i++) host.send({ t: "addBot" });
  const full = await until(() => {
    const g = game(host);
    return g && g.players.filter((p) => isTxBotId(p.id)).length === 7 ? g : null;
  }, "seven bots");
  assert.equal(new Set(full.players.filter((p) => isTxBotId(p.id)).map((p) => p.seat)).size, 7, "each bot has its own seat");
  await until(() => errored(host, "A table holds 7 bots at most"), "eighth bot refused");
  host.ws.close();
  guest.ws.close();
});

test("a mid-hand kick rejects rejoining while the removed seat still exists", async () => {
  const host = await connect();
  const guest = await connect();
  try {
    host.send({ t: "create", mode: "texasholdem", name: "Host", clientId: "kick-host" });
    const code = (await until(() => latest(host), "room")).code;
    guest.send({ t: "join", code, name: "Guest", clientId: "kick-guest" });
    await until(() => latest(guest), "guest");
    const guestId = game(guest)?.players.find((p) => p.name === "Guest")?.id;
    assert.ok(guestId);
    host.send({ t: "texasholdem", intent: { type: "sit", seat: 0 } });
    guest.send({ t: "texasholdem", intent: { type: "sit", seat: 1 } });
    await until(() => inHand(host) ? true : null, "deal");
    guest.send({ t: "texasholdem", intent: { type: "sitOut" } });
    await until(() => game(host)?.players.find((p) => p.id === guestId)?.sitOut ? true : null, "sit out");
    host.send({ t: "removePlayer", playerId: guestId });
    await until(() => errored(guest, "You were removed from the room"), "kick");
    guest.inbox.length = 0;
    guest.send({ t: "join", code, name: "Guest", clientId: "kick-guest" });
    await until(() => guest.inbox.length ? true : null, "join response");
    assert.ok(errored(guest, "You were removed from the room"));
    assert.equal(game(host)?.players.find((p) => p.id === guestId)?.connected, false);
  } finally {
    host.ws.close();
    guest.ws.close();
  }
});

test("unrelated table updates do not postpone a bot turn", async () => {
  const host = await connect();
  let updates: ReturnType<typeof setInterval> | undefined;
  try {
    host.send({ t: "create", mode: "texasholdem", name: "Host", clientId: "steady-bot-host" });
    await until(() => latest(host), "room");
    host.send({ t: "texasholdem", intent: { type: "sit", seat: 0 } });
    host.send({ t: "addBot" });
    await until(() => game(host)?.phase === "preflop" ? true : null, "deal");
    host.send({ t: "texasholdem", intent: { type: "call" } });
    const before = await until(() => {
      const g = game(host);
      return g?.turnId && isTxBotId(g.turnId) ? g : null;
    }, "bot turn");
    updates = setInterval(() => host.send({ t: "texasholdem", intent: { type: "sitIn" } }), 100);
    await until(() => {
      const g = game(host);
      return g && (g.turnId !== before.turnId || g.turnAt !== before.turnAt) ? true : null;
    }, "bot acts despite updates");
  } finally {
    clearInterval(updates);
    host.ws.close();
  }
});
