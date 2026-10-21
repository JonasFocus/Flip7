import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HISTORY_HANDS,
  START_MS,
  addTxPlayer,
  applyTxIntent,
  createTxGame,
  newDeck,
  onDeadline,
  redactTx,
  type Rank,
  type TxCard,
  type TxIntent,
  type TxState,
} from "../lib/texasholdem/index.ts";

const cd = (s: string): TxCard => ({ rank: s.slice(0, -1) as Rank, suit: s.slice(-1) as TxCard["suit"] });
const NOW = 100_000;
const rng = () => 0.5;

function act(s: TxState, actor: string, intent: TxIntent): TxState {
  const r = applyTxIntent(s, actor, intent, { isHost: false, now: NOW });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

// Seats ids in seats 0.. and deals a hand with rigged hole cards and board.
function table(ids: string[], hole: Record<string, string[]>, board: string[]): TxState {
  let s = createTxGame();
  ids.forEach((id, seat) => {
    s = addTxPlayer(s, { id, name: id.toUpperCase() });
    s = act(s, id, { type: "sit", seat });
  });
  const started = onDeadline(s, NOW + START_MS, rng);
  return { ...started, players: started.players.map((p) => ({ ...p, cards: hole[p.id]!.map(cd) })), deck: [...board.map(cd), ...newDeck(rng)] };
}

const recapPlayer = (s: TxState, id: string, hand = 0) => s.history[hand]!.players.find((p) => p.id === id)!;
const settle = (s: TxState) => onDeadline(s, s.settleAt!, rng);

// a folds, b and c check it down: b's aces beat c's queens.
function threeWayShowdown(): TxState {
  let s = table(["a", "b", "c"], { a: ["Ks", "Kh"], b: ["As", "Ah"], c: ["Qc", "Qd"] }, ["2c", "7d", "9h", "Jc", "3s"]);
  s = act(s, "a", { type: "fold" });
  s = act(act(s, "b", { type: "call" }), "c", { type: "check" });
  for (let i = 0; i < 3; i++) s = act(act(s, "b", { type: "check" }), "c", { type: "check" });
  assert.equal(s.phase, "showdown");
  return settle(s);
}

test("a finished hand is recapped with board, hands, winners and amounts once the table clears", () => {
  const s = threeWayShowdown();
  assert.equal(s.phase, "lobby");
  assert.equal(s.history.length, 1);
  const [h] = s.history;
  assert.equal(h!.round, 1);
  assert.deepEqual(h!.board, ["2c", "7d", "9h", "Jc", "3s"].map(cd));
  assert.equal(h!.pot, 40);
  assert.deepEqual(
    h!.players.map((p) => p.id),
    ["a", "b", "c"],
  );
  assert.deepEqual([recapPlayer(s, "b").won, recapPlayer(s, "b").net], [40, 20]);
  assert.deepEqual([recapPlayer(s, "c").won, recapPlayer(s, "c").net], [0, -20]);
  assert.equal(recapPlayer(s, "b").hand, "Pair of Aces");
  assert.equal(recapPlayer(s, "a").folded, true);
  assert.equal(recapPlayer(s, "a").hand, null);
});

test("recap redaction: shown-down hands are public, mucked hands stay hidden from everyone but their owner", () => {
  const s = threeWayShowdown();
  for (const viewer of ["b", "c", "watcher"]) {
    const v = redactTx(s, viewer);
    assert.deepEqual(recapPlayer(v, "a").cards, [null, null], viewer);
    assert.deepEqual(recapPlayer(v, "b").cards, ["As", "Ah"].map(cd), viewer);
    assert.deepEqual(recapPlayer(v, "c").cards, ["Qc", "Qd"].map(cd), viewer);
  }
  assert.deepEqual(recapPlayer(redactTx(s, "a"), "a").cards, ["Ks", "Kh"].map(cd));
  assert.deepEqual(recapPlayer(s, "a").cards, ["Ks", "Kh"].map(cd)); // the server keeps the truth
});

test("a fold win stays hidden in the recap unless the winner turned it face up", () => {
  const fold = (show: boolean) => {
    let s = table(["a", "b"], { a: ["2s", "7h"], b: ["Kc", "Kd"] }, []);
    s = act(s, "a", { type: "fold" });
    if (show) s = act(s, "b", { type: "show" });
    return settle(s);
  };
  const hidden = redactTx(fold(false), "a");
  assert.deepEqual(recapPlayer(hidden, "b").cards, [null, null]);
  assert.deepEqual(recapPlayer(hidden, "a").cards, ["2s", "7h"].map(cd));
  assert.equal(recapPlayer(hidden, "b").won, 30);
  assert.equal(recapPlayer(hidden, "a").net, -10);
  assert.deepEqual(recapPlayer(redactTx(fold(true), "a"), "b").cards, ["Kc", "Kd"].map(cd));
});

test("the recap keeps only the last few hands, newest first", () => {
  let s = table(["a", "b"], { a: ["2s", "7h"], b: ["Kc", "Kd"] }, []);
  for (let i = 0; i < HISTORY_HANDS + 2; i++) {
    s = act(s, s.turnId!, { type: "fold" });
    s = settle(s);
    s = onDeadline(s, s.startAt!, rng);
    assert.equal(s.phase, "preflop");
  }
  assert.equal(s.history.length, HISTORY_HANDS);
  assert.deepEqual(
    s.history.map((h) => h.round),
    [7, 6, 5, 4, 3],
  );
});
