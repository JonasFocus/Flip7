import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BET_MS,
  LAND_MS,
  MAX_INSIDE,
  MAX_PLACEMENTS,
  POCKETS,
  SETTLE_MS,
  SPIN_MS,
  START_CHIPS,
  addRlPlayer,
  applyRlIntent,
  betTotals,
  colorOf,
  createRlGame,
  cornerSpot,
  isRlSpot,
  lineSpot,
  onDeadline,
  parseRlIntent,
  redactRl,
  removeRlPlayer,
  serverDeadline,
  spotNumbers,
  spotPayout,
  splitSpot,
  straightSpot,
  streetSpot,
  type RlIntent,
  type RlSpot,
  type RlState,
} from "../lib/roulette/index.ts";

// rng that lands on pocket n (rng() * 37 floors to n)
const landOn = (n: number) => () => (n + 0.5) / 37;

function act(s: RlState, actor: string, intent: RlIntent, now = 1000): RlState {
  const r = applyRlIntent(s, actor, intent, { isHost: false, now, rng: landOn(0) });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: RlState, actor: string, intent: RlIntent): string {
  const r = applyRlIntent(s, actor, intent, { isHost: false, now: 1000 });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

function seated(ids: string[]): RlState {
  let s = createRlGame();
  ids.forEach((id, seat) => {
    s = addRlPlayer(s, { id, name: id.toUpperCase() });
    s = act(s, id, { type: "sit", seat });
  });
  return s;
}

const place = (s: RlState, id: string, spot: RlSpot, amount: number, now = 1000) => act(s, id, { type: "place", spot, amount }, now);
const player = (s: RlState, id: string) => s.players.find((p) => p.id === id)!;

// Bets on one spot, ready up (solo table), spins on n, and runs to settle.
function playOut(s: RlState, n: number): RlState {
  const spun = onDeadline(s, 1000 + BET_MS, landOn(n));
  assert.equal(spun.phase, "spinning");
  return onDeadline(spun, spun.landAt!);
}

test("wheel has 37 distinct pockets and standard colors", () => {
  assert.equal(POCKETS.length, 37);
  assert.equal(new Set(POCKETS).size, 37);
  assert.equal(colorOf(0), "green");
  assert.equal(colorOf(1), "red");
  assert.equal(colorOf(2), "black");
  assert.equal(colorOf(36), "red");
  const reds = Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => colorOf(n) === "red");
  assert.equal(reds.length, 18);
  for (let i = 0; i < 37; i++) {
    const a = POCKETS[i]!;
    const b = POCKETS[(i + 1) % 37]!;
    if (a !== 0 && b !== 0) assert.notEqual(colorOf(a), colorOf(b), `${a}/${b} alternate`);
  }
});

test("spot geometry and payouts", () => {
  const cases: [RlSpot, number[], number][] = [
    [straightSpot(0), [0], 35],
    [straightSpot(17), [17], 35],
    [splitSpot(8, 5), [5, 8], 17],
    [splitSpot(0, 2), [0, 2], 17],
    [splitSpot(1, 2), [1, 2], 17],
    [streetSpot(1), [1, 2, 3], 11],
    [streetSpot(34), [34, 35, 36], 11],
    [cornerSpot(1), [1, 2, 4, 5], 8],
    [cornerSpot(32), [32, 33, 35, 36], 8],
    [lineSpot(1), [1, 2, 3, 4, 5, 6], 5],
    [lineSpot(31), [31, 32, 33, 34, 35, 36], 5],
    ["col:1", [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34], 2],
    ["col:3", [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36], 2],
    ["doz:2", [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], 2],
    ["low", Array.from({ length: 18 }, (_, i) => i + 1), 1],
    ["high", Array.from({ length: 18 }, (_, i) => i + 19), 1],
    ["odd", Array.from({ length: 18 }, (_, i) => 2 * i + 1), 1],
    ["even", Array.from({ length: 18 }, (_, i) => 2 * i + 2), 1],
  ];
  for (const [spot, nums, pay] of cases) {
    assert.deepEqual(spotNumbers(spot), nums, spot);
    assert.equal(spotPayout(spot), pay, spot);
  }
  assert.equal(spotNumbers("red")?.length, 18);
  assert.equal(spotNumbers("black")?.length, 18);
  assert.ok(spotNumbers("red")!.every((n) => colorOf(n) === "red"));
});

