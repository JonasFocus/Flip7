// Reproduce the dealing audit: node scripts/analyze-flip.ts [games per policy=500] [shuffle samples=100000]
// Uses seeded randomness for repeatable experiments, not production player history.
import assert from "node:assert/strict";
import { buildDeck, shuffle } from "../lib/engine/deck.ts";
import * as ordinary from "../lib/engine/index.ts";
import * as online from "../server/flip7.ts";
import type { Card, GameState, Intent } from "../lib/engine/types.ts";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const games = Number(process.argv[2] ?? 500);
const samples = Number(process.argv[3] ?? 100_000);
assert.ok(Number.isSafeInteger(games) && games > 0, "Game count must be a positive integer");
assert.ok(Number.isSafeInteger(samples) && samples > 0, "Sample count must be a positive integer");
const deck = buildDeck();
assert.equal(deck.length, 94);
assert.equal(new Set(deck.map((c) => c.id)).size, 94);
const counts = Array.from({ length: 13 }, (_, value) => deck.filter((c) => c.kind === "number" && c.value === value).length);
assert.deepEqual(counts, [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// Sample complete shuffles; measure the first two physical cards before actions resolve.
const rng = seeded(0xf117);
const first = Array<number>(13).fill(0);
let duplicatePairs = 0;
for (let i = 0; i < samples; i++) {
  const shuffled = shuffle(deck, rng);
  const a = shuffled.at(-1)!;
  const b = shuffled.at(-2)!;
  if (a.kind === "number") {
    first[a.value]!++;
    if (b.kind === "number" && a.value === b.value) duplicatePairs++;
  }
}

function freshHand(values: number[]) {
  const used = new Set<string>();
  const hand = values.map((value) => {
    const card = deck.find((c) => c.kind === "number" && c.value === value && !used.has(c.id));
    assert.ok(card);
    used.add(card.id);
    return card;
  });
  const remaining = deck.filter((c) => !used.has(c.id));
  const matches = remaining.filter((c) => c.kind === "number" && values.includes(c.value)).length;
  const state = ordinary.addPlayer(ordinary.createGame(), { id: "a", name: "A", isBot: false });
  state.phase = "playing";
  state.players[0]!.status = "active";
  state.players[0]!.hand = hand;
  state.deck = remaining;
  state.deckCount = remaining.length;
  const risk = matches / remaining.length;
  assert.equal(ordinary.bustChance(state, "a"), risk);
  assert.equal(ordinary.bustChance(ordinary.redactGame(state), "a"), risk);
  return { hand: values, matchingCards: matches, cardsLeft: remaining.length, risk };
}

// Exact birthday-style collision calculation for NUMBER cards only. No action cards,
// shields, other players or stopping decisions: deliberately separate from full-game rates.
const elementary = Array<number>(8).fill(0);
elementary[0] = 1;
for (const count of counts) for (let k = 7; k >= 1; k--) elementary[k]! += count * elementary[k - 1]!;
let factorial = 1;
let falling = 1;
const numberOnly = [];
for (let k = 1; k <= 7; k++) {
  factorial *= k;
  falling *= 80 - k;
  numberOnly.push({ numberCardsDrawn: k, repeatByNow: 1 - factorial * elementary[k]! / falling });
}

// Both seats use the same policy. Special actions use the ordinary engine's existing
// target heuristic in both modes; forced Flip Three draws are always completed.
// Fixed-number policies intentionally don't change with the score or approaching 200.
function play(seed: number, adaptive: boolean, stopAt: number) {
  const engine = adaptive ? online : ordinary;
  const drawRng = seeded(seed);
  const decisionRng = seeded(seed ^ 0xb075);
  let state = engine.createGame();
  for (let seat = 0; seat < 2; seat++) state = engine.addPlayer(state, { id: String(seat), name: `Seat ${seat}`, isBot: false });
  let rounds = 0, busts = 0, score = 0, forcedBusts = 0, rescues = 0, reshuffles = 0;
  const seatBusts = [0, 0];
  const streaks = [0, 0];
  const longest = [0, 0];
  const inventory = (s: GameState): Card[] => [
    ...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand), ...s.actionQueue.map((q) => q.card),
    ...(s.pending?.type === "chooseTarget" ? [s.pending.card] : s.pending?.type === "flipThree" ? s.pending.queued : []),
  ];
  function act(actor: string, intent: Intent) {
    const forced = state.pending?.type === "flipThree";
    const startsRound = intent.type === "start" || intent.type === "nextRound";
    const alreadyAssisted = new Set(startsRound ? [] : state.players.filter((p) => state.balance?.[p.id]?.assistedThisRound).map((p) => p.id));
    const result = engine.applyIntent(state, actor, intent, { isHost: actor === "0", rng: drawRng });
    assert.ok(result.ok, result.ok ? "" : result.error);
    state = result.state;
    rescues += state.players.filter((p) => state.balance?.[p.id]?.assistedThisRound && !alreadyAssisted.has(p.id)).length;
    reshuffles += result.events.filter((e) => e.type === "reshuffle").length;
    if (forced) forcedBusts += result.events.filter((e) => e.type === "bust").length;
    if (result.events.some((e) => e.type === "roundEnd")) {
      rounds++;
      for (const [i, p] of state.players.entries()) {
        const busted = p.status === "busted";
        if (busted) { busts++; seatBusts[i]!++; }
        score += p.roundHistory.at(-1)!;
        streaks[i] = busted ? streaks[i]! + 1 : 0;
        longest[i] = Math.max(longest[i]!, streaks[i]!);
      }
      const cards = inventory(state);
      assert.equal(cards.length, 94);
      assert.equal(new Set(cards.map((c) => c.id)).size, 94);
    }
  }
  act("0", { type: "start" });
  let actions = 0;
  while (state.phase !== "gameOver" && actions++ < 10_000) {
    if (state.phase === "roundOver") { act("0", { type: "nextRound" }); continue; }
    const actor = ordinary.awaitingPlayerId(state);
    assert.ok(actor, "Missing actor");
    let intent: Intent | null;
    if (state.pending) intent = ordinary.chooseBotIntent(state, actor, decisionRng);
    else {
      const me = state.players.find((p) => p.id === actor)!;
      intent = { type: ordinary.uniqueNumbers(me.hand) >= stopAt ? "stay" : "hit" };
    }
    assert.ok(intent, "Missing intent");
    act(actor, intent);
  }
  assert.equal(state.phase, "gameOver", "Game did not finish");
  return { rounds, busts, score, forcedBusts, rescues, reshuffles, seatBusts, tripleStreakPlayers: longest.filter((n) => n >= 3).length };
}

const strategies = [];
for (const stopAt of [3, 4, 5, 7]) for (const adaptive of [false, true]) {
  let rounds = 0, busts = 0, score = 0, forcedBusts = 0, rescues = 0, reshuffles = 0, tripleStreakPlayers = 0;
  const seatBusts = [0, 0];
  for (let seed = 1; seed <= games; seed++) {
    const result = play(seed, adaptive, stopAt);
    rounds += result.rounds; busts += result.busts; score += result.score;
    forcedBusts += result.forcedBusts; rescues += result.rescues; reshuffles += result.reshuffles;
    tripleStreakPlayers += result.tripleStreakPlayers;
    result.seatBusts.forEach((n, i) => { seatBusts[i]! += n; });
  }
  strategies.push({
    stopAt, adaptive, games, playerRounds: rounds * 2, busts,
    bustRate: busts / (rounds * 2), pointsPerPlayerRound: score / (rounds * 2),
    forcedBusts, rescues, reshuffles,
    tripleStreakPlayerRate: tripleStreakPlayers / (games * 2),
    seatBustRates: seatBusts.map((n) => n / rounds),
  });
}

console.log(JSON.stringify({
  method: "Seeded synthetic games; same stop-at-N policy in both seats; real special cards and shared-deck carryover; no production player data",
  counts,
  shuffledPairs: { samples, expected: counts.reduce((n, c) => n + c * (c - 1), 0) / (94 * 93), observed: duplicatePairs / samples },
  firstCard: counts.map((count, value) => ({ value, count, expected: count / 94, observed: first[value]! / samples })),
  freshHandExamples: [[1], [2], [6], [12], [11, 12], [10, 11, 12], [9, 10, 11, 12], [1, 2, 3]].map(freshHand),
  numberOnly,
  strategies,
}, null, 2));
