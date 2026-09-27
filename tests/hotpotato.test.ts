import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOOM_PAUSE_MS,
  addPotatoPlayer,
  applyPotatoIntent,
  createPotatoGame,
  onDeadline,
  redactPotato,
  removePotatoPlayer,
  serverDeadline,
  setPotatoConnected,
  visibleDeadline,
  type PotatoIntent,
  type PotatoState,
} from "../lib/hotpotato/index.ts";

const rng = () => 0; // first player starts, 12s fuse

function lobby(n: number): PotatoState {
  let s = createPotatoGame();
  for (const id of "abcdefghij".slice(0, n)) s = addPotatoPlayer(s, { id, name: id.toUpperCase() });
  return s;
}

function act(s: PotatoState, actor: string, intent: PotatoIntent, now = 0): PotatoState {
  const r = applyPotatoIntent(s, actor, intent, { isHost: actor === "a", now, rng });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

const started = (n: number, lives: 1 | 2 | 3 | 5 = 3) => act(act(lobby(n), "a", { type: "setLives", lives }), "a", { type: "start" });
const lives = (s: PotatoState, id: string) => s.players.find((p) => p.id === id)?.lives;

test("start needs 3 players and is host only", () => {
  assert.equal(applyPotatoIntent(lobby(2), "a", { type: "start" }, { isHost: true, now: 0 }).ok, false);
  assert.equal(applyPotatoIntent(lobby(3), "b", { type: "start" }, { isHost: false, now: 0 }).ok, false);
  const s = started(3);
  assert.equal(s.phase, "playing");
  assert.equal(s.holderId, "a");
  assert.equal(s.fuseAt, 12_000);
  assert.ok(s.category);
});

test("pass needs the bomb and an 800ms hold, then goes to the next seat", () => {
  const s = started(3);
  assert.equal(applyPotatoIntent(s, "b", { type: "pass" }, { isHost: false, now: 5000 }).ok, false);
  assert.equal(applyPotatoIntent(s, "a", { type: "pass" }, { isHost: true, now: 799 }).ok, false);
  const passed = act(s, "a", { type: "pass" }, 800);
  assert.equal(passed.holderId, "b");
  assert.equal(passed.heldSince, 800);
  assert.equal(passed.seq, s.seq + 1);
  assert.equal(act(act(passed, "b", { type: "pass" }, 1600), "c", { type: "pass" }, 2400).holderId, "a");
});

test("fuse is secret: redacted and never a visible deadline", () => {
  const s = started(3);
  assert.equal(serverDeadline(s), 12_000);
  assert.equal(visibleDeadline(s), null);
  assert.equal(redactPotato(s, "b").fuseAt, null);
  assert.equal(onDeadline(s, 11_999, rng), s);
});

test("boom costs the holder a life, next round starts with the player after them", () => {
  let s = act(started(3), "a", { type: "pass" }, 1000); // b holds
  s = onDeadline(s, 12_000, rng);
  assert.equal(s.phase, "boom");
  assert.deepEqual(s.lastBoom, { playerId: "b", category: started(3).category });
  assert.equal(lives(s, "b"), 2);
  assert.equal(visibleDeadline(s), 12_000 + BOOM_PAUSE_MS);
  s = onDeadline(s, 12_000 + BOOM_PAUSE_MS, rng);
  assert.equal(s.phase, "playing");
  assert.equal(s.round, 2);
  assert.equal(s.holderId, "c");
  assert.notEqual(s.category, started(3).category, "random mode rotates prompts");
});

test("out players are skipped and last alive wins", () => {
  let s = started(3, 1);
  s = onDeadline(s, 12_000, rng); // a out
  assert.equal(lives(s, "a"), 0);
  s = onDeadline(s, 20_000, rng);
  assert.equal(s.holderId, "b");
  s = act(s, "b", { type: "pass" }, 21_000);
  s = act(s, "c", { type: "pass" }, 22_000);
  assert.equal(s.holderId, "b", "a is skipped");
  s = onDeadline(s, 40_000, rng);
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winnerId, "c");
  s = act(s, "a", { type: "playAgain" });
  assert.equal(s.phase, "lobby");
  assert.ok(s.players.every((p) => p.lives === 1));
});

test("offline holder auto-passes after 5s", () => {
  let s = setPotatoConnected(started(3), "a", false);
  assert.equal(serverDeadline(s), 5000);
  s = onDeadline(s, 5000, rng);
  assert.equal(s.holderId, "b");
  assert.equal(serverDeadline(s), 12_000);
});

test("removing the holder mid-game passes the bomb; down to one ends the game", () => {
  let s = removePotatoPlayer(started(3), "a", { now: 3000 });
  assert.equal(s.holderId, "b");
  assert.equal(s.heldSince, 3000);
  s = removePotatoPlayer(s, "c", { now: 4000 });
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winnerId, "b");
});

test("bad settings and unknown intents are rejected", () => {
  const s = lobby(3);
  assert.equal(applyPotatoIntent(s, "a", { type: "setCategory", categoryId: "nope" }, { isHost: true, now: 0 }).ok, false);
  assert.equal(applyPotatoIntent(s, "a", JSON.parse('{"type":"setLives","lives":99}'), { isHost: true, now: 0 }).ok, false);
  assert.equal(applyPotatoIntent(s, "a", JSON.parse('{"type":"hack"}'), { isHost: true, now: 0 }).ok, false);
  assert.equal(applyPotatoIntent(s, "zz", { type: "pass" }, { isHost: false, now: 0 }).ok, false);
});
