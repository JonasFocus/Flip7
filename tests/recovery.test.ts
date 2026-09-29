import assert from "node:assert/strict";
import { test } from "node:test";
import { addScoreSeat, applyScoreIntent, createScoreGame } from "../lib/engine/physical.ts";
import type { ScoreIntent } from "../lib/engine/types.ts";
import * as imp from "../lib/imposter/index.ts";
import * as spy from "../lib/spyfall/index.ts";
import { parseMessage } from "../server/validate.ts";

const entry = { numbers: [12], plus: [], x2: false, busted: false };

test("scorekeeper rejects a delayed clear without erasing the next round hand", () => {
  let s = addScoreSeat(createScoreGame(), { id: "a", ownerId: "a", name: "A" });
  const act = (intent: ScoreIntent) => {
    const result = applyScoreIntent(s, "a", intent, { isHost: true });
    assert.ok(result.ok);
    s = result.state;
  };
  act({ type: "start" });
  act({ type: "finishRound", round: 1 });
  act({ type: "submitEntry", seatId: "a", round: 2, entry });
  const stale = applyScoreIntent(s, "a", { type: "clearEntry", seatId: "a", round: 1 }, { isHost: true });
  assert.deepEqual(stale, { ok: false, error: "Round already changed" });
  assert.deepEqual(s.entries.a, entry);
  assert.equal(applyScoreIntent(s, "b", { type: "clearEntry", seatId: "a", round: 2 }, { isHost: false }).ok, false);
  act({ type: "clearEntry", seatId: "a", round: 2 });
  assert.equal(s.entries.a, null);
});

test("clear protocol requires an integer round and preserves it", () => {
  for (const round of [undefined, null, "2", -1, 1.5, 10001]) {
    assert.equal(parseMessage(JSON.stringify({ t: "score", intent: { type: "clearEntry", seatId: "a", round } })), null);
  }
  const message = { t: "score", intent: { type: "clearEntry", seatId: "a", round: 2 } };
  assert.deepEqual(parseMessage(JSON.stringify(message)), message);
});

function imposterVoting() {
  let s = imp.createImposterGame();
  for (const id of "abcd") s = imp.addImposterPlayer(s, { id, name: id });
  for (const intent of [{ type: "start" }, { type: "startVoting" }] as const) {
    const r = imp.applyImposterIntent(s, "a", intent, { isHost: true, now: 1000, rng: () => 0 });
    assert.ok(r.ok);
    s = r.state;
  }
  return s;
}

function spyVoting() {
  let s = spy.createSpyGame();
  for (const id of "abcd") s = spy.addSpyPlayer(s, { id, name: id });
  for (const intent of [{ type: "start" }, { type: "startVoting" }] as const) {
    const r = spy.applySpyIntent(s, "a", intent, { isHost: true, now: 1000, rng: () => 0 });
    assert.ok(r.ok);
    s = r.state;
  }
  return s;
}

test("Imposter resolves connected abstainers at the voting deadline", () => {
  let s = imposterVoting();
  for (const actor of "bcd") {
    const r = imp.applyImposterIntent(s, actor, { type: "vote", targetId: "a" }, { isHost: false, now: 2000 });
    assert.ok(r.ok);
    s = r.state;
  }
  assert.equal(s.phase, "voting");
  assert.ok(s.players.every((p) => p.connected));
  assert.equal(imp.serverDeadline(s), 61000);
  assert.equal(imp.onDeadline(s, 60999), s);
  const resolved = imp.onDeadline(s, 61000);
  assert.equal(resolved.phase, "gameOver");
  assert.equal(resolved.winner, "faithful");
  assert.deepEqual(resolved.lastResult?.tally, { a: 3 });
  assert.equal(imp.serverDeadline(resolved), null);
  assert.equal(imp.onDeadline(resolved, 100000), resolved);
  assert.equal(resolved.seq, s.seq + 1);
});

