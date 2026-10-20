import assert from "node:assert/strict";
import { test } from "node:test";
import { facing, preActionIntent, type Facing, type PreAction, type TxPlayer, type TxState } from "../lib/texasholdem/index.ts";

const free: Facing = { canCheck: true, callAmount: 0 };
const bet = (callAmount: number): Facing => ({ canCheck: false, callAmount });

test("check / fold checks when it is free and folds when it is not", () => {
  const pre: PreAction = { type: "checkFold" };
  assert.deepEqual(preActionIntent(pre, free), { type: "check" });
  assert.deepEqual(preActionIntent(pre, bet(40)), { type: "fold" });
});

test("check only fires while checking is still legal", () => {
  const pre: PreAction = { type: "check" };
  assert.deepEqual(preActionIntent(pre, free), { type: "check" });
  assert.equal(preActionIntent(pre, bet(40)), null);
});

test("call X fires only for exactly X and clears when the bet moved", () => {
  const pre: PreAction = { type: "call", amount: 20 };
  assert.deepEqual(preActionIntent(pre, bet(20)), { type: "call" });
  assert.equal(preActionIntent(pre, bet(60)), null);
  assert.equal(preActionIntent(pre, free), null);
});

test("call any calls whatever the bet became, or checks when there is none", () => {
  const pre: PreAction = { type: "callAny" };
  assert.deepEqual(preActionIntent(pre, bet(500)), { type: "call" });
  assert.deepEqual(preActionIntent(pre, free), { type: "check" });
});

test("facing caps the call at the stack and can check once the bet is matched", () => {
  const s = { currentBet: 100 } as TxState;
  const p = (bet: number, chips: number) => ({ bet, chips }) as TxPlayer;
  assert.deepEqual(facing(s, p(0, 1000)), { canCheck: false, callAmount: 100 });
  assert.deepEqual(facing(s, p(0, 30)), { canCheck: false, callAmount: 30 });
  assert.deepEqual(facing(s, p(100, 900)), { canCheck: true, callAmount: 0 });
});
