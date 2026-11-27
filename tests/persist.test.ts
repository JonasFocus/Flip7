import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { awaitingPlayerId } from "../lib/engine/index.ts";
import type { ClientMessage, Room, ServerMessage } from "../lib/protocol.ts";
import { publicId as P, startServer } from "../server/index.ts";
import { loadRooms } from "../server/persist.ts";

type RoomMsg = Extract<ServerMessage, { t: "room" }>;

async function connect(port: number) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const inbox: ServerMessage[] = [];
  ws.on("message", (d) => inbox.push(JSON.parse(d.toString()) as ServerMessage));
  await new Promise((r) => ws.once("open", r));
  let i = 0;
  const waitRoom = async (pred: (m: RoomMsg) => boolean): Promise<RoomMsg> => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      for (; i < inbox.length; i++) {
        const m = inbox[i];
        if (m?.t === "room" && pred(m)) {
          i++;
          return m;
        }
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timed out; last: ${JSON.stringify(inbox.at(-1)).slice(0, 300)}`);
  };
  return { ws, send: (m: ClientMessage) => ws.send(JSON.stringify(m)), waitRoom };
}

function flip(room: Room) {
  if (room.mode !== "virtual") throw new Error("expected a Flip room");
  return room.game;
}

const opts = { createsPerIpPerMin: Infinity, joinsPerIpPerMin: Infinity };

test("a server restart (deploy) puts everyone back into the same round", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flip-tables-"));
  const saveFile = join(dir, "tables.json");
  try {
    const first = await startServer(0, { ...opts, saveFile });
    const mom = await connect(first.port);
    mom.send({ t: "create", mode: "virtual", name: "Mom", clientId: "keep-mom" });
    const code = (await mom.waitRoom(() => true)).room.code;
    const dad = await connect(first.port);
    dad.send({ t: "join", code, name: "Dad", clientId: "keep-dad" });
    await mom.waitRoom((m) => flip(m.room).players.length === 2);
    mom.send({ t: "intent", intent: { type: "start" } });
    const before = flip((await mom.waitRoom((m) => flip(m.room).phase === "playing")).room);

    // A casino table rides along too.
    const sam = await connect(first.port);
    sam.send({ t: "create", mode: "blackjack", name: "Sam", clientId: "keep-sam" });
    const bjCode = (await sam.waitRoom(() => true)).room.code;

    await first.close();
    assert.equal(loadRooms(saveFile).length, 2);

    const second = await startServer(0, { ...opts, saveFile });
    try {
      const mom2 = await connect(second.port);
      mom2.send({ t: "join", code, name: "Mom", clientId: "keep-mom" });
      const back = await mom2.waitRoom(() => true);
      const game = flip(back.room);
      assert.equal(game.seq, before.seq, "same game, same move");
      assert.equal(game.round, before.round);
      assert.deepEqual(game.players.map((p) => p.hand), before.players.map((p) => p.hand), "same cards on the table");
      assert.equal(back.room.hostId, P("keep-mom"));
      assert.equal(game.players.find((p) => p.id === P("keep-dad"))?.connected, false, "Dad is offline until his phone reconnects");

      const dad2 = await connect(second.port);
      dad2.send({ t: "join", code, name: "Dad", clientId: "keep-dad" });
      const both = await mom2.waitRoom((m) => flip(m.room).players.every((p) => p.connected));

      // Play resumes: whoever the game waits on can move.
      const awaited = awaitingPlayerId(game);
      assert.ok(awaited);
      const mover = awaited === P("keep-mom") ? mom2 : dad2;
      const g = flip(both.room);
      mover.send({ t: "intent", intent: g.pending?.type === "chooseTarget" ? { type: "chooseTarget", targetId: g.pending.options[0] ?? "" } : g.pending ? { type: "hit" } : { type: "stay" } });
      await mom2.waitRoom((m) => flip(m.room).seq > before.seq);

      const sam2 = await connect(second.port);
      sam2.send({ t: "join", code: bjCode, name: "Sam", clientId: "keep-sam" });
      const bj = await sam2.waitRoom(() => true);
      assert.equal(bj.room.mode, "blackjack");
      mom2.ws.close();
      dad2.ws.close();
      sam2.ws.close();
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing, corrupt or foreign save file starts an empty server instead of crashing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flip-tables-"));
  const saveFile = join(dir, "tables.json");
  try {
    for (const content of [null, "{not json", JSON.stringify({ v: 999, rooms: [{}] }), JSON.stringify({ v: 1, rooms: [{ room: "x" }, 5] })]) {
      if (content !== null) writeFileSync(saveFile, content);
      const s = await startServer(0, { ...opts, saveFile });
      const rooms = (await (await fetch(`http://localhost:${s.port}/rooms`)).json()) as unknown[];
      assert.deepEqual(rooms, []);
      await s.close();
      assert.deepEqual(JSON.parse(readFileSync(saveFile, "utf8")).rooms, [], "the next save replaces the bad file");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
