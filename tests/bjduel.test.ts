import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BET_MS,
  HANDS,
  MAX_BET,
  SETTLE_MS,
  SHUFFLE_MS,
  START_CHIPS,
  TURN_MS,
  addDuelPlayer,
  applyDuelIntent,
  betOf,
  createDuelGame,
  dealAnimMs,
  onDeadline,
  redactDuel,
  removeDuelPlayer,
  serverDeadline,
  type BjCard,
  type DuelIntent,
  type DuelState,
  type Rank,
} from "../lib/bjduel/index.ts";
import { newShoe } from "../lib/blackjack/index.ts";

const newShoeForTest = () => newShoe(() => 0.5);

const c = (rank: Rank): BjCard => ({ rank, suit: "h" });

function act(s: DuelState, actor: string, intent: DuelIntent, now = 1000): DuelState {
  const r = applyDuelIntent(s, actor, intent, { isHost: false, now });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: DuelState, actor: string, intent: DuelIntent, now = 1000): string {
  const r = applyDuelIntent(s, actor, intent, { isHost: false, now });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

const player = (s: DuelState, id: string) => s.players.find((p) => p.id === id)!;

// Two players in a started match, the shoe stacked to deal `cards` next (after the reshuffle check).
function duel(cards: Rank[] = []): DuelState {
  let s = createDuelGame();
  s = addDuelPlayer(s, { id: "a", name: "A" });
  s = addDuelPlayer(s, { id: "b", name: "B" });
  return { ...s, shoe: [...cards.map(c), ...newShoeForTest()] };
}

// Both bet `bet` with $5 chips and lock; returns the dealt state (deal happens at `now`).
function bothBet(s: DuelState, bet = 5, now = 1000): DuelState {
  for (const id of ["a", "b"]) {
    for (let i = 0; i < bet / 5; i++) s = act(s, id, { type: "chip", value: 5 }, now);
    s = act(s, id, { type: "lock" }, now);
  }
  return s;
}

test("the match starts when the second player sits down", () => {
  let s = createDuelGame();
  s = addDuelPlayer(s, { id: "a", name: "A" });
  assert.equal(s.phase, "lobby");
  s = addDuelPlayer(s, { id: "b", name: "B" });
  assert.equal(s.phase, "betting");
  assert.deepEqual(s.players.map((p) => [p.id, p.seat, p.chips]), [["a", 0, START_CHIPS], ["b", 1, START_CHIPS]]);
  assert.equal(addDuelPlayer(s, { id: "c", name: "C" }).players.length, 2);
});

test("bets are built from $1, $2 and $5 chips up to the table max", () => {
  let s = duel();
  s = act(s, "a", { type: "chip", value: 5 });
  s = act(s, "a", { type: "chip", value: 2 });
  s = act(s, "a", { type: "chip", value: 1 });
  assert.deepEqual(player(s, "a").stack, [5, 2, 1]);
  assert.equal(betOf(player(s, "a")), 8);
  s = act(s, "a", { type: "undo" });
  assert.deepEqual(player(s, "a").stack, [5, 2]);
  s = act(s, "a", { type: "clear" });
  assert.deepEqual(player(s, "a").stack, []);
  for (let i = 0; i < MAX_BET / 5; i++) s = act(s, "a", { type: "chip", value: 5 });
  assert.match(err(s, "a", { type: "chip", value: 1 }), /max/);
  assert.match(err(s, "a", { type: "chip", value: 10 as 5 }), /No such chip/);
});

test("deals once both lock in; the first lock starts the other's clock", () => {
  let s = duel();
  s = act(s, "a", { type: "chip", value: 5 });
  assert.match(err(s, "b", { type: "lock" }), /Place a bet/);
  s = act(s, "a", { type: "lock" }, 1000);
  assert.equal(s.phase, "betting");
  assert.equal(serverDeadline(s), 1000 + BET_MS);
  assert.match(err(s, "a", { type: "chip", value: 1 }), /locked/);
  s = act(s, "b", { type: "chip", value: 2 });
  s = act(s, "b", { type: "lock" }, 2000);
  assert.equal(s.phase, "playing");
  assert.equal(s.hand, 1);
  assert.equal(player(s, "a").chips, START_CHIPS - 5);
  assert.equal(player(s, "b").chips, START_CHIPS - 2);
});

test("a fresh shoe is shuffled on the felt before the first deal", () => {
  let s = createDuelGame();
  s = addDuelPlayer(s, { id: "a", name: "A" });
  s = addDuelPlayer(s, { id: "b", name: "B" });
  s = bothBet(s, 5, 1000);
  assert.equal(s.shuffled, true);
  assert.equal(s.turnAt, 1000 + SHUFFLE_MS + dealAnimMs(2));
  assert.equal(s.shoe.length, 364 - 6);
});

test("cards go round from the first seat, dealer last, and seats alternate who starts", () => {
  // a: 10, 7 · b: 9, 8 · dealer: 6, 10
  let s = duel(["10", "9", "6", "7", "8", "10"]);
  s = bothBet(s);
  assert.equal(s.shuffled, false);
  assert.deepEqual(player(s, "a").cards.map((x) => x.rank), ["10", "7"]);
  assert.deepEqual(player(s, "b").cards.map((x) => x.rank), ["9", "8"]);
  assert.deepEqual(s.dealer.map((x) => x?.rank), ["6", "10"]);
  assert.equal(s.turnId, "a");
  assert.match(err(s, "a", { type: "stand" }, 1000), /Still dealing/);
  const t = s.turnAt!;
  assert.match(err(s, "b", { type: "stand" }, t), /not your turn/);
  s = act(s, "a", { type: "stand" }, t);
  assert.equal(s.turnId, "b");
  s = act(s, "b", { type: "stand" }, t);
  assert.equal(s.phase, "settle");
  s = onDeadline(s, s.settleAt!);
  assert.equal(s.phase, "betting");
  // Bets ride again; hand 2 starts with seat 1.
  assert.equal(betOf(player(s, "b")), 5);
  s = { ...s, shoe: [...["2", "3", "4", "5", "6", "7"].map((r) => c(r as Rank)), ...s.shoe] };
  s = act(s, "a", { type: "lock" });
  s = act(s, "b", { type: "lock" });
  assert.equal(s.firstSeat, 1);
  assert.equal(s.turnId, "b");
  assert.deepEqual(player(s, "b").cards.map((x) => x.rank), ["2", "5"]);
});

test("dealer stands on 17 and pays wins, 3:2 blackjacks and pushes", () => {
  // a: A, K (blackjack) · b: 10, 7 · dealer: 10, 7
  let s = duel(["A", "10", "10", "K", "7", "7"]);
  s = bothBet(s, 10);
  assert.equal(s.turnId, "b");
  s = act(s, "b", { type: "stand" }, s.turnAt!);
  assert.equal(s.phase, "settle");
  assert.deepEqual(player(s, "a").result, { outcome: "blackjack", net: 15 });
  assert.deepEqual(player(s, "b").result, { outcome: "push", net: 0 });
  assert.equal(player(s, "a").chips, START_CHIPS + 15);
  assert.equal(player(s, "b").chips, START_CHIPS);
});

test("double stacks the bet again, takes one card and rides back to single next hand", () => {
  // a: 6, 5 → double, draws 10 · b: 10, 9 · dealer: 10, 8
  let s = duel(["6", "10", "10", "5", "9", "8", "10"]);
  s = bothBet(s, 5);
  s = act(s, "a", { type: "double" }, s.turnAt!);
  assert.deepEqual(player(s, "a").stack, [5, 5]);
  assert.equal(player(s, "a").cards.length, 3);
  assert.equal(s.turnId, "b");
  s = act(s, "b", { type: "stand" }, s.turnAt!);
  assert.deepEqual(player(s, "a").result, { outcome: "win", net: 10 });
  assert.deepEqual(player(s, "b").result, { outcome: "win", net: 5 });
  s = onDeadline(s, s.settleAt!);
  assert.deepEqual(player(s, "a").stack, [5]);
});

test("the turn clock stands for an idle player", () => {
  let s = duel(["10", "10", "10", "7", "8", "7"]);
  s = bothBet(s);
  s = onDeadline(s, s.turnAt! + TURN_MS);
  assert.equal(s.turnId, "b");
});

test("dealer blackjack settles before anyone acts", () => {
  let s = duel(["10", "9", "A", "7", "8", "K"]);
  s = bothBet(s);
  assert.equal(s.phase, "settle");
  assert.equal(player(s, "a").result?.outcome, "lose");
  assert.ok(s.settleAt! >= 1000 + dealAnimMs(2) + SETTLE_MS);
});

test("the hole card stays hidden while hands are played", () => {
  let s = duel(["10", "9", "6", "7", "8", "10"]);
  s = bothBet(s);
  const view = redactDuel(s);
  assert.equal(view.dealer[1], null);
  assert.deepEqual(view.shoe, []);
  assert.equal(view.shoeLeft, s.shoe.length);
});

test("after the last hand the match is over and a rematch needs both", () => {
  let s = duel();
  s = { ...s, hand: HANDS - 1 };
  s = { ...s, shoe: [...["10", "9", "10", "7", "8", "7"].map((r) => c(r as Rank)), ...s.shoe] };
  s = bothBet(s);
  assert.equal(s.turnId, "b"); // hand 10: seat 1 starts
  s = act(s, "b", { type: "stand" }, s.turnAt!);
  s = act(s, "a", { type: "stand" }, s.turnAt!);
  s = onDeadline(s, s.settleAt!);
  assert.equal(s.phase, "over");
  assert.deepEqual(s.players.map((p) => p.chips), [START_CHIPS, START_CHIPS]); // both pushed
  s = act(s, "a", { type: "rematch" });
  assert.equal(s.phase, "over");
  s = act(s, "b", { type: "rematch" });
  assert.equal(s.phase, "betting");
  assert.equal(s.hand, 0);
  assert.equal(s.matches, 2);
  assert.ok(s.players.every((p) => p.chips === START_CHIPS && p.stack.length === 0));
});

test("going broke ends the match early", () => {
  let s = duel(["10", "10", "10", "6", "8", "9"]);
  s = { ...s, players: s.players.map((p) => (p.id === "a" ? { ...p, chips: 5 } : p)) };
  s = bothBet(s);
  s = act(s, "a", { type: "stand" }, s.turnAt!);
  s = act(s, "b", { type: "stand" }, s.turnAt!);
  assert.equal(player(s, "a").chips, 0);
  s = onDeadline(s, s.settleAt!);
  assert.equal(s.phase, "over");
});

test("a player leaving sends the other back to wait for a new challenger", () => {
  let s = duel(["10", "9", "6", "7", "8", "10"]);
  s = bothBet(s);
  s = removeDuelPlayer(s, "a");
  assert.equal(s.phase, "lobby");
  assert.deepEqual(s.players.map((p) => [p.id, p.chips, p.cards.length]), [["b", START_CHIPS, 0]]);
  s = addDuelPlayer(s, { id: "c", name: "C" });
  assert.equal(s.phase, "betting");
  assert.equal(player(s, "c").seat, 0);
});