test("invalid spots are rejected", () => {
  for (const bad of ["n:37", "n:-1", "n:01", "n:1.5", "s:1-3", "s:3-4", "s:2-1", "s:36-37", "s:0-4", "t:2", "t:37", "t:0", "l:34", "l:2", "c:3", "c:33", "c:0", "col:4", "doz:0", "green", "", "n:", "constructor", "toString"]) {
    assert.equal(isRlSpot(bad), false, bad);
  }
  assert.equal(isRlSpot(5), false);
});

test("straight up pays 35 to 1 and returns the stake", () => {
  let s = seated(["a"]);
  s = place(s, "a", "n:17", 10);
  assert.equal(player(s, "a").chips, START_CHIPS - 10);
  s = playOut(s, 17);
  assert.equal(s.phase, "settle");
  assert.equal(s.result, 17);
  assert.equal(player(s, "a").chips, START_CHIPS - 10 + 360);
  assert.deepEqual(player(s, "a").result, { net: 350, payout: 360 });
  assert.deepEqual(s.history, [17]);
});

test("every bet type pays its odds on a win and loses otherwise", () => {
  const wins: [RlSpot, number, number][] = [
    ["n:7", 7, 35],
    [splitSpot(7, 8), 8, 17],
    [streetSpot(7), 9, 11],
    [cornerSpot(7), 11, 8],
    [lineSpot(7), 12, 5],
    ["col:2", 14, 2],
    ["doz:3", 30, 2],
    ["red", 3, 1],
    ["black", 2, 1],
    ["odd", 9, 1],
    ["even", 10, 1],
    ["low", 18, 1],
    ["high", 19, 1],
  ];
  for (const [spot, n, to] of wins) {
    const w = playOut(place(seated(["a"]), "a", spot, 10), n);
    assert.equal(player(w, "a").result?.net, 10 * to, `${spot} wins on ${n}`);
  }
  for (const spot of ["n:7", "red", "black", "odd", "even", "low", "high", "col:1", "doz:1"] as RlSpot[]) {
    const l = playOut(place(seated(["a"]), "a", spot, 10), 0);
    assert.equal(player(l, "a").result?.net, -10, `${spot} loses on zero`);
  }
});

test("multiple bets net out and totals aggregate per spot", () => {
  let s = seated(["a"]);
  s = place(s, "a", "red", 25);
  s = place(s, "a", "red", 25);
  s = place(s, "a", "n:3", 10);
  assert.deepEqual(betTotals(player(s, "a").bets), [
    { spot: "red", amount: 50 },
    { spot: "n:3", amount: 10 },
  ]);
  s = playOut(s, 3); // red and straight both win: 100 + 360 back for 60 staked
  assert.equal(player(s, "a").result?.net, 50 + 350);
  assert.equal(player(s, "a").chips, START_CHIPS + 400);
});

test("betting rules: seat, chips, limits, minimum, placement cap", () => {
  let s = createRlGame();
  s = addRlPlayer(s, { id: "a", name: "A" });
  assert.equal(err(s, "a", { type: "place", spot: "red", amount: 10 }), "Take a seat first");
  s = act(s, "a", { type: "sit", seat: 0 });
  assert.match(err(s, "a", { type: "place", spot: "red", amount: 4 }), /Minimum/);
  assert.match(err(s, "a", { type: "place", spot: "red", amount: START_CHIPS + 5 }), /Not enough/);
  assert.match(err(s, "a", { type: "place", spot: "n:1", amount: MAX_INSIDE + 5 }), /limit/);
  s = place(s, "a", "n:1", MAX_INSIDE);
  assert.match(err(s, "a", { type: "place", spot: "n:1", amount: 5 }), /limit/);
  assert.equal(err(s, "a", { type: "place", spot: "n:99" as RlSpot, amount: 10 }), "No such bet");
  let t = seated(["b"]);
  for (let i = 0; i < MAX_PLACEMENTS; i++) t = place(t, "b", "red", 5);
  assert.match(err(t, "b", { type: "place", spot: "red", amount: 5 }), /Too many/);
  assert.equal(err(seated(["x"]), "ghost", { type: "undo" }), "You are not at this table");
});

