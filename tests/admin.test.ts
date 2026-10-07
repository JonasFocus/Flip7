import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import type { AdminEvents, AdminStats } from "../lib/admin.ts";
import type { ClientMessage, ServerMessage } from "../lib/protocol.ts";
import { Activity } from "../server/activity.ts";
import { publicId as P, startServer } from "../server/index.ts";

async function connect(port: number) {
  const ws = new WebSocket(`ws://localhost:${port}`, { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" } });
  const inbox: ServerMessage[] = [];
  ws.on("message", (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
  await new Promise((r) => ws.once("open", r));
  const waitRoom = async (pred: (m: Extract<ServerMessage, { t: "room" }>) => boolean) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const hit = inbox.find((m): m is Extract<ServerMessage, { t: "room" }> => m.t === "room" && pred(m));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("timed out waiting for room");
  };
  return { ws, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), waitRoom };
}

const get = async <T>(port: number, path: string, code: string | null): Promise<{ status: number; body: T }> => {
  const res = await fetch(`http://localhost:${port}${path}`, { headers: code === null ? {} : { Authorization: `Bearer ${code}` } });
  return { status: res.status, body: (await res.json()) as T };
};

const until = async (check: () => Promise<boolean>) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("condition never held");
};

test("admin routes need the code, which defaults to 0001", async () => {
  const server = await startServer(0);
  try {
    assert.equal((await get(server.port, "/admin/stats", null)).status, 401);
    assert.equal((await get(server.port, "/admin/stats", "1234")).status, 401);
    const ok = await get<AdminStats>(server.port, "/admin/stats", "0001");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.players, 0);
  } finally {
    await server.close();
  }
});

test("wrong codes get locked out, even the right one after that", async () => {
  const server = await startServer(0, { adminCode: "4242" });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await get(server.port, "/admin/events", String(i))).status, 401);
    assert.equal((await get(server.port, "/admin/events", "4242")).status, 429);
  } finally {
    await server.close();
  }
});

test("joins, moves, leaves and play time land in the log and stats", async () => {
  const server = await startServer(0, { createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity });
  try {
    const host = await connect(server.port);
    host.send({ t: "create", mode: "virtual", name: "Ann", clientId: "ann-secret" });
    const { room } = await host.waitRoom(() => true);
    const guest = await connect(server.port);
    guest.send({ t: "join", code: room.code, name: "Bob", clientId: "bob-secret" });
    await guest.waitRoom((m) => m.room.game.players.length === 2);
    host.send({ t: "intent", intent: { type: "start" } });
    await host.waitRoom((m) => m.room.game.phase !== "lobby");
    await new Promise((r) => setTimeout(r, 30));
    guest.send({ t: "leave" });

    let events: AdminEvents["events"] = [];
    await until(async () => {
      events = (await get<AdminEvents>(server.port, "/admin/events", "0001")).body.events;
      return events.some((e) => e.kind === "leave");
    });
    const kinds = events.map((e) => e.kind).reverse();
    assert.deepEqual(kinds.slice(0, 4), ["create", "join", "action", "start"]);
    const leave = events.find((e) => e.kind === "leave");
    assert.equal(leave?.player, P("bob-secret"));
    assert.equal(leave?.name, "Bob");
    assert.equal(leave?.device, "iPhone");
    assert.ok((leave?.ms ?? 0) >= 30);
    // The client's secret id never reaches the log, only its public hash.
    assert.ok(!JSON.stringify(events).includes("bob-secret"));

    const bob = (await get<AdminEvents>(server.port, `/admin/events?player=${P("bob-secret")}`, "0001")).body.events;
    assert.ok(bob.every((e) => e.player === P("bob-secret")));

    const stats = (await get<AdminStats>(server.port, "/admin/stats?days=1", "0001")).body;
    assert.equal(stats.players, 2);
    assert.equal(stats.visits, 1);
    assert.equal(stats.tables, 1);
    assert.equal(stats.starts, 1);
    assert.equal(stats.modes[0]?.mode, "virtual");
    assert.equal(stats.live[0]?.code, room.code);
    assert.equal(stats.daily.length, 1);
    host.ws.close();
    guest.ws.close();
  } finally {
    await server.close();
  }
});

test("the log survives a server restart when kept on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flip7-activity-"));
  try {
    const first = new Activity(join(dir, "activity.db"));
    first.log({ kind: "leave", player: "p1", name: "Ann", code: "123456", mode: "blackjack", ms: 90_000 });
    first.close();
    const second = new Activity(join(dir, "activity.db"));
    assert.equal(second.persistent, true);
    const stats = second.stats(null, []);
    assert.equal(stats.players, 1);
    assert.equal(stats.totalMs, 90_000);
    assert.equal(stats.topPlayers[0]?.favorite, "blackjack");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
