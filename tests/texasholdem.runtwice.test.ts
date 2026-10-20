import assert from "node:assert/strict";
import { test } from "node:test";
import {
  REVEAL_MS,
  RUN_TWICE_ASK_MS,
  RUN_TWICE_BEAT_MS,
  START_MS,
  addTxPlayer,
  applyTxIntent,
  createTxGame,
  handLabel,
  newDeck,
  onDeadline,
  redactTx,
  serverDeadline,
  setTxConnected,
  winLines,
  type Rank,
  type TxCard,
  type TxIntent,
  type TxState,
} from "../lib/texasholdem/index.ts";
import { parseTxIntent } from "../lib/texasholdem/validate.ts";

const cd = (s: string): TxCard => ({ rank: s.slice(0, -1) as Rank, suit: s.slice(-1) as TxCard["suit"] });
const cards = (s: string) => s.trim().split(/\s+/).map(cd);
const NOW = 100_000;
const player = (s: TxState, id: string) => s.players.find((p) => p.id === id)!;

function act(s: TxState, actor: string, intent: TxIntent, now = NOW, isHost = false): TxState {
  const r = applyTxIntent(s, actor, intent, { isHost, now });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: TxState, actor: string, intent: TxIntent, isHost = false): string {
  const r = applyTxIntent(s, actor, intent, { isHost, now: NOW });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

// Seats the ids, deals a hand with rigged hole cards, and draws both boards from `board` in order.
function table(ids: string[], hole: Record<string, string>, board: string, chips: number | Record<string, number> = 2000, runTwice = true): TxState {
  let s: TxState = { ...createTxGame(), runTwice };
  ids.forEach((id, seat) => {
    s = addTxPlayer(s, { id, name: id.toUpperCase() });
    s = act(s, id, { type: "sit", seat }, 1000);
  });
  s = { ...s, players: s.players.map((p) => ({ ...p, chips: typeof chips === "number" ? chips : (chips[p.id] ?? 2000) })) };
  const started = onDeadline(s, 1000 + START_MS, () => 0.5);
  assert.equal(started.phase, "preflop");
  return {
    ...started,
    players: started.players.map((p) => ({ ...p, cards: cards(hole[p.id] ?? "2c 7d") })),
    deck: [...cards(board), ...newDeck(() => 0.5)],
  };
}

// Everyone shoves or calls until the betting is over.
function shove(s: TxState, now = NOW): TxState {
  let next = s;
  while (next.turnId && !next.runout) next = act(next, next.turnId, { type: "allIn" }, now);
  return next;
}

// Lets every deadline pass until the hand is paid out.
function finish(s: TxState): TxState {
  let next = s;
  for (let i = 0; i < 20 && next.phase !== "showdown"; i++) next = onDeadline(next, serverDeadline(next)!, () => 0.5);
  assert.equal(next.phase, "showdown");
  return next;
}

const ACES_V_KINGS = { a: "As Ad", b: "Kc Kd" };
// First board is blank for both, so aces win. The second hits a third king, so kings win.
const SPLIT_BOARDS = "2h 5s 9c Jd 3s  Kh 7h 8d 2c 3c";

test("with run it twice on, everyone in the pot is asked once the betting is over", () => {
  const s = shove(table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS));
  assert.equal(s.runout, true);
  assert.deepEqual(s.ask, { ids: ["a", "b"], yes: [] });
  assert.equal(s.dealAt, NOW + RUN_TWICE_ASK_MS);
  assert.equal(s.board.length, 0);
});

test("the host can turn it off between hands, and then nobody is asked", () => {
  const s = shove(table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS, 2000, false));
  assert.equal(s.ask, null);
  assert.equal(s.dealAt, NOW + REVEAL_MS);
  assert.equal(s.second, null);
});

test("only the host can change the setting, and only between hands", () => {
  const lobby = addTxPlayer(createTxGame(), { id: "a", name: "A" });
  assert.equal(err(lobby, "a", { type: "setRunTwice", on: false }), "Only the host can change this");
  assert.equal(act(lobby, "a", { type: "setRunTwice", on: false }, NOW, true).runTwice, false);
  const hand = table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS);
  assert.equal(err(hand, "a", { type: "setRunTwice", on: false }, true), "Change this between hands");
});

