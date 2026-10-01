import assert from "node:assert/strict";
import { test } from "node:test";
import { spotAt, spotCenter } from "../components/roulette/layout.ts";
import { spotNumbers } from "../lib/roulette/rules.ts";

// 300 x 520 block: 100 x 40 cells.
const W = 300;
const H = 520;
const at = (col: number, row: number, fx: number, fy: number) => spotAt(col * 100 + fx, row * 40 + fy, W, H);

test("tap targets resolve to the right inside spot", () => {
  assert.equal(at(0, 0, 50, 20), "n:0");
  assert.equal(at(1, 0, 50, 38), "s:0-2");
  assert.equal(at(1, 1, 50, 20), "n:2"); // row 1 is 1 2 3
  assert.equal(at(1, 1, 50, 2), "s:0-2");
  assert.equal(at(1, 1, 98, 20), "s:2-3");
  assert.equal(at(1, 1, 2, 20), "s:1-2");
  assert.equal(at(1, 1, 50, 38), "s:2-5");
  assert.equal(at(1, 1, 98, 38), "c:2");
  assert.equal(at(0, 2, 2, 20), "t:4");
  assert.equal(at(0, 2, 2, 38), "l:4");
  assert.equal(at(2, 12, 50, 38), "n:36");
  assert.equal(at(2, 12, 98, 20), "n:36");
});

test("every tap lands on a real spot that covers the cell under the finger", () => {
  for (let x = 0; x < W; x += 3) {
    for (let y = 0; y < H; y += 3) {
      const nums = spotNumbers(spotAt(x, y, W, H));
      assert.ok(nums, `no spot at ${x},${y}`);
    }
  }
});

test("chips sit on the border they cover", () => {
  assert.deepEqual(spotCenter("n:1"), { x: 0.5, y: 1.5 });
  assert.deepEqual(spotCenter("s:1-2"), { x: 1, y: 1.5 });
  assert.deepEqual(spotCenter("c:1"), { x: 1, y: 2 });
  assert.deepEqual(spotCenter("t:4"), { x: 0, y: 2.5 });
  assert.deepEqual(spotCenter("l:1"), { x: 0, y: 2 });
  assert.deepEqual(spotCenter("s:0-3"), { x: 2.5, y: 1 });
  assert.equal(spotCenter("red"), null);
});
