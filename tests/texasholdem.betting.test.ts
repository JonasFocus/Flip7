import assert from "node:assert/strict";
import { test } from "node:test";
import { BIG_BLIND, FOLD_HOLD_MS, RAISE_CHIPS, clampRaise, stackRaise } from "../lib/texasholdem/index.ts";

test("chips are 1, 5 and 10 big blinds", () => {
  assert.deepEqual(
    RAISE_CHIPS.map((bb) => bb * BIG_BLIND),
    [20, 100, 200],
  );
  assert.equal(FOLD_HOLD_MS, 3000);
});

test("clampRaise keeps the amount between the min raise and the stack", () => {
  assert.equal(clampRaise(10, 40, 1000), 40);
  assert.equal(clampRaise(500, 40, 1000), 500);
  assert.equal(clampRaise(5000, 40, 1000), 1000);
  assert.equal(clampRaise(Infinity, 40, 1000), 1000);
  assert.equal(clampRaise(-Infinity, 40, 1000), 40);
  assert.equal(clampRaise(NaN, 40, 1000), 40);
  assert.equal(clampRaise(55.6, 40, 1000), 56);
});

test("stackRaise adds big blinds onto the current amount", () => {
  let amount = 40;
  amount = stackRaise(amount, 1, 40, 1000);
  assert.equal(amount, 60);
  amount = stackRaise(amount, 5, 40, 1000);
  assert.equal(amount, 160);
  amount = stackRaise(amount, 10, 40, 1000);
  assert.equal(amount, 360);
});

test("stackRaise never exceeds the stack", () => {
  assert.equal(stackRaise(900, 10, 40, 1000), 1000);
  assert.equal(stackRaise(1000, 1, 40, 1000), 1000);
});

test("stackRaise starts from the min raise when the current amount is stale or too low", () => {
  assert.equal(stackRaise(0, 1, 40, 1000), 60);
  assert.equal(stackRaise(20, 5, 40, 1000), 140);
});

test("stackRaise stays legal when the stack is below the min raise", () => {
  // A short stack can only go all in: min and max collapse onto the same amount.
  assert.equal(stackRaise(30, 5, 30, 30), 30);
});
