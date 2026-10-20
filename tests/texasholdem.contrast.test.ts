import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../components/texasholdem/TexasHoldem.tsx", import.meta.url), "utf8");
const line = (needle: string): string => {
  const found = source.split("\n").find((l) => l.includes(needle));
  assert.ok(found, `missing ${needle}`);
  return found;
};

// Light text on the grey felt reaches 4.5:1 at about 85% opacity near the lit centre of the cloth.
const MIN_FELT_OPACITY = 80;
const opacityOf = (l: string): number => Number(/text-fg\/(\d+)/.exec(l)?.[1]);

test("side pot labels are legible on the felt", () => {
  const lines = source.split("\n");
  const label = lines[lines.findIndex((l) => l.includes("pots.map((p, i)")) - 1];
  assert.ok(label);
  assert.ok(opacityOf(label) >= MIN_FELT_OPACITY, label);
  assert.doesNotMatch(label, /text-\[10px\]/);
});

test("street label is legible on the felt", () => {
  const l = line("STREET[game.phase]");
  assert.ok(opacityOf(l) >= MIN_FELT_OPACITY, l);
  assert.doesNotMatch(l, /text-\[10px\]/);
});

test("sit buttons are at least 44px and stay visible once you are seated", () => {
  const block = source.slice(source.indexOf("Sit in seat"), source.indexOf("Sit in seat") + 700);
  assert.match(block, /size-11 /);
  assert.doesNotMatch(block, /text-fg\/35/);
  assert.match(block, /canSit \? "border-white\/20 text-fg\/75"/);
});

test("plate stack is at least 12px", () => {
  assert.doesNotMatch(source, /font-display text-\[11px\] tabular-nums", mine/);
  assert.match(source, /block truncate font-display text-xs tabular-nums/);
});
