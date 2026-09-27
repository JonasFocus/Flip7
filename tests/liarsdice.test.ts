import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDicePlayer,
  applyDiceIntent,
  createDiceGame,
  onDeadline,
  redactDice,
  removeDicePlayer,
  serverDeadline,
  setDiceConnected,
  visibleDeadline,
  type DiceIntent,
  type DiceState,
} from "../lib/liarsdice/index.ts";

const rng = () => 0; // every die rolls 1, first alive player starts

function lobby(n: number): DiceState {
  let s = createDiceGame();
  for (const id of "abcdefgh".slice(0, n)) s = addDicePlayer(s, { id, name: id.toUpperCase() });
  return s;
}

function act(s: DiceState, actor: string, intent: DiceIntent, now = 1000): DiceState {
  const r = applyDiceIntent(s, actor, intent, { isHost: actor === "a", now, rng });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: DiceState, actor: string, intent: DiceIntent): string {
  const r = applyDiceIntent(s, actor, intent, { isHost: actor === "a", now: 1000, rng });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

// Started game with fixed dice per player; "a" to act.
function rigged(dice: Record<string, number[]>): DiceState {
  const s = act(lobby(Object.keys(dice).length), "a", { type: "start" });
  return { ...s, players: s.players.map((p) => ({ ...p, dice: dice[p.id] ?? [], diceCount: (dice[p.id] ?? []).length })) };
}

test("start needs 2 players and the host; rolls startDice each", () => {
  assert.match(err(lobby(1), "a", { type: "start" }), /at least 2/);
  assert.match(err(lobby(3), "b", { type: "start" }), /host/);
  const s = act(act(lobby(3), "a", { type: "setDice", count: 3 }), "a", { type: "start" });
  assert.equal(s.phase, "bidding");
  assert.equal(s.round, 1);
  assert.equal(s.turnId, "a");
  assert.ok(s.players.every((p) => p.diceCount === 3 && p.dice.length === 3 && p.dice.every((d) => d >= 1 && d <= 6)));
  assert.equal(addDicePlayer(s, { id: "z", name: "Z" }), s);
});

test("bids must raise, skip ones, respect turn order", () => {
  let s = rigged({ a: [2, 3], b: [4, 5], c: [6, 6] });
  assert.match(err(s, "b", { type: "bid", count: 1, face: 2 }), /not your turn/);
  assert.match(err(s, "a", { type: "bid", count: 1, face: 1 }), /face/);
  assert.match(err(s, "a", { type: "liar" }), /no bid/);
  assert.match(err(s, "a", { type: "bid", count: 7, face: 2 }), /count/);
  s = act(s, "a", { type: "bid", count: 2, face: 4 });
  assert.equal(s.turnId, "b");
  assert.match(err(s, "b", { type: "bid", count: 2, face: 3 }), /raise/);
  assert.match(err(s, "b", { type: "bid", count: 2, face: 4 }), /raise/);
  s = act(s, "b", { type: "bid", count: 2, face: 5 });
  s = act(s, "c", { type: "bid", count: 3, face: 2 });
  assert.equal(s.turnId, "a");
  assert.deepEqual(s.bid, { count: 3, face: 2 });
});

test("liar: ones are wild; a bid that holds costs the caller a die", () => {
  let s = rigged({ a: [5, 1], b: [5, 2], c: [3, 3] });
  s = act(s, "a", { type: "bid", count: 3, face: 5 });
  s = act(s, "b", { type: "liar" }, 2000);
  assert.equal(s.phase, "reveal");
  assert.deepEqual(s.lastChallenge, { bidderId: "a", callerId: "b", bid: { count: 3, face: 5 }, total: 3, loserId: "b" });
  assert.equal(s.players.find((p) => p.id === "b")?.diceCount, 1);
  assert.equal(serverDeadline(s), 8000);
});

test("liar on an overbid costs the bidder; next round starts with the loser", () => {
  let s = rigged({ a: [2, 2], b: [3, 4] });
  s = act(s, "a", { type: "bid", count: 4, face: 2 });
  s = act(s, "b", { type: "liar" });
  assert.equal(s.lastChallenge?.loserId, "a");
  assert.equal(onDeadline(s, 6999), s);
  s = onDeadline(s, 7000, rng);
  assert.equal(s.phase, "bidding");
  assert.equal(s.turnId, "a");
  assert.deepEqual(s.players.map((p) => p.dice.length), [1, 2]);
});

test("last player with dice wins", () => {
  let s = rigged({ a: [2], b: [3, 4] });
  s = act(s, "a", { type: "bid", count: 3, face: 2 });
  s = act(s, "b", { type: "liar" });
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winnerId, "b");
  s = act(s, "a", { type: "playAgain" });
  assert.equal(s.phase, "lobby");
  assert.equal(s.players.length, 2);
});

test("redaction hides others' dice until the reveal, counts always visible", () => {
  let s = rigged({ a: [2, 3], b: [4, 5] });
  const forB = redactDice(s, "b");
  assert.deepEqual(forB.players.map((p) => p.dice), [[], [4, 5]]);
  assert.deepEqual(forB.players.map((p) => p.diceCount), [2, 2]);
  s = act(s, "a", { type: "bid", count: 1, face: 2 });
  s = act(s, "b", { type: "liar" });
  assert.deepEqual(redactDice(s, "b").players.map((p) => p.dice), [[2, 3], [4, 5]]);
});

test("offline turn player is auto-played after 30s", () => {
  let s = rigged({ a: [2, 2], b: [3, 4] });
  s = setDiceConnected(s, "a", false, 5000);
  assert.equal(visibleDeadline(s), 35_000);
  assert.equal(onDeadline(s, 34_999), s);
  s = onDeadline(s, 35_000, rng);
  assert.deepEqual(s.bid, { count: 1, face: 2 });
  assert.equal(s.turnId, "b");
  assert.equal(serverDeadline(s), null);
});

test("removing players mid-round rerolls or ends the game", () => {
  let s = rigged({ a: [2, 2], b: [3, 4], c: [5] });
  s = act(s, "a", { type: "bid", count: 2, face: 2 });
  s = removeDicePlayer(s, "b", { now: 2000, rng });
  assert.equal(s.phase, "bidding");
  assert.equal(s.round, 1);
  assert.equal(s.bid, null);
  assert.equal(s.turnId, "c");
  s = removeDicePlayer(s, "c", { now: 3000, rng });
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winnerId, "a");
});

test("an eliminated player leaving mid-bid keeps the round and bid", () => {
  let s = rigged({ a: [2, 2], b: [3, 4], c: [] });
  s = act(s, "a", { type: "bid", count: 2, face: 2 });
  const dice = s.players.map((p) => p.dice);
  s = removeDicePlayer(s, "c", { now: 2000, rng });
  assert.equal(s.phase, "bidding");
  assert.deepEqual(s.bid, { count: 2, face: 2 });
  assert.equal(s.turnId, "b");
  assert.deepEqual(s.players.map((p) => p.dice), dice.slice(0, 2));
});
