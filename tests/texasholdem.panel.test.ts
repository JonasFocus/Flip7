import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const panel = readFileSync(new URL("../components/texasholdem/Panel.tsx", import.meta.url), "utf8");

// The felt is flex-1 above the panel, so a floor that omits the home-indicator inset lets the panel grow (and the felt shrink) when your move appears.
test("the action panel floor includes the bottom safe-area inset", () => {
  const footerClass = /<footer className="([^"]*)"/.exec(panel)?.[1] ?? "";
  assert.match(footerClass, /min-h-\[calc\(\d+px\+env\(safe-area-inset-bottom\)\)\]/);
});
