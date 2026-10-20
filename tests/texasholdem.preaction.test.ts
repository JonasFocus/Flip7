import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolvePreAction, samePreAction, type TxActions } from "../lib/texasholdem/index.ts";

const open: TxActions = { canCheck: true, callAmount: 0, canRaise: true, minRaiseTo: 20, maxRaiseTo: 1000 };
const facing = (callAmount: number): TxActions => ({ canCheck: false, callAmount, canRaise: true, minRaiseTo: 60, maxRaiseTo: 1000 });

test("nothing fires without a pre-action or off your turn", () => {
  assert.deepEqual(resolvePreAction(null, open), { intent: null, clear: false });
  assert.deepEqual(resolvePreAction({ kind: "check" }, null), { intent: null, clear: false });
});

test("check/fold checks when free and folds when facing a bet", () => {
  assert.deepEqual(resolvePreAction({ kind: "checkFold" }, open), { intent: { type: "check" }, clear: true });
  assert.deepEqual(resolvePreAction({ kind: "checkFold" }, facing(40)), { intent: { type: "fold" }, clear: true });
});

test("check fires only while checking is legal, otherwise it just clears", () => {
  assert.deepEqual(resolvePreAction({ kind: "check" }, open), { intent: { type: "check" }, clear: true });
  assert.deepEqual(resolvePreAction({ kind: "check" }, facing(40)), { intent: null, clear: true });
});

test("call fires only for the exact amount picked", () => {
  assert.deepEqual(resolvePreAction({ kind: "call", amount: 40 }, facing(40)), { intent: { type: "call" }, clear: true });
  assert.deepEqual(resolvePreAction({ kind: "call", amount: 40 }, facing(100)), { intent: null, clear: true });
  assert.deepEqual(resolvePreAction({ kind: "call", amount: 40 }, open), { intent: null, clear: true });
});

test("samePreAction matches kind and call amount", () => {
  assert.equal(samePreAction(null, { kind: "check" }), false);
  assert.equal(samePreAction({ kind: "check" }, { kind: "check" }), true);
  assert.equal(samePreAction({ kind: "call", amount: 40 }, { kind: "call", amount: 40 }), true);
  assert.equal(samePreAction({ kind: "call", amount: 40 }, { kind: "call", amount: 60 }), false);
});

test("the panel wires pre-actions and resets them each street", () => {
  const panel = readFileSync(new URL("../components/texasholdem/Panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /resolvePreAction/);
  assert.match(panel, /game\.round/);
  assert.match(panel, /aria-pressed/);
  assert.match(panel, /min-h-11/);
});
