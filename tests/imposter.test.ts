import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORIES,
  addImposterPlayer,
  applyImposterIntent,
  createImposterGame,
  redactImposter,
  type ImposterIntent,
  type ImposterState,
} from "../lib/imposter/index.ts";

const rng = () => 0; // imposter = first player ("a")

function lobby(n: number): ImposterState {
  let s = createImposterGame();
  for (const id of "abcdefghij".slice(0, n)) s = addImposterPlayer(s, { id, name: id.toUpperCase() });
  return s;
}

function act(s: ImposterState, actor: string, intent: ImposterIntent, isHost = actor === "a"): ImposterState {
  const r = applyImposterIntent(s, actor, intent, { isHost, now: 1000, rng });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function voting(n: number): ImposterState {
  return act(act(lobby(n), "a", { type: "start" }), "a", { type: "startVoting" });
}

test("start needs 3 players", () => {
  const r = applyImposterIntent(lobby(2), "a", { type: "start" }, { isHost: true, now: 0, rng });
  assert.equal(r.ok, false);
});

test("start deals exactly one imposter and a word", () => {
  const s = act(lobby(4), "a", { type: "start" });
  assert.equal(s.phase, "clues");
  assert.equal(s.imposterId, "a");
  assert.ok(s.word && CATEGORIES.some((c) => c.name === s.category && c.words.includes(s.word ?? "")));
  assert.equal(s.cluesDeadline, 1000 + 120_000);
  assert.equal(s.round, 1);
});

test("redaction hides word from imposter, imposter from others, and votes during voting", () => {
  let s = voting(4);
  assert.equal(redactImposter(s, "a").word, null);
  assert.equal(redactImposter(s, "a").imposterId, "a");
  assert.equal(redactImposter(s, "b").imposterId, null);
  assert.ok(redactImposter(s, "b").word);
  s = act(s, "b", { type: "vote", targetId: "c" });
  s = act(s, "c", { type: "vote", targetId: "b" });
  assert.deepEqual(redactImposter(s, "b").votes, { b: "c" });
  assert.deepEqual(redactImposter(s, "d").votes, {});
  assert.deepEqual(redactImposter(s, "d").votedIds, ["b", "c"]);
  assert.equal(redactImposter(lobby(3), "a").word, null);
});

test("catching the imposter wins for the faithful", () => {
  let s = voting(4);
  for (const v of ["b", "c", "d"]) s = act(s, v, { type: "vote", targetId: "a" });
  s = act(s, "a", { type: "vote", targetId: "b" });
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winner, "faithful");
  assert.equal(redactImposter(s, "b").imposterId, "a");
});

test("wrong majority eliminates, next round, second miss makes imposter win", () => {
  let s = voting(5);
  for (const v of ["a", "c", "d"]) s = act(s, v, { type: "vote", targetId: "b" });
  s = act(s, "e", { type: "vote", targetId: "a" });
  assert.equal(s.phase, "voting", "b has not voted yet");
  s = act(s, "b", { type: "vote", targetId: "a" });
  assert.equal(s.phase, "reveal");
  assert.equal(s.lastResult?.votedOutId, "b");
  assert.equal(s.players.find((p) => p.id === "b")?.eliminated, true);
  s = act(s, "a", { type: "nextRound" });
  assert.equal(s.round, 2);
  assert.equal(s.word, voting(5).word);
  s = act(s, "a", { type: "startVoting" });
  assert.equal(applyImposterIntent(s, "b", { type: "vote", targetId: "c" }, { isHost: false, now: 0 }).ok, false);
  for (const v of ["a", "d", "e"]) s = act(s, v, { type: "vote", targetId: "c" });
  s = act(s, "c", { type: "vote", targetId: "d" });
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winner, "imposter");
  s = act(s, "a", { type: "playAgain" });
  assert.equal(s.phase, "lobby");
  assert.ok(s.players.every((p) => !p.eliminated) && s.players.length === 5);
});

test("tie votes out no one", () => {
  let s = voting(4);
  s = act(s, "a", { type: "vote", targetId: "b" });
  s = act(s, "b", { type: "vote", targetId: "a" });
  s = act(s, "c", { type: "vote", targetId: "b" });
  s = act(s, "d", { type: "vote", targetId: "a" });
  assert.equal(s.phase, "reveal");
  assert.equal(s.lastResult?.votedOutId, null);
  assert.ok(s.players.every((p) => !p.eliminated));
});

test("self-vote is rejected", () => {
  const r = applyImposterIntent(voting(3), "b", { type: "vote", targetId: "b" }, { isHost: false, now: 0 });
  assert.equal(r.ok, false);
});

test("host-only intents reject non-hosts", () => {
  const s = lobby(3);
  for (const intent of [{ type: "start" }, { type: "setTimer", sec: 90 }, { type: "setCategory", categoryId: "foods" }] as const) {
    assert.equal(applyImposterIntent(s, "b", intent, { isHost: false, now: 0 }).ok, false);
  }
  assert.equal(applyImposterIntent(voting(3), "b", { type: "startVoting" }, { isHost: false, now: 0 }).ok, false);
});
