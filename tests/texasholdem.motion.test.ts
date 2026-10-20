import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const table = read("../components/texasholdem/TexasHoldem.tsx");
const panel = read("../components/texasholdem/Panel.tsx");
const css = read("../components/texasholdem/texasholdem.css");
const motion = read("../components/casino/motion.tsx");

test("the poker table reuses the shared casino motion helpers instead of its own copies", () => {
  assert.match(table, /import \{ DealtCard, gapTo, reducedMotion \} from "@\/components\/casino\/motion";/);
  assert.doesNotMatch(table, /const reducedMotion = /);
  assert.doesNotMatch(table, /function gapTo\(/);
});

test("the poker deal is the shared DealtCard pointed at the deck", () => {
  const dealt = table.slice(table.indexOf("function Dealt("), table.indexOf("function Seat("));
  assert.match(dealt, /<DealtCard/);
  assert.match(dealt, /from="\[data-deck\]"/);
  assert.match(dealt, /to="\[data-deck\]"/);
});

test("blackjack keeps the shoe and discard tray as the default landmarks", () => {
  assert.match(motion, /from = "\[data-shoe\]"/);
  assert.match(motion, /to = "\[data-discard\]"/);
});

test("reduced motion covers the card lift, the turn clock bar and the card transitions", () => {
  const reduced = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  assert.match(reduced, /\.tx-lift \{ transition: none; \}/);
  assert.match(panel, /transition-\[width\][^"]*motion-reduce:transition-none/);
  const dealt = table.slice(table.indexOf("function Dealt("), table.indexOf("function Seat("));
  assert.match(dealt, /motion-reduce:transition-none/);
});