test("undo, clear, double and rebet", () => {
  let s = seated(["a"]);
  assert.equal(err(s, "a", { type: "undo" }), "Nothing to undo");
  s = place(s, "a", "red", 25);
  s = place(s, "a", "n:3", 10);
  s = act(s, "a", { type: "undo" });
  assert.equal(player(s, "a").chips, START_CHIPS - 25);
  s = act(s, "a", { type: "double" });
  assert.deepEqual(betTotals(player(s, "a").bets), [{ spot: "red", amount: 50 }]);
  assert.equal(player(s, "a").chips, START_CHIPS - 50);
  s = act(s, "a", { type: "clear" });
  assert.equal(player(s, "a").chips, START_CHIPS);
  assert.equal(s.spinAt, null);
  assert.equal(err(s, "a", { type: "rebet" }), "No previous bets");

  s = place(s, "a", "red", 25);
  s = place(s, "a", "n:3", 10);
  s = playOut(s, 0);
  s = onDeadline(s, s.settleAt!);
  assert.equal(s.phase, "betting");
  s = act(s, "a", { type: "rebet" });
  assert.deepEqual(betTotals(player(s, "a").bets), [
    { spot: "red", amount: 25 },
    { spot: "n:3", amount: 10 },
  ]);
  assert.equal(err(s, "a", { type: "rebet" }), "Clear the table first");
  assert.match(err(place(act(s, "a", { type: "clear" }), "a", "n:1", MAX_INSIDE), "a", { type: "double" }), /limit/);
});

test("double cannot exceed the bankroll", () => {
  let s = seated(["a"]);
  s = place(s, "a", "red", 600);
  assert.equal(err(s, "a", { type: "double" }), "Not enough chips");
});

test("spin clock starts at the first bet and spins at the deadline", () => {
  let s = seated(["a", "b"]);
  assert.equal(serverDeadline(s), null);
  assert.equal(onDeadline(s, 1e9).phase, "betting");
  s = place(s, "a", "red", 10, 1000);
  assert.equal(s.spinAt, 1000 + BET_MS);
  s = place(s, "b", "black", 10, 5000);
  assert.equal(s.spinAt, 1000 + BET_MS);
  assert.equal(onDeadline(s, 1000 + BET_MS - 1, landOn(3)), s);
  const spun = onDeadline(s, 1000 + BET_MS, landOn(3));
  assert.equal(spun.phase, "spinning");
  assert.equal(spun.landAt, 1000 + BET_MS + SPIN_MS);
  assert.equal(spun.round, 1);
  assert.match(err(spun, "a", { type: "place", spot: "red", amount: 5 }), /closed/);
  const settled = onDeadline(spun, spun.landAt!);
  assert.equal(settled.settleAt, spun.landAt! + SETTLE_MS);
  assert.ok(SETTLE_MS > LAND_MS);
  assert.equal(player(settled, "a").result?.net, 10); // 3 is red
  assert.equal(player(settled, "b").result?.net, -10);
  const reopened = onDeadline(settled, settled.settleAt!);
  assert.equal(reopened.phase, "betting");
  assert.equal(reopened.players.every((p) => p.bets.length === 0 && p.result === null && !p.ready), true);
  assert.equal(reopened.result, null);
});

test("spins early once every seated bettor is ready", () => {
  let s = seated(["a", "b", "c"]);
  s = place(s, "a", "red", 10);
  s = place(s, "b", "black", 10);
  s = act(s, "a", { type: "ready" });
  assert.equal(s.phase, "betting");
  const r = applyRlIntent(s, "b", { type: "ready" }, { isHost: false, now: 2000, rng: landOn(5) });
  assert.ok(r.ok);
  assert.equal(r.state.phase, "spinning"); // c has no bets so does not hold the table
  assert.equal(r.state.landAt, 2000 + SPIN_MS);
  assert.equal(err(s, "c", { type: "ready" }), "Place a bet first");
});

test("changing a bet un-readies, and clearing the last bet stops the clock", () => {
  let s = seated(["a"]);
  s = place(s, "a", "red", 10);
  s = act(s, "a", { type: "undo" });
  assert.equal(s.spinAt, null);
  s = place(s, "a", "red", 10);
  assert.equal(player(s, "a").ready, false);
});

