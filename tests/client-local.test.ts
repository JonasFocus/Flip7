import assert from "node:assert/strict";
import { test } from "node:test";
import { applyIntent, awaitingPlayerId, chooseBotIntent } from "../lib/engine/index.ts";
import { botDelay, LOCAL_ME, newLocalGame, withBot } from "../lib/client/local.ts";

test("newLocalGame seats you plus uniquely named bots", () => {
  const s = newLocalGame("  Jonas ", 3);
  assert.equal(s.players.length, 4);
  assert.equal(s.players[0]?.id, LOCAL_ME);
  assert.equal(s.players[0]?.name, "Jonas");
  assert.equal(new Set(s.players.map((p) => p.id)).size, 4);
  assert.equal(new Set(s.players.map((p) => p.name)).size, 4);
  assert.equal(withBot(s).players.length, 5);
});

test("bots can drive a local game to completion", () => {
  const start = applyIntent(newLocalGame("Me", 3), LOCAL_ME, { type: "start" }, { isHost: true });
  assert.ok(start.ok);
  let s = start.state;
  for (let i = 0; i < 5000 && s.phase !== "gameOver"; i++) {
    assert.ok(botDelay(s) >= 350);
    if (s.phase === "roundOver") {
      const r = applyIntent(s, LOCAL_ME, { type: "nextRound" }, { isHost: true });
      assert.ok(r.ok);
      s = r.state;
      continue;
    }
    const id = awaitingPlayerId(s);
    assert.ok(id, `stalled in ${s.phase}`);
    // Play the human seat with the bot heuristic too.
    const intent = chooseBotIntent(s, id);
    assert.ok(intent);
    const r = applyIntent(s, id, intent, { isHost: id === LOCAL_ME });
    assert.ok(r.ok, r.ok ? "" : r.error);
    s = r.state;
  }
  assert.equal(s.phase, "gameOver");
});
