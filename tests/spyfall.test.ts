import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCATIONS,
  addSpyPlayer,
  applySpyIntent,
  createSpyGame,
  onDeadline,
  redactSpy,
  removeSpyPlayer,
  serverDeadline,
  setSpyConnected,
  type SpyIntent,
  type SpyState,
} from "../lib/spyfall/index.ts";

const rng = () => 0; // location = LOCATIONS[0], spy = first player ("a"), first asker = "a"

function lobby(n: number): SpyState {
  let s = createSpyGame();
  for (const id of "abcdefghij".slice(0, n)) s = addSpyPlayer(s, { id, name: id.toUpperCase() });
  return s;
}

function act(s: SpyState, actor: string, intent: SpyIntent, isHost = actor === "a"): SpyState {
  const r = applySpyIntent(s, actor, intent, { isHost, now: 1000, rng });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

const started = (n: number) => act(lobby(n), "a", { type: "start" });
const voting = (n: number) => act(started(n), "a", { type: "startVoting" });

test("start needs 3 players and host", () => {
  assert.equal(applySpyIntent(lobby(2), "a", { type: "start" }, { isHost: true, now: 0, rng }).ok, false);
  assert.equal(applySpyIntent(lobby(3), "b", { type: "start" }, { isHost: false, now: 0, rng }).ok, false);
  assert.equal(addSpyPlayer(lobby(10), { id: "z", name: "Z" }).players.length, 10);
});

test("start deals one spy, distinct roles for everyone else, timer deadline", () => {
  const s = started(5);
  const loc = LOCATIONS[0];
  assert.equal(s.phase, "questions");
  assert.equal(s.spyId, "a");
  assert.equal(s.location, loc?.name);
  assert.deepEqual(Object.keys(s.roles).sort(), ["b", "c", "d", "e"]);
  assert.equal(new Set(Object.values(s.roles)).size, 4);
  assert.ok(Object.values(s.roles).every((r) => loc?.roles.includes(r)));
  assert.equal(serverDeadline(s), 1000 + 6 * 60_000);
  assert.equal(onDeadline(s, 2000), s);
  assert.equal(onDeadline(s, 1000 + 6 * 60_000).phase, "voting");
});

test("redaction hides location/role from spy, spy from others, and votes", () => {
  let s = voting(4);
  const spyView = redactSpy(s, "a");
  assert.equal(spyView.location, null);
  assert.deepEqual(spyView.roles, {});
  assert.equal(spyView.spyId, "a");
  const bView = redactSpy(s, "b");
  assert.equal(bView.spyId, null);
  assert.ok(bView.location);
  assert.deepEqual(Object.keys(bView.roles), ["b"]);
  s = act(s, "b", { type: "vote", targetId: "c" });
  s = act(s, "c", { type: "vote", targetId: "b" });
  assert.deepEqual(redactSpy(s, "b").votes, { b: "c" });
  assert.deepEqual(redactSpy(s, "d").votes, {});
  assert.deepEqual(redactSpy(s, "d").votedIds, ["b", "c"]);
});

test("spy guess: right wins for spy, wrong wins for faithful, non-spy can't guess", () => {
  const s = started(4);
  const right = LOCATIONS[0]?.name ?? "";
  const wrong = LOCATIONS[1]?.name ?? "";
  assert.equal(applySpyIntent(s, "b", { type: "guess", location: right }, { isHost: false, now: 0 }).ok, false);
  assert.equal(applySpyIntent(s, "a", { type: "guess", location: "Mars" }, { isHost: true, now: 0 }).ok, false);
  const win = act(s, "a", { type: "guess", location: right });
  assert.equal(win.phase, "gameOver");
  assert.equal(win.result?.winner, "spy");
  assert.equal(act(s, "a", { type: "guess", location: wrong }).result?.winner, "faithful");
  assert.equal(redactSpy(win, "b").spyId, "a");
});

test("vote is changeable and resolves when all connected voted; majority on spy = faithful", () => {
  let s = voting(4);
  s = act(s, "b", { type: "vote", targetId: "c" });
  s = act(s, "b", { type: "vote", targetId: "a" });
  s = act(s, "c", { type: "vote", targetId: "a" });
  s = setSpyConnected(s, "d", false);
  assert.equal(s.phase, "voting", "spy has not voted");
  s = act(s, "a", { type: "vote", targetId: "b" });
  assert.equal(s.phase, "gameOver");
  assert.equal(s.result?.winner, "faithful");
  assert.equal(s.result?.accusedId, "a");
});

test("no majority or innocent majority = spy wins; self-vote rejected", () => {
  let s = voting(4);
  assert.equal(applySpyIntent(s, "b", { type: "vote", targetId: "b" }, { isHost: false, now: 0 }).ok, false);
  s = act(s, "a", { type: "vote", targetId: "b" });
  s = act(s, "b", { type: "vote", targetId: "c" });
  s = act(s, "c", { type: "vote", targetId: "d" });
  s = act(s, "d", { type: "vote", targetId: "a" });
  assert.equal(s.result?.winner, "spy");
  assert.equal(s.result?.accusedId, null);
});

test("removing players mid-game keeps the game consistent", () => {
  assert.equal(removeSpyPlayer(started(4), "a", { now: 0 }).result?.outcome, "spyLeft");
  assert.equal(removeSpyPlayer(started(3), "b", { now: 0 }).result?.winner, "spy");
  let s = voting(4);
  s = act(s, "b", { type: "vote", targetId: "d" });
  s = removeSpyPlayer(s, "d", { now: 0, rng });
  assert.deepEqual(s.votedIds, [], "ballot against the leaver dropped");
  assert.equal(s.roles.d, undefined);
  s = act(s, "a", { type: "vote", targetId: "b" });
  s = act(s, "b", { type: "vote", targetId: "a" });
  s = act(s, "c", { type: "vote", targetId: "a" });
  assert.equal(s.result?.winner, "faithful");
  const again = act(s, "a", { type: "playAgain" });
  assert.equal(again.phase, "lobby");
  assert.equal(again.players.length, 3);
  assert.equal(again.spyId, null);
});
