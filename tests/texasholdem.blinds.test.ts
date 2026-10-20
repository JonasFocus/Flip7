import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BIG_BLIND,
  SMALL_BLIND,
  TURBO_HANDS,
  addTxPlayer,
  applyTxIntent,
  blindsFor,
  createTxGame,
  legalActions,
  onDeadline,
  serverDeadline,
  type TxIntent,
  type TxState,
} from "../lib/texasholdem/index.ts";
import { parseTxIntent } from "../lib/texasholdem/validate.ts";

const NOW = 100_000;

function apply(s: TxState, actor: string, intent: TxIntent, isHost = false): TxState {
  const r = applyTxIntent(s, actor, intent, { isHost, now: NOW });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function lobby(): TxState {
  let s = createTxGame();
  for (const [seat, id] of ["a", "b"].entries()) {
    s = addTxPlayer(s, { id, name: id.toUpperCase() });
    s = apply(s, id, { type: "sit", seat });
  }
  return s;
}

// Deals the next hand and folds it out; returns the dealt state and the lobby after it.
function playHand(s: TxState): { dealt: TxState; after: TxState } {
  const dealt = onDeadline(s, serverDeadline(s)!);
  assert.equal(dealt.phase, "preflop");
  const folded = apply(dealt, dealt.turnId!, { type: "fold" });
  assert.equal(folded.phase, "showdown");
  const after = onDeadline(folded, serverDeadline(folded)!);
  assert.equal(after.phase, "lobby");
  return { dealt, after };
}

const posted = (s: TxState) => s.players.map((p) => p.total).sort((x, y) => x - y);

test("casual keeps the opening blinds and never announces a rise", () => {
  for (const hand of [0, 9, 10, 99]) {
    assert.deepEqual(blindsFor("casual", hand), { smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND, next: null });
  }
});

test("turbo steps up every ten hands through 200/400, then holds", () => {
  const levels = [
    [0, 10, 20],
    [9, 10, 20],
    [10, 20, 40],
    [20, 30, 60],
    [30, 50, 100],
    [40, 100, 200],
    [50, 200, 400],
    [500, 200, 400],
  ] as const;
  for (const [hand, sb, bb] of levels) {
    const b = blindsFor("turbo", hand);
    assert.deepEqual([b.smallBlind, b.bigBlind], [sb, bb], `hand ${hand}`);
  }
  assert.deepEqual(blindsFor("turbo", 0).next, { smallBlind: 20, bigBlind: 40, inHands: TURBO_HANDS });
  assert.deepEqual(blindsFor("turbo", 7).next, { smallBlind: 20, bigBlind: 40, inHands: 3 });
  assert.deepEqual(blindsFor("turbo", 9).next, { smallBlind: 20, bigBlind: 40, inHands: 1 });
  assert.equal(blindsFor("turbo", 50).next, null);
});

test("a turbo table posts 10/20 for ten hands, then 20/40, and never changes blinds mid-hand", () => {
  let s = apply(lobby(), "a", { type: "setPace", pace: "turbo" }, true);
  assert.equal(s.pace, "turbo");
  for (let hand = 1; hand <= TURBO_HANDS + 1; hand++) {
    const { dealt, after } = playHand(s);
    const [sb, bb] = hand <= TURBO_HANDS ? [10, 20] : [20, 40];
    assert.deepEqual(posted(dealt), [sb, bb], `hand ${hand}`);
    assert.equal(dealt.minRaise, bb);
    assert.deepEqual(dealt.blinds, blindsFor("turbo", hand - 1));
    s = after;
  }
  assert.deepEqual(s.blinds, blindsFor("turbo", TURBO_HANDS + 1));
});

test("the lobby shows the next hand's blinds, so a rise appears at the hand boundary", () => {
  let s = apply(lobby(), "a", { type: "setPace", pace: "turbo" }, true);
  for (let hand = 1; hand < TURBO_HANDS; hand++) s = playHand(s).after;
  assert.deepEqual([s.blinds.bigBlind, s.blinds.next?.inHands], [20, 1]);
  const { dealt, after } = playHand(s);
  assert.deepEqual(dealt.blinds, s.blinds);
  assert.deepEqual([after.blinds.bigBlind, after.blinds.next?.bigBlind], [40, 60]);
});

test("choosing a pace restarts the levels from the hands already dealt", () => {
  let s = lobby();
  for (let hand = 0; hand < 3; hand++) s = playHand(s).after;
  s = apply(s, "a", { type: "setPace", pace: "turbo" }, true);
  assert.deepEqual(s.blinds, blindsFor("turbo", 0));
  assert.equal(s.minRaise, 20);
  s = apply(s, "a", { type: "setPace", pace: "casual" }, true);
  assert.deepEqual(s.blinds, blindsFor("casual", 0));
});

test("only the host can pick a pace, and only between hands", () => {
  const s = lobby();
  const asGuest = applyTxIntent(s, "b", { type: "setPace", pace: "turbo" }, { isHost: false, now: NOW });
  assert.equal(asGuest.ok, false);
  const { dealt } = playHand(s);
  const midHand = applyTxIntent(dealt, "a", { type: "setPace", pace: "turbo" }, { isHost: true, now: NOW });
  assert.equal(midHand.ok, false);
});

test("the minimum raise follows the big blind of the level", () => {
  const s = apply(lobby(), "a", { type: "setPace", pace: "turbo" }, true);
  let t = s;
  for (let hand = 0; hand < TURBO_HANDS; hand++) t = playHand(t).after;
  const dealt = onDeadline(t, serverDeadline(t)!);
  const legal = legalActions(dealt, dealt.turnId!);
  assert.equal(legal?.minRaiseTo, 40 + 40);
});

test("setPace only accepts the two presets", () => {
  assert.deepEqual(parseTxIntent({ type: "setPace", pace: "turbo" }), { type: "setPace", pace: "turbo" });
  assert.equal(parseTxIntent({ type: "setPace", pace: "hyper" }), null);
  assert.equal(parseTxIntent({ type: "setPace" }), null);
});