test("it runs twice only when every player says yes, then both boards run out and the pot splits by board", () => {
  let s = shove(table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS));
  s = act(s, "a", { type: "runTwice", yes: true });
  assert.deepEqual(s.ask, { ids: ["a", "b"], yes: ["a"] });
  assert.equal(s.second, null);
  s = act(s, "b", { type: "runTwice", yes: true });
  assert.equal(s.ask, null);
  assert.deepEqual(s.second, []);
  assert.equal(s.dealAt, NOW + RUN_TWICE_BEAT_MS);

  const seen: string[] = [];
  while (s.phase !== "showdown") {
    s = onDeadline(s, serverDeadline(s)!, () => 0.5);
    seen.push(`${s.board.length}/${s.second?.length ?? "-"}`);
  }
  assert.deepEqual(seen, ["3/0", "4/0", "5/0", "5/3", "5/4", "5/5", "5/5"]);
  assert.deepEqual(s.board, cards("2h 5s 9c Jd 3s"));
  assert.deepEqual(s.second, cards("Kh 7h 8d 2c 3c"));
  // Each board takes half of the 4000 pot: aces win the first, kings the second.
  assert.equal(player(s, "a").chips, 2000);
  assert.equal(player(s, "b").chips, 2000);
  assert.equal(player(s, "a").result?.won, 2000);
  assert.equal(player(s, "a").result?.hand, "Pair of Aces");
  assert.equal(player(s, "a").result?.second?.hand, "Pair of Aces");
  assert.equal(player(s, "b").result?.hand, "Pair of Kings");
  assert.equal(player(s, "b").result?.second?.hand, "Three Kings");
  assert.equal(player(s, "a").result?.second?.won, 0);
  assert.equal(player(s, "b").result?.second?.won, 2000);
  // Each winner is named for the board they won on.
  assert.equal(handLabel(player(s, "a").result), "Pair of Aces");
  assert.equal(handLabel(player(s, "b").result), "Three Kings");
});

test("winning both boards takes the whole pot", () => {
  let s = shove(table(["a", "b"], ACES_V_KINGS, "2h 5s 9c Jd 3s  4h 7h 8d 2c 3c"));
  s = act(act(s, "a", { type: "runTwice", yes: true }), "b", { type: "runTwice", yes: true });
  s = finish(s);
  assert.equal(player(s, "a").chips, 4000);
  assert.equal(player(s, "b").chips, 0);
});

test("one no, or running out the clock, deals the board once", () => {
  const asked = shove(table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS));
  const declined = act(act(asked, "a", { type: "runTwice", yes: true }), "b", { type: "runTwice", yes: false });
  assert.equal(declined.ask, null);
  assert.equal(declined.second, null);
  assert.equal(declined.board.length, 3);
  const done = finish(declined);
  assert.equal(done.second, null);
  assert.equal(player(done, "a").chips, 4000);

  const timedOut = onDeadline(act(asked, "a", { type: "runTwice", yes: true }), NOW + RUN_TWICE_ASK_MS, () => 0.5);
  assert.equal(timedOut.ask, null);
  assert.equal(timedOut.second, null);
  assert.equal(timedOut.board.length, 3);
});

test("only players still in the pot can vote, and only while the question is open", () => {
  const hand = table(["a", "b", "c"], { ...ACES_V_KINGS, c: "9c 9d" }, SPLIT_BOARDS);
  assert.equal(err(hand, "a", { type: "runTwice", yes: true }), "Nothing to vote on");
  // c folds preflop, a and b shove.
  let s = hand;
  while (s.turnId && !s.runout) s = act(s, s.turnId, s.turnId === "c" ? { type: "fold" } : { type: "allIn" });
  assert.deepEqual(s.ask?.ids.sort(), ["a", "b"]);
  assert.equal(err(s, "c", { type: "runTwice", yes: true }), "You're not in this pot");
});

test("nobody is asked when a human in the pot is offline", () => {
  const hand = table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS);
  const s = shove(setTxConnected(hand, "b", false, NOW));
  assert.equal(s.ask, null);
  assert.equal(s.dealAt, NOW + REVEAL_MS);
});

test("bots always agree, so a human decides alone", () => {
  let s = shove(table(["a", "bot-1"], { a: "As Ad", "bot-1": "Kc Kd" }, SPLIT_BOARDS));
  assert.deepEqual(s.ask, { ids: ["a"], yes: [] });
  s = act(s, "a", { type: "runTwice", yes: true });
  assert.deepEqual(s.second, []);
});

test("a table of only bots is never asked", () => {
  const s = shove(table(["bot-1", "bot-2"], { "bot-1": "As Ad", "bot-2": "Kc Kd" }, SPLIT_BOARDS));
  assert.equal(s.ask, null);
  assert.equal(s.dealAt, NOW + REVEAL_MS);
});

test("an all-in on the flop runs two turns and rivers", () => {
  let s = table(["a", "b"], ACES_V_KINGS, "2h 5s 9c  Jd 3s  Kh 4c");
  // Call to the flop, then shove there.
  while (s.board.length === 0) s = act(s, s.turnId!, s.turnId === s.bbId ? { type: "check" } : { type: "call" });
  s = onDeadline(s, serverDeadline(s)!, () => 0.5);
  s = shove(s);
  assert.equal(s.board.length, 3);
  s = act(act(s, "a", { type: "runTwice", yes: true }), "b", { type: "runTwice", yes: true });
  assert.deepEqual(s.second, s.board);
  s = finish(s);
  assert.deepEqual(s.board, cards("2h 5s 9c Jd 3s"));
  assert.deepEqual(s.second, cards("2h 5s 9c Kh 4c"));
});

