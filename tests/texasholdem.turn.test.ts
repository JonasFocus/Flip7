import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const panel = readFileSync(new URL("../components/texasholdem/Panel.tsx", import.meta.url), "utf8");
const table = readFileSync(new URL("../components/texasholdem/TexasHoldem.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/texasholdem/texasholdem.css", import.meta.url), "utf8");

test("your turn buzzes with the success pattern, not the 10ms tap", () => {
  const actions = panel.slice(panel.indexOf("function Actions"));
  assert.match(actions, /useEffect\(\(\) => \{\n\s+success\(\);\n\s+\}, \[\]\)/);
});

test("the low-time warning buzzes with the fail pattern once, at the threshold", () => {
  assert.match(panel, /const LOW_SECS = 5;/);
  assert.match(panel, /if \(secs === LOW_SECS\) fail\(\);/);
});

test("the turn clock is thick, readable, and pulses when low", () => {
  const clock = panel.slice(panel.indexOf("function TurnClock"), panel.indexOf("function Status"));
  assert.match(clock, /h-1\.5 overflow-hidden/);
  assert.match(clock, /text-\[15px\]/);
  assert.equal(clock.match(/tx-low/g)?.length, 2);
});

test("the low pulse stops under reduced motion", () => {
  assert.match(css, /\.tx-low \{ animation: tx-low /);
  const reduced = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  assert.match(reduced, /\.tx-low/);
});

const ring = table.slice(table.indexOf("function TurnRing"), table.indexOf("function Seat("));

test("the acting seat gets a countdown ring that shares the panel's clock and low threshold", () => {
  assert.match(ring, /secs \/ \(TURN_MS \/ 1000\)/);
  assert.match(ring, /secs <= LOW_SECS/);
  assert.match(ring, /strokeDashoffset=\{1 - left\}/);
  assert.match(table, /\{turn && secs !== null && <TurnRing secs=\{secs\} \/>\}/);
});

test("the countdown ring stops easing and pulsing under reduced motion", () => {
  assert.match(ring, /motion-reduce:transition-none/);
  assert.match(ring, /tx-low/);
});

test("run it twice: single-board odds and the bad-beat callout stand down", () => {
  // Odds keyed to the first board would misstate half the pot; a first-board loser may win the second.
  assert.match(table, /game\.runout && game\.second === null \? game\.players\.filter/);
  assert.match(table, /game\.second !== null\) return null;/);
});
