import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { oddsRunner, type Odds } from "../lib/texasholdem/equity.ts";
import type { Rank, TxCard } from "../lib/texasholdem/index.ts";

const cards = (s: string): TxCard[] => (s === "" ? [] : s.split(" ").map((c) => ({ rank: c.slice(0, -1) as Rank, suit: c.slice(-1) as TxCard["suit"] })));

function odds(holes: string[], board = ""): Odds[] {
  const runner = oddsRunner(holes.map(cards), cards(board));
  while (!runner.run(5)) continue;
  return runner.result();
}

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1, `${actual} is not within 1 point of ${expected}`);

test("aces against kings preflop is about 82 to 18", () => {
  const [aces, kings] = odds(["As Ah", "Kc Kd"]);
  near(aces!.win + aces!.tie / 2, 81.9);
  near(kings!.win + kings!.tie / 2, 18.1);
});

test("ace-king suited against queens preflop is a coin flip", () => {
  const [ak, queens] = odds(["As Ks", "Qh Qd"]);
  near(ak!.win + ak!.tie / 2, 46.3);
  near(queens!.win + queens!.tie / 2, 53.7);
});

test("a set against a flush draw on the turn loses only to the seven clean hearts", () => {
  const [set, draw] = odds(["7c 7d", "Ah Kh"], "7h 2h 9c Js");
  near(set!.win, (37 / 44) * 100);
  near(draw!.win, (7 / 44) * 100);
  assert.equal(set!.tie, 0);
});

test("flop odds are exact and heads-up wins and ties add up to everything", () => {
  const [a, b] = odds(["Ah Kd", "Qs Qc"], "2c 7d 9h");
  near(a!.win + b!.win + a!.tie, 100);
  assert.equal(a!.tie, b!.tie);
});

test("the river resolves to a winner and a loser", () => {
  const [winner, loser] = odds(["As Ah", "Ks Kh"], "2c 7d 9h Jd 3s");
  assert.deepEqual([winner, loser], [{ win: 100, tie: 0 }, { win: 0, tie: 0 }]);
});

test("the river resolves to a split when the board plays", () => {
  const [a, b] = odds(["2c 3d", "4c 5d"], "Ah Kh Qh Jh Th");
  assert.deepEqual([a, b], [{ win: 0, tie: 100 }, { win: 0, tie: 100 }]);
});

test("three hands share the sample and the same inputs always give the same figures", () => {
  const first = odds(["As Ah", "Ks Kh", "7c 7d"]);
  assert.deepEqual(first, odds(["As Ah", "Ks Kh", "7c 7d"]));
  near(first.reduce((n, o) => n + o.win + o.tie, 0), 100);
});

test("work can be done in slices", () => {
  const runner = oddsRunner([cards("As Ah"), cards("Kc Kd")], []);
  let slices = 0;
  while (!runner.run(0)) slices++;
  assert.ok(slices > 1000);
  const [aces] = runner.result();
  near(aces!.win + aces!.tie / 2, 81.9);
});

test("the table only works out odds once betting is over and every live hand is face up", () => {
  const source = readFileSync(new URL("../components/texasholdem/TexasHoldem.tsx", import.meta.url), "utf8");
  assert.match(source, /const contenders = game\.runout && game\.second === null \? game\.players\.filter/);
  assert.match(source, /holes\.length > 1 && holes\.every\(\(h\) => h\.length === 2\)/);
});