test("every pot is split in half by board, side pots too, with the odd chip on the first board", () => {
  // Three equal stacks of 301 make one odd pot of 903.
  const chips = { a: 301, b: 301, c: 301 };
  let s = table(["a", "b", "c"], { a: "As Ad", b: "Kc Kd", c: "Qc Qd" }, SPLIT_BOARDS, chips);
  s = shove(s);
  s = ["a", "b", "c"].reduce((n, id) => act(n, id, { type: "runTwice", yes: true }), s);
  s = finish(s);
  const total = s.players.reduce((n, p) => n + p.chips, 0);
  assert.equal(total, 903);
  // 903 splits 452 / 451: aces take the first board, kings the second.
  assert.equal(player(s, "a").chips, 452);
  assert.equal(player(s, "b").chips, 451);
  assert.equal(player(s, "c").chips, 0);
});

test("a side pot is split by board between its own contenders", () => {
  // c is short: main pot (3 x 100) and a side pot (a vs b, 2 x 400). Queens only play for the main pot.
  const chips = { a: 500, b: 500, c: 100 };
  let s = table(["a", "b", "c"], { a: "As Ad", b: "Kc Kd", c: "Qc Qd" }, SPLIT_BOARDS, chips);
  s = shove(s);
  s = ["a", "b", "c"].reduce((n, id) => act(n, id, { type: "runTwice", yes: true }), s);
  s = finish(s);
  // Main pot 300: 150 each board. Side pot 800: 400 each board. Aces win board 1, kings board 2.
  assert.equal(player(s, "a").chips, 150 + 400);
  assert.equal(player(s, "b").chips, 150 + 400);
  assert.equal(player(s, "c").chips, 0);
});

test("the second board and the deck never reach a viewer before they are dealt", () => {
  let s = shove(table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS));
  s = act(act(s, "a", { type: "runTwice", yes: true }), "b", { type: "runTwice", yes: true });
  s = onDeadline(s, serverDeadline(s)!, () => 0.5);
  const view = redactTx(s, "a");
  assert.deepEqual(view.deck, []);
  assert.deepEqual(view.second, []);
  assert.deepEqual(view.board, cards("2h 5s 9c"));
  assert.ok(!JSON.stringify(view).includes("Kh"));
});

test("a win on only one board is not called a split", () => {
  let s = shove(table(["a", "b"], ACES_V_KINGS, SPLIT_BOARDS));
  s = finish(act(act(s, "a", { type: "runTwice", yes: true }), "b", { type: "runTwice", yes: true }));
  const lines = winLines(s.players, "a");
  assert.ok(lines.every((l) => !l.text.includes("split")));
});

test("run it twice intents parse strictly", () => {
  assert.deepEqual(parseTxIntent({ type: "runTwice", yes: true }), { type: "runTwice", yes: true });
  assert.deepEqual(parseTxIntent({ type: "setRunTwice", on: false }), { type: "setRunTwice", on: false });
  assert.equal(parseTxIntent({ type: "runTwice", yes: "true" }), null);
  assert.equal(parseTxIntent({ type: "setRunTwice" }), null);
  assert.equal(parseTxIntent({ type: "runTwice", yes: true, extra: 1 }), null);
});

test("chips are conserved when random short stacks run it twice", () => {
  let seed = 7;
  const rng = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const str = (c: TxCard) => `${c.rank}${c.suit}`;
  for (let hand = 0; hand < 200; hand++) {
    const ids = ["a", "b", "c", "d"].slice(0, 2 + Math.floor(rng() * 3));
    const chips = Object.fromEntries(ids.map((id) => [id, 50 + Math.floor(rng() * 900)]));
    const total = Object.values(chips).reduce((n, c) => n + c, 0);
    const deck = newDeck(rng).map(str);
    const hole = Object.fromEntries(ids.map((id, i) => [id, deck.slice(i * 2, i * 2 + 2).join(" ")]));
    let s = table(ids, hole, deck.slice(ids.length * 2, ids.length * 2 + 10).join(" "), chips);
    s = shove(s);
    for (const id of s.ask?.ids ?? []) s = act(s, id, { type: "runTwice", yes: true });
    s = finish(s);
    assert.ok(s.second, `hand ${hand} ran twice`);
    assert.equal(s.players.reduce((n, p) => n + p.chips, 0), total, `hand ${hand}`);
  }
});
