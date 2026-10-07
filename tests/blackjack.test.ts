import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOLE_LEAD_MS,
  SETTLE_MS,
  SHOE_SIZE,
  START_CHIPS,
  TURN_MS,
  addBjPlayer,
  applyBjIntent,
  createBjGame,
  dealAnimMs,
  handValue,
  newShoe,
  onDeadline,
  redactBj,
  removeBjPlayer,
  streakBonus,
  type BjCard,
  type BjIntent,
  type BjState,
  type Rank,
} from "../lib/blackjack/index.ts";

const c = (rank: Rank): BjCard => ({ rank, suit: "s" });

function act(s: BjState, actor: string, intent: BjIntent, now = 1000): BjState {
  const r = applyBjIntent(s, actor, intent, { isHost: false, now });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: BjState, actor: string, intent: BjIntent): string {
  const r = applyBjIntent(s, actor, intent, { isHost: false, now: 1000 });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

// Seats a, b... in seats 0, 1... with a 100 bet each, and a shoe stacked to deal `cards` in order.
function table(ids: string[], cards: Rank[]): BjState {
  let s = createBjGame();
  ids.forEach((id, seat) => {
    s = addBjPlayer(s, { id, name: id.toUpperCase() });
    s = act(s, id, { type: "sit", seat });
    s = act(s, id, { type: "bet", amount: 100 });
  });
  return { ...s, shoe: [...cards.map(c), ...newShoe(() => 0.5)] };
}

const player = (s: BjState, id: string) => s.players.find((p) => p.id === id)!;

test("7-deck shoe holds true card counts", () => {
  const shoe = newShoe(Math.random);
  assert.equal(shoe.length, SHOE_SIZE);
  assert.equal(SHOE_SIZE, 364);
  const counts = new Map<string, number>();
  for (const card of shoe) counts.set(card.rank + card.suit, (counts.get(card.rank + card.suit) ?? 0) + 1);
  assert.equal(counts.size, 52);
  assert.ok([...counts.values()].every((n) => n === 7));
});

test("hand values handle soft aces", () => {
  assert.deepEqual(handValue([c("A"), c("6")]), { total: 17, soft: true });
  assert.deepEqual(handValue([c("A"), c("6"), c("K")]), { total: 17, soft: false });
  assert.deepEqual(handValue([c("A"), c("A"), c("9")]), { total: 21, soft: true });
  assert.equal(handValue([c("K"), null]).total, 10);
});

test("deals when everyone seated taps Deal, hides the hole card and shoe", () => {
  // deal order: a, b, dealer, a, b, dealer
  let s = table(["a", "b"], ["10", "9", "10", "7", "8", "7"]);
  s = act(s, "a", { type: "deal" });
  assert.equal(s.phase, "lobby");
  assert.ok(s.dealAt);
  s = act(s, "b", { type: "deal" });
  assert.equal(s.phase, "playing");
  assert.equal(s.turnId, "a");
  assert.equal(player(s, "a").chips, START_CHIPS - 100);
  const seen = redactBj(s);
  assert.equal(seen.dealer[1], null);
  assert.equal(seen.shoe.length, 0);
  assert.equal(seen.shoeLeft, s.shoe.length);
});

test("dealer stands on 17, pays wins, takes losses, pushes ties", () => {
  // a: 10+7=17, b: 9+8=17 then hits 4 = 21, dealer 10+7=17
  let s = table(["a", "b"], ["10", "9", "10", "7", "8", "7", "4"]);
  s = act(act(s, "a", { type: "deal" }), "b", { type: "deal" });
  s = act(s, "a", { type: "stand" });
  s = act(s, "b", { type: "hit" }); // 21 ends the turn by itself
  assert.equal(s.phase, "settle");
  assert.deepEqual(player(s, "a").result, { outcome: "push", net: 0, bonus: 0 });
  assert.equal(s.settleAt, 1000 + HOLE_LEAD_MS + SETTLE_MS); // no dealer draws: a beat, the hole card, then the read time
  assert.deepEqual(player(s, "b").result, { outcome: "win", net: 100, bonus: 0 });
  assert.equal(player(s, "b").chips, START_CHIPS + 100);
  const reset = onDeadline(s, s.settleAt!);
  assert.equal(reset.phase, "lobby");
  assert.equal(player(reset, "a").bet, 100); // rebet
  assert.equal(player(reset, "a").cards.length, 0);
});

test("blackjack pays 3:2, dealer blackjack ends the hand at once", () => {
  let s = table(["a"], ["A", "9", "K", "7"]);
  s = act(s, "a", { type: "deal" });
  assert.equal(s.phase, "settle");
  assert.deepEqual(player(s, "a").result, { outcome: "blackjack", net: 150, bonus: 0 });

  s = table(["a"], ["10", "A", "9", "K"]);
  s = act(s, "a", { type: "deal" });
  assert.equal(s.phase, "settle");
  assert.equal(player(s, "a").result?.outcome, "lose");
});

test("double takes one card and doubles the stake; bust loses", () => {
  // a: 6+5 doubles into 10 = 21; dealer 10+6 draws 9 = bust
  let s = table(["a"], ["6", "10", "5", "6", "10", "9"]);
  s = act(s, "a", { type: "deal" });
  s = act(s, "a", { type: "double" });
  assert.equal(s.phase, "settle");
  assert.equal(player(s, "a").bet, 200);
  assert.deepEqual(player(s, "a").result, { outcome: "win", net: 200, bonus: 0 });
  assert.equal(onDeadline(s, s.settleAt!).players[0]?.bet, 100); // rebet the original stake

  s = table(["a"], ["10", "10", "6", "7", "K"]);
  s = act(s, "a", { type: "deal" });
  s = act(s, "a", { type: "hit" });
  assert.equal(s.phase, "settle");
  assert.equal(s.dealer.length, 2); // nobody left to beat, dealer doesn't draw
  assert.equal(player(s, "a").chips, START_CHIPS - 100);
});

test("turn timer stands for you; leaving on your turn passes it on", () => {
  let s = table(["a", "b"], ["10", "9", "10", "7", "8", "7"]);
  s = act(act(s, "a", { type: "deal" }), "b", { type: "deal" });
  assert.equal(s.turnAt, 1000 + dealAnimMs(2)); // the clock starts once the deal animation lands
  assert.equal(onDeadline(s, 1000 + TURN_MS).turnId, "a");
  s = onDeadline(s, s.turnAt! + TURN_MS);
  assert.equal(s.turnId, "b");
  s = removeBjPlayer(s, "b", { now: 2000 });
  assert.equal(s.phase, "settle");
});

test("seats, bets and turns are guarded", () => {
  let s = table(["a", "b"], ["10", "9", "10", "7", "8", "7"]);
  s = addBjPlayer(s, { id: "c", name: "C" });
  assert.equal(err(s, "c", { type: "sit", seat: 0 }), "Seat taken");
  assert.equal(err(s, "c", { type: "sit", seat: 9 }), "No such seat");
  assert.equal(err(s, "c", { type: "bet", amount: 50 }), "Take a seat first");
  assert.equal(err(s, "a", { type: "bet", amount: 5 }), "Minimum bet is 10");
  assert.equal(err(s, "a", { type: "bet", amount: START_CHIPS + 1 }), "Not enough chips");
  s = act(act(s, "a", { type: "deal" }), "b", { type: "deal" });
  assert.equal(err(s, "b", { type: "hit" }), "It's not your turn");
  assert.equal(err(s, "a", { type: "standUp" }), "Finish your hand first");
  s = act(s, "c", { type: "sit", seat: 4 }); // walk up mid-hand, play next one
  assert.equal(player(s, "c").cards.length, 0);
});

test("win streak adds 10% per win already in the streak, capped, and a loss resets it", () => {
  // two winning hands in a row: 20 vs dealer 17 (no bonus the first time, +10 the second)
  let s = table(["a"], ["10", "10", "K", "7", "10", "10", "K", "7"]);
  s = act(s, "a", { type: "deal" });
  s = act(s, "a", { type: "stand" });
  assert.deepEqual(player(s, "a").result, { outcome: "win", net: 100, bonus: 0 });
  assert.equal(player(s, "a").streak, 1);
  s = { ...onDeadline(s, s.settleAt!), shoe: s.shoe };
  s = act(s, "a", { type: "deal" });
  s = act(s, "a", { type: "stand" });
  assert.deepEqual(player(s, "a").result, { outcome: "win", net: 110, bonus: 10 });
  assert.equal(player(s, "a").streak, 2);
  assert.equal(player(s, "a").chips, START_CHIPS + 210);

  assert.equal(streakBonus(9, 100), 50); // capped at +50%
  assert.equal(streakBonus(0, 100), 0);
});

test("a push keeps the streak, a loss resets it", () => {
  const withStreak = (s: BjState): BjState => ({ ...s, players: s.players.map((p) => ({ ...p, streak: 3 })) });
  let s = withStreak(table(["a"], ["10", "10", "7", "7"])); // 17 vs 17
  s = act(act(s, "a", { type: "deal" }), "a", { type: "stand" });
  assert.deepEqual(player(s, "a").result, { outcome: "push", net: 0, bonus: 0 });
  assert.equal(player(s, "a").streak, 3);

  s = withStreak(table(["a"], ["10", "10", "6", "K"])); // 16 vs 20
  s = act(act(s, "a", { type: "deal" }), "a", { type: "stand" });
  assert.deepEqual(player(s, "a").result, { outcome: "lose", net: -100, bonus: 0 });
  assert.equal(player(s, "a").streak, 0);
});

test("stats count hands, wins, pushes, best streak, biggest win and net", () => {
  const stats = (s: BjState) => player(s, "a").stats;
  // win 100 (20 v 17), then push (17 v 17), then lose 100 (16 v 20)
  let s = table(["a"], ["10", "10", "10", "7", "10", "10", "7", "7", "10", "10", "6", "K"]);
  s = act(act(s, "a", { type: "deal" }), "a", { type: "stand" });
  assert.deepEqual(stats(s), { hands: 1, wins: 1, pushes: 0, bestStreak: 1, biggestWin: 100, net: 100 });
  s = { ...onDeadline(s, s.settleAt!), shoe: s.shoe };
  s = act(act(s, "a", { type: "deal" }), "a", { type: "stand" });
  assert.deepEqual(stats(s), { hands: 2, wins: 1, pushes: 1, bestStreak: 1, biggestWin: 100, net: 100 });
  s = { ...onDeadline(s, s.settleAt!), shoe: s.shoe };
  s = act(act(s, "a", { type: "deal" }), "a", { type: "stand" });
  assert.deepEqual(stats(s), { hands: 3, wins: 1, pushes: 1, bestStreak: 1, biggestWin: 100, net: 0 });
});