test("result is redacted while spinning and visible after", () => {
  let s = place(seated(["a"]), "a", "red", 10);
  const spun = onDeadline(s, s.spinAt!, landOn(23));
  assert.equal(spun.result, 23);
  assert.equal(redactRl(spun).result, null);
  assert.ok(!JSON.stringify(redactRl(spun)).includes('"result":23'));
  const settled = onDeadline(spun, spun.landAt!);
  assert.equal(redactRl(settled).result, 23);
  s = redactRl(settled);
  assert.deepEqual(s.history, [23]);
});

test("a stale spin deadline with no bets keeps betting open", () => {
  const s = seated(["a"]);
  assert.equal(onDeadline({ ...s, spinAt: 1 }, 100).phase, "betting");
});

test("history keeps the last 20 results", () => {
  let s = seated(["a"]);
  for (let i = 0; i < 25; i++) {
    s = place(s, "a", "red", 5, 1000);
    s = playOut(s, i % 37);
    s = onDeadline(s, s.settleAt!);
  }
  assert.equal(s.history.length, 20);
  assert.deepEqual(s.history, Array.from({ length: 20 }, (_, i) => i + 5));
});

test("seats: taken, range, standing up refunds, no leaving a live spin", () => {
  let s = seated(["a", "b"]);
  assert.equal(err(s, "b", { type: "sit", seat: 0 }), "Seat taken");
  assert.equal(err(s, "b", { type: "sit", seat: 8 }), "No such seat");
  assert.equal(err(s, "b", { type: "sit", seat: 1.5 }), "No such seat");
  s = place(s, "a", "red", 100);
  s = act(s, "a", { type: "standUp" });
  assert.equal(player(s, "a").chips, START_CHIPS);
  assert.equal(player(s, "a").seat, null);
  assert.equal(s.spinAt, null);
  s = place(act(s, "a", { type: "sit", seat: 0 }), "a", "red", 100);
  const spun = onDeadline(s, s.spinAt!, landOn(1));
  assert.equal(err(spun, "a", { type: "standUp" }), "Finish your spin first");
  assert.equal(err(spun, "a", { type: "sit", seat: 3 }), "Finish your spin first");
});

test("leaving mid-betting re-syncs the clock and ready check", () => {
  let s = seated(["a", "b"]);
  s = place(s, "a", "red", 10);
  s = place(s, "b", "black", 10);
  s = act(s, "a", { type: "ready" });
  const left = removeRlPlayer(s, "b", { now: 3000, rng: landOn(1) });
  assert.equal(left.phase, "spinning");
  const gone = removeRlPlayer(place(seated(["a"]), "a", "red", 10), "a", { now: 3000 });
  assert.equal(gone.spinAt, null);
});

test("rebuy only when broke and betting", () => {
  let s = seated(["a"]);
  assert.equal(err(s, "a", { type: "rebuy" }), "You still have chips");
  s = { ...s, players: s.players.map((p) => ({ ...p, chips: 2 })) };
  s = act(s, "a", { type: "rebuy" });
  assert.equal(player(s, "a").chips, START_CHIPS);
});

test("redaction does not mutate or leak other fields", () => {
  const s = seated(["a"]);
  assert.deepEqual(redactRl(s), s);
});

test("parseRlIntent is strict", () => {
  assert.deepEqual(parseRlIntent({ type: "place", spot: "n:5", amount: 25 }), { type: "place", spot: "n:5", amount: 25 });
  assert.deepEqual(parseRlIntent({ type: "sit", seat: 7 }), { type: "sit", seat: 7 });
  assert.deepEqual(parseRlIntent({ type: "undo" }), { type: "undo" });
  const bad: unknown[] = [
    null,
    "place",
    [],
    {},
    { type: "spin" },
    { type: "place", spot: "n:5", amount: 25.5 },
    { type: "place", spot: "n:5", amount: 4 },
    { type: "place", spot: "n:5", amount: 1e9 },
    { type: "place", spot: "n:5", amount: "25" },
    { type: "place", spot: "n:40", amount: 25 },
    { type: "place", spot: "n:5", amount: 25, extra: 1 },
    { type: "place", spot: "n:5" },
    { type: "sit", seat: 8 },
    { type: "sit", seat: -1 },
    { type: "sit", seat: "1" },
    { type: "sit", seat: NaN },
    { type: "clear", amount: 5 },
    { type: "__proto__" },
  ];
  for (const b of bad) assert.equal(parseRlIntent(b), null, JSON.stringify(b));
});
