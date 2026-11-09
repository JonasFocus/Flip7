import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeck } from "../lib/engine/deck.ts";
import { addPlayer, bustChance, createGame, redactGame } from "../lib/engine/index.ts";
import { duplicateChance } from "../lib/engine/rules.ts";

function holding(numbers: number[]) {
  const state = addPlayer(createGame(), { id: "a", name: "A", isBot: false });
  state.phase = "playing";
  const player = state.players[0]!;
  player.status = "active";
  const deck = buildDeck();
  for (const value of numbers) {
    const index = deck.findIndex((card) => card.kind === "number" && card.value === value);
    assert.ok(index >= 0);
    player.hand.push(...deck.splice(index, 1));
  }
  state.deck = deck;
  state.deckCount = deck.length;
  return state;
}

test("next-card duplicate odds reflect number multiplicity, not just hand size", () => {
  for (const [hand, numerator, denominator] of [
    [[0], 0, 93], [[1], 0, 93], [[2], 1, 93], [[12], 11, 93],
    [[11, 12], 21, 92], [[10, 11, 12], 30, 91], [[1, 2, 3], 3, 91],
  ] as const) {
    const state = holding([...hand]);
    assert.equal(bustChance(state, "a"), numerator / denominator);
    assert.equal(bustChance(redactGame(state), "a"), numerator / denominator);
  }
});

test("visible duplicates elsewhere reduce risk and an exhausted deck uses only the discard", () => {
  const state = holding([12]);
  const discarded = state.deck.filter((card) => card.kind === "number" && card.value === 12).slice(0, 10);
  const ids = new Set(discarded.map((card) => card.id));
  state.deck = state.deck.filter((card) => !ids.has(card.id));
  state.deckCount = state.deck.length;
  state.discard = discarded;
  assert.equal(bustChance(state, "a"), 1 / 83);
  assert.equal(bustChance(redactGame(state), "a"), 1 / 83);

  state.discard.push(...state.deck);
  state.deck = [];
  state.deckCount = 0;
  assert.equal(bustChance(state, "a"), 11 / 93);
  assert.equal(bustChance(redactGame(state), "a"), 11 / 93);
});

test("Second Chance prevents an immediate bust while duplicate risk remains", () => {
  const state = holding([12]);
  const index = state.deck.findIndex((card) => card.kind === "secondChance");
  state.players[0]!.hand.push(...state.deck.splice(index, 1));
  state.deckCount = state.deck.length;
  assert.equal(bustChance(state, "a"), 0);
  assert.equal(duplicateChance(state, "a"), 11 / 92);
  assert.equal(bustChance(redactGame(state), "a"), 0);
});