test("Imposter zero-ballot voting continues then ends after the final round", () => {
  let s = imp.onDeadline(imposterVoting(), 61000);
  assert.equal(s.phase, "reveal");
  assert.equal(s.lastResult?.votedOutId, null);
  assert.deepEqual(s.lastResult?.tally, {});
  const next = imp.applyImposterIntent(s, "a", { type: "nextRound" }, { isHost: true, now: 70000 });
  assert.ok(next.ok);
  s = next.state;
  const cluesDue = imp.serverDeadline(s);
  assert.equal(cluesDue, 190000);
  s = imp.onDeadline(s, 190000);
  assert.equal(s.phase, "voting");
  assert.equal(imp.serverDeadline(s), 250000);
  assert.equal(imp.onDeadline(s, 190000), s, "old clue deadline cannot close new voting");
  s = imp.onDeadline(s, 250000);
  assert.equal(s.phase, "gameOver");
  assert.equal(s.winner, "imposter");
});

test("Imposter ballot changes, connections and removals keep the voting deadline", () => {
  let s = imposterVoting();
  for (const targetId of ["d", "c"]) {
    const r = imp.applyImposterIntent(s, "b", { type: "vote", targetId }, { isHost: false, now: 2000 });
    assert.ok(r.ok);
    s = r.state;
  }
  s = imp.setImposterConnected(s, "a", false);
  s = imp.setImposterConnected(s, "a", true);
  s = imp.removeImposterPlayer(s, "c");
  assert.equal(imp.serverDeadline(s), 61000);
  assert.deepEqual(s.votes, {});
  assert.equal(imp.onDeadline(s, 61000).phase, "reveal");
});

test("late Imposter ballots are rejected and full participation resolves early", () => {
  let s = imposterVoting();
  assert.equal(imp.applyImposterIntent(s, "b", { type: "vote", targetId: "a" }, { isHost: false, now: 61000 }).ok, false);
  for (const actor of "abcd") {
    const r = imp.applyImposterIntent(s, actor, { type: "vote", targetId: actor === "a" ? "b" : "a" }, { isHost: actor === "a", now: 2000 });
    assert.ok(r.ok);
    s = r.state;
  }
  assert.equal(s.phase, "gameOver");
  assert.equal(imp.serverDeadline(s), null);
  assert.equal(imp.onDeadline(s, 61000), s);
});

test("Spyfall resolves connected abstainers at the voting deadline", () => {
  let s = spyVoting();
  for (const actor of "bcd") {
    const r = spy.applySpyIntent(s, actor, { type: "vote", targetId: "a" }, { isHost: false, now: 2000 });
    assert.ok(r.ok);
    s = r.state;
  }
  assert.equal(s.phase, "voting");
  assert.ok(s.players.every((p) => p.connected));
  assert.equal(spy.onDeadline(s, 60999), s);
  const resolved = spy.onDeadline(s, 61000);
  assert.equal(resolved.phase, "gameOver");
  assert.equal(resolved.result?.winner, "faithful");
  assert.deepEqual(resolved.result?.tally, { a: 3 });
  assert.equal(spy.serverDeadline(resolved), null);
  assert.equal(spy.onDeadline(resolved, 100000), resolved);
});

test("Spyfall resolves zero ballots and re-arms voting after question timeout", () => {
  const s = spyVoting();
  const resolved = spy.onDeadline(s, 61000);
  assert.equal(resolved.phase, "gameOver");
  assert.equal(resolved.result?.outcome, "missed");
  assert.deepEqual(resolved.result?.tally, {});
  const questions: spy.SpyState = { ...s, phase: "questions", deadline: 5000 };
  const voting = spy.onDeadline(questions, 5000);
  assert.equal(voting.phase, "voting");
  assert.equal(spy.serverDeadline(voting), 65000);
  assert.equal(spy.onDeadline(voting, 5000), voting);
});

test("Spyfall ballot changes, connections and removals keep the voting deadline", () => {
  let s = spyVoting();
  for (const targetId of ["d", "c"]) {
    const r = spy.applySpyIntent(s, "b", { type: "vote", targetId }, { isHost: false, now: 2000 });
    assert.ok(r.ok);
    s = r.state;
  }
  s = spy.setSpyConnected(s, "a", false);
  s = spy.setSpyConnected(s, "a", true);
  s = spy.removeSpyPlayer(s, "c", { now: 2000 });
  assert.equal(spy.serverDeadline(s), 61000);
  assert.deepEqual(s.votes, {});
  assert.equal(spy.applySpyIntent(s, "b", { type: "vote", targetId: "a" }, { isHost: false, now: 61000 }).ok, false);
  assert.equal(spy.onDeadline(s, 61000).phase, "gameOver");
});
