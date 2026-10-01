import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BET_MS,
  CARD_MS,
  DEAL_LEAD_MS,
  MAX_BET,
  ROAD_LENGTH,
  SETTLE_MS,
  SHOE_SIZE,
  START_CHIPS,
  addBacPlayer,
  applyBacIntent,
  createBacGame,
  handTotal,
  newShoe,
  onDeadline,
  parseBacIntent,
  redactBac,
  removeBacPlayer,
  serverDeadline,
  totalBet,
  visibleDeadline,
  type BacCard,
  type BacIntent,
  type BacRound,
  type BacState,
} from "../lib/baccarat/index.ts";
import type { Rank } from "../lib/blackjack/types.ts";

const c = (rank: Rank): BacCard => ({ rank, suit: "s" });

function act(s: BacState, actor: string, intent: BacIntent, now = 1000): BacState {
  const r = applyBacIntent(s, actor, intent, { isHost: false, now });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: BacState, actor: string, intent: BacIntent): string {
  const r = applyBacIntent(s, actor, intent, { isHost: false, now: 1000 });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

// One seated player "a" with the given bets and a shoe stacked so cards come out in `cards` order (P, B, P, B, third...).
function table(bets: Partial<Record<"player" | "banker" | "tie" | "playerPair" | "bankerPair", number>>, cards: Rank[]): BacState {
  let s = addBacPlayer(createBacGame(), { id: "a", name: "A" });
  s = act(s, "a", { type: "sit", seat: 0 });
  for (const [spot, amount] of Object.entries(bets)) {
    if (spot === "player" || spot === "banker" || spot === "tie" || spot === "playerPair" || spot === "bankerPair") s = act(s, "a", { type: "bet", spot, amount });
  }
  return { ...s, shoe: [...cards.map(c), ...newShoe(() => 0.5)] };
}

// Deal and run every reveal; returns the settled state.
function play(s: BacState): BacState {
  let next = act(s, "a", { type: "deal" }, 1000);
  assert.equal(next.phase, "dealing");
  let now = 1000;
  for (let i = 0; i < 20 && next.phase === "dealing"; i++) {
    now = serverDeadline(next)!;
    next = onDeadline(next, now);
  }
  assert.equal(next.phase, "settle");
  return next;
}

const me = (s: BacState) => s.players.find((p) => p.id === "a")!;

test("8-deck shoe holds true card counts", () => {
  const shoe = newShoe(Math.random);
  assert.equal(shoe.length, SHOE_SIZE);
  assert.equal(SHOE_SIZE, 416);
  const counts = new Map<string, number>();
  for (const card of shoe) counts.set(card.rank + card.suit, (counts.get(card.rank + card.suit) ?? 0) + 1);
  assert.equal(counts.size, 52);
  assert.ok([...counts.values()].every((n) => n === 8));
});

test("hand totals: tens and faces are zero, ace is one, mod 10", () => {
  assert.equal(handTotal([c("K"), c("10")]), 0);
  assert.equal(handTotal([c("A"), c("9")]), 0);
  assert.equal(handTotal([c("7"), c("8")]), 5);
  assert.equal(handTotal([c("5"), c("4"), c("J")]), 9);
});

test("player bet wins 1:1, losing banker bet is lost", () => {
  // P: 9+K = 9 natural, B: 2+3 = 5
  const s = play(table({ player: 100, banker: 50 }, ["9", "2", "K", "3"]));
  assert.equal(s.result?.winner, "player");
  assert.equal(s.result?.natural, true);
  assert.equal(me(s).result?.net, 50); // +100 -50
  assert.equal(me(s).chips, START_CHIPS + 50);
});

test("banker win pays 0.95:1 (floored)", () => {
  // P: 2+3 = 5 draws third; B: 9+K = 9 natural
  const s = play(table({ banker: 100 }, ["2", "9", "3", "K"]));
  assert.equal(s.result?.winner, "banker");
  assert.equal(me(s).result?.net, 95);
  const odd = play(table({ banker: 15 }, ["2", "9", "3", "K"]));
  assert.equal(me(odd).result?.net, 14); // floor(14.25)
});

test("tie pays 8:1 and pushes player and banker bets", () => {
  // P: 4+4 = 8, B: 3+5 = 8
  const s = play(table({ player: 100, banker: 100, tie: 10 }, ["4", "3", "4", "5"]));
  assert.equal(s.result?.winner, "tie");
  assert.equal(me(s).result?.net, 80);
  assert.equal(me(s).chips, START_CHIPS + 80);
  assert.equal(me(s).result?.spots.player, 0);
});

test("tie bet loses when there is no tie; pairs pay 11:1", () => {
  // P: 4+4 = 8 natural pair, B: 2+3 = 5 -> player wins
  const s = play(table({ player: 100, tie: 20, playerPair: 10, bankerPair: 10 }, ["4", "2", "4", "3"]));
  assert.equal(s.result?.playerPair, true);
  assert.equal(s.result?.bankerPair, false);
  assert.deepEqual(me(s).result?.spots, { player: 100, banker: 0, tie: -20, playerPair: 110, bankerPair: -10 });
  assert.equal(me(s).result?.net, 180);
});

test("natural 8 or 9 stands: no third cards", () => {
  // P 8, B 2: banker would draw but a natural ends the coup
  const s = play(table({ player: 100 }, ["3", "A", "5", "A"]));
  assert.equal(s.playerHand.length, 2);
  assert.equal(s.bankerHand.length, 2);
  assert.equal(s.result?.natural, true);
});

test("player draws on 0-5, stands on 6-7; banker then draws on 0-5", () => {
  // P 6 stands, B 5 draws, third card 4 -> B 9
  const s = play(table({ banker: 100 }, ["2", "2", "4", "3", "4"]));
  assert.equal(s.playerHand.length, 2);
  assert.equal(s.bankerHand.length, 3);
  assert.equal(s.result?.bankerTotal, 9);
});

// The full banker tableau against the player's third card, checked by direct enumeration.
test("banker third-card tableau", () => {
  const table3 = (b: number, x: number): boolean => {
    if (b <= 2) return true;
    if (b === 3) return x !== 8;
    if (b === 4) return x >= 2 && x <= 7;
    if (b === 5) return x >= 4 && x <= 7;
    if (b === 6) return x === 6 || x === 7;
    return false;
  };
  const rankFor = (v: number): Rank => (v === 0 ? "K" : (String(v) as Rank));
  for (let b = 0; b <= 7; b++) {
    for (let x = 0; x <= 9; x++) {
      // Player 0 (K,K... use K+K) must draw; banker two cards totalling b: (K, b)
      let s = table({ player: 100 }, [ "K", "K", "K", rankFor(b), rankFor(x)]);
      // order: P1=K, B1=K, P2=K, B2=b, then player's third = x
      s = play(s);
      assert.equal(s.playerHand.length, 3);
      assert.equal(s.bankerHand.length === 3, table3(b, x), `banker ${b} vs third ${x}`);
    }
  }
});

test("banker with 6-7 total vs player standing: 6 or 7 for banker stands; player stand on 6, banker 6 stands", () => {
  const s = play(table({ player: 100 }, ["3", "3", "3", "3"])); // 6 v 6
  assert.equal(s.playerHand.length, 2);
  assert.equal(s.bankerHand.length, 2);
  assert.equal(s.result?.winner, "tie");
});

test("reveal is staged P, B, P, B, one card per step with timing", () => {
  let s = act(table({ player: 100 }, ["2", "2", "2", "2", "9", "9"]), "a", { type: "deal" }, 1000);
  assert.equal(s.stepAt, 1000 + DEAL_LEAD_MS);
  assert.equal(serverDeadline(s), 1000 + DEAL_LEAD_MS);
  assert.equal(visibleDeadline(s), null);
  assert.equal(onDeadline(s, 1000 + DEAL_LEAD_MS - 1), s); // not yet
  const seen: number[] = [];
  let now = serverDeadline(s)!;
  while (s.phase === "dealing") {
    s = onDeadline(s, now);
    seen.push(s.playerHand.length * 10 + s.bankerHand.length);
    if (s.phase === "dealing") now = serverDeadline(s)!;
  }
  assert.deepEqual(seen.slice(0, 5), [10, 11, 21, 22, 32]); // P, B, P, B, player third
  assert.ok(now > 1000 + DEAL_LEAD_MS + 3 * CARD_MS);
});

test("redaction hides the shoe but keeps the visible hands", () => {
  const s = redactBac(table({ player: 100 }, ["2", "2", "2", "2"]));
  assert.deepEqual(s.shoe, []);
  assert.equal(s.shoeLeft, SHOE_SIZE + 4);
});

test("no leak: shoe never reaches viewers mid-deal", () => {
  let s = act(table({ player: 100 }, ["2", "2", "2", "2", "9"]), "a", { type: "deal" });
  s = onDeadline(s, serverDeadline(s)!);
  const v = redactBac(s);
  assert.equal(v.shoe.length, 0);
  assert.equal(v.playerHand.length + v.bankerHand.length, 1);
});

test("auto-deal when all bettors ready; timer starts on first bet and skips with no bets", () => {
  let s = addBacPlayer(addBacPlayer(createBacGame(), { id: "a", name: "A" }), { id: "b", name: "B" });
  s = act(s, "a", { type: "sit", seat: 0 });
  s = act(s, "b", { type: "sit", seat: 1 });
  assert.equal(s.dealAt, null);
  s = act(s, "a", { type: "bet", spot: "player", amount: 100 }, 2000);
  assert.equal(s.dealAt, 2000 + BET_MS);
  s = act(s, "a", { type: "deal" }, 2500);
  assert.equal(s.phase, "dealing"); // b has no bet, so only a's Deal is needed
  assert.equal(s.dealAt, null);
});

test("a bettor who isn't ready blocks auto-deal until the timer", () => {
  let s = addBacPlayer(addBacPlayer(createBacGame(), { id: "a", name: "A" }), { id: "b", name: "B" });
  s = act(s, "a", { type: "sit", seat: 0 });
  s = act(s, "b", { type: "sit", seat: 1 });
  s = act(s, "a", { type: "bet", spot: "player", amount: 100 }, 2000);
  s = act(s, "b", { type: "bet", spot: "banker", amount: 100 }, 2100);
  s = act(s, "a", { type: "deal" }, 2200);
  assert.equal(s.phase, "betting");
  s = act(s, "b", { type: "deal" }, 2300);
  assert.equal(s.phase, "dealing");
  assert.equal(s.players.find((p) => p.id === "a")?.chips, START_CHIPS - 100);
});

test("timer expiry deals the bettors; below minimum or empty tables skip", () => {
  let s = addBacPlayer(createBacGame(), { id: "a", name: "A" });
  s = act(s, "a", { type: "sit", seat: 0 });
  s = act(s, "a", { type: "bet", spot: "tie", amount: 10 }, 2000);
  assert.equal(onDeadline(s, 2000 + BET_MS - 1), s);
  assert.equal(onDeadline(s, 2000 + BET_MS).phase, "dealing");
  const cleared = act(s, "a", { type: "clearBets" }, 3000);
  assert.equal(cleared.dealAt, null);
  assert.equal(serverDeadline(cleared), null);
});

test("settle resets to betting, keeps lastBets for rebet, records the road", () => {
  let s = play(table({ player: 100, playerPair: 10 }, ["9", "2", "K", "3"]));
  assert.equal(s.road.length, 1);
  assert.equal(visibleDeadline(s), serverDeadline(s));
  const at = serverDeadline(s)!;
  s = onDeadline(s, at);
  assert.equal(s.phase, "betting");
  assert.equal(totalBet(me(s).bets), 0);
  assert.equal(s.result, null);
  assert.equal(s.playerHand.length, 0);
  s = act(s, "a", { type: "rebet" }, at);
  assert.deepEqual(me(s).bets, { player: 100, banker: 0, tie: 0, playerPair: 10, bankerPair: 0 });
  assert.ok(SETTLE_MS > 0);
});

test("road is capped", () => {
  let s: BacState = { ...table({ player: 10 }, ["9", "2", "K", "3"]) };
  const r: BacRound = { winner: "banker", playerTotal: 1, bankerTotal: 2, playerPair: false, bankerPair: false, natural: false };
  s = { ...s, road: Array.from({ length: ROAD_LENGTH }, () => r) };
  s = play(s);
  assert.equal(s.road.length, ROAD_LENGTH);
  assert.equal(s.road[ROAD_LENGTH - 1]?.winner, "player");
});

test("bet validation: seat, closed phase, funds, min, max, ints", () => {
  let s = addBacPlayer(createBacGame(), { id: "a", name: "A" });
  assert.match(err(s, "a", { type: "bet", spot: "player", amount: 10 }), /seat/i);
  s = act(s, "a", { type: "sit", seat: 0 });
  assert.match(err(s, "a", { type: "bet", spot: "player", amount: 5 }), /Minimum/);
  assert.match(err(s, "a", { type: "bet", spot: "player", amount: MAX_BET + 1 }), /Maximum|chips/);
  assert.match(err(s, "a", { type: "bet", spot: "player", amount: 10.5 }), /Invalid/);
  assert.match(err(s, "a", { type: "bet", spot: "player", amount: -10 }), /Invalid/);
  s = act(s, "a", { type: "bet", spot: "player", amount: 900 });
  assert.match(err(s, "a", { type: "bet", spot: "banker", amount: 200 }), /chips/);
  assert.match(err(s, "a", { type: "sit", seat: 9 }), /seat/i);
  assert.match(err(s, "ghost", { type: "deal" }), /not at this table/);
  assert.match(err(s, "a", { type: "rebet" }), /previous/);
  assert.match(err(s, "a", { type: "rebuy" }), /still have chips/);
});

test("bets are closed while dealing and settling; can't stand up with a live stake", () => {
  let s = act(table({ player: 100 }, ["2", "2", "2", "2", "9"]), "a", { type: "deal" });
  assert.match(err(s, "a", { type: "bet", spot: "player", amount: 50 }), /closed/);
  assert.match(err(s, "a", { type: "clearBets" }), /closed/);
  assert.match(err(s, "a", { type: "standUp" }), /Finish/);
  assert.match(err(s, "a", { type: "deal" }), /progress/);
  s = removeBacPlayer(s, "a", { now: 2000 });
  assert.equal(s.players.length, 0);
});

test("rebuy only when broke, only while betting", () => {
  let s = table({ player: 1000 }, ["9", "2", "K", "3"]);
  s = { ...s, players: s.players.map((p) => ({ ...p, chips: 1000 })) };
  s = play(s);
  assert.equal(me(s).chips, 2000);
  const broke: BacState = { ...s, players: s.players.map((p) => ({ ...p, chips: 5 })) };
  assert.match(err(broke, "a", { type: "rebuy" }), /finish/i);
  const betting: BacState = { ...broke, phase: "betting" };
  assert.equal(act(betting, "a", { type: "rebuy" }).players[0]?.chips, START_CHIPS);
});

test("watchers and unfunded seats are not dealt in", () => {
  let s = addBacPlayer(createBacGame(), { id: "a", name: "A" });
  s = act(s, "a", { type: "sit", seat: 0 });
  s = act(s, "a", { type: "bet", spot: "player", amount: 100 });
  s = { ...s, players: s.players.map((p) => ({ ...p, chips: 50 })) }; // stake no longer affordable
  const after = onDeadline(s, s.dealAt!);
  assert.equal(after.phase, "betting");
  assert.equal(after.dealAt, null);
});

test("parseBacIntent is strict", () => {
  assert.deepEqual(parseBacIntent({ type: "bet", spot: "tie", amount: 50 }), { type: "bet", spot: "tie", amount: 50 });
  assert.deepEqual(parseBacIntent({ type: "sit", seat: 4 }), { type: "sit", seat: 4 });
  assert.deepEqual(parseBacIntent({ type: "rebet" }), { type: "rebet" });
  for (const bad of [
    null,
    "deal",
    [],
    {},
    { type: "hit" },
    { type: "sit", seat: 5 },
    { type: "sit", seat: -1 },
    { type: "sit", seat: 1.5 },
    { type: "sit", seat: "1" },
    { type: "bet", spot: "other", amount: 10 },
    { type: "bet", spot: "tie" },
    { type: "bet", spot: "tie", amount: -1 },
    { type: "bet", spot: "tie", amount: NaN },
    { type: "bet", spot: "tie", amount: Infinity },
    { type: "bet", spot: "tie", amount: 10, extra: 1 },
    { type: "deal", amount: 10 },
    { type: "__proto__" },
  ])
    assert.equal(parseBacIntent(bad), null, JSON.stringify(bad));
});
