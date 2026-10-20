import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import type { ClientMessage, Room, ServerMessage } from "../lib/protocol.ts";
import { startServer } from "../server/index.ts";
import type { RunningServer } from "../server/index.ts";

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
