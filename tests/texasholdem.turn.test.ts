import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const panel = readFileSync(new URL("../components/texasholdem/Panel.tsx", import.meta.url), "utf8");
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
