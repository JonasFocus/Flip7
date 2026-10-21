import assert from "node:assert/strict";
import { test } from "node:test";
import { findBadBeat } from "../lib/texasholdem/badbeat.ts";
import type { Rank, TxCard } from "../lib/texasholdem/index.ts";

const cards = (s: string): TxCard[] => s.split(" ").map((c) => ({ rank: c.slice(0, -1) as Rank, suit: c.slice(-1) as TxCard["suit"] }));
const hands = (...holes: string[]) => holes.map((h, i) => ({ id: String.fromCharCode(97 + i), hole: cards(h) }));

test("aces cracked by a king on the river is a bad beat", () => {
  const beat = findBadBeat(hands("As Ah", "Kc Kd"), cards("2s 7d 9h Jc Ks"));
  assert.equal(beat?.loserId, "a");
  assert.deepEqual(beat?.winnerIds, ["b"]);
  assert.ok((beat?.chance ?? 0) > 94);
});

test("a set beaten by a heart on the river is a bad beat", () => {
  const beat = findBadBeat(hands("7c 7d", "Ah Kh"), cards("7h 2h 9c Js 3h"));
  assert.equal(beat?.loserId, "a");
  assert.ok((beat?.chance ?? 0) > 80);
});

test("the favorite holding on is not a bad beat", () => {
  assert.equal(findBadBeat(hands("As Ah", "Kc Kd"), cards("2s 7d 9h Jc 3s")), null);
});

test("a draw-heavy 66% favorite losing is not a bad beat", () => {
  assert.equal(findBadBeat(hands("As Ad", "9h 8h"), cards("7h 6h 2d Kc 5c")), null);
});

test("a split pot is not a bad beat", () => {
  assert.equal(findBadBeat(hands("2c 3d", "4c 5d"), cards("Ah Kh Qh Jh Th")), null);
});

test("it needs a full board and two hands", () => {
  assert.equal(findBadBeat(hands("As Ah", "Kc Kd"), cards("2s 7d 9h Jc")), null);
  assert.equal(findBadBeat(hands("As Ah"), cards("2s 7d 9h Jc Ks")), null);
});
