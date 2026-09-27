import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  applyIntent,
  applyScoreIntent,
  addScoreSeat,
  awaitingPlayerId,
  buildDeck,
  bustChance,
  bustInThree,
  chooseBotIntent,
  createGame,
  createScoreGame,
  redactGame,
  scoreHand,
  scorePhysical,
  setConnected,
  type Card,
  type GameState,
  type Intent,
} from "../lib/engine/index.ts";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uid = 0;
const n = (value: number): Card => ({ id: `t-n${value}-${uid++}`, kind: "number", value });
const plus = (value: 2 | 4 | 6 | 8 | 10): Card => ({ id: `t-p${value}-${uid++}`, kind: "plus", value });
const x2 = (): Card => ({ id: `t-x2-${uid++}`, kind: "x2" });
const freeze = (): Card => ({ id: `t-fr-${uid++}`, kind: "freeze" });
const flip3 = (): Card => ({ id: `t-ft-${uid++}`, kind: "flipThree" });
const sc = (): Card => ({ id: `t-sc-${uid++}`, kind: "secondChance" });

function lobby(ids: string[], bots = false): GameState {
  let s = createGame();
  for (const id of ids) s = addPlayer(s, { id, name: id, isBot: bots });
  return s;
}

// Mid-round state: each player's hand given, it is `turn`'s move; `deck` lists cards in draw order.
function rigged(hands: Record<string, Card[]>, deck: Card[], turn = 0): GameState {
  const s = structuredClone(lobby(Object.keys(hands)));
  s.phase = "playing";
  s.round = 1;
  s.dealerIndex = s.players.length - 1;
  s.turnIndex = turn;
  s.players.forEach((p) => {
    p.hand = hands[p.id] ?? [];
    p.status = "active";
  });
  s.deck = [...deck].reverse();
  s.deckCount = s.deck.length;
  return s;
}

function act(s: GameState, actor: string, intent: Intent, isHost = false): GameState {
  const r = applyIntent(s, actor, intent, { isHost, rng: seeded(1) });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const player = (s: GameState, id: string) => {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};

test("deck has 94 cards with the right composition and unique ids", () => {
  const d = buildDeck();
  assert.equal(d.length, 94);
  assert.equal(new Set(d.map((c) => c.id)).size, 94);
  const numbers = d.filter((c) => c.kind === "number");
  assert.equal(numbers.length, 79);
  for (let v = 1; v <= 12; v++) assert.equal(numbers.filter((c) => c.value === v).length, v);
  assert.equal(numbers.filter((c) => c.value === 0).length, 1);
  assert.deepEqual(
    d.filter((c) => c.kind === "plus").map((c) => c.value).sort((a, b) => a - b),
    [2, 4, 6, 8, 10],
  );
  for (const k of ["freeze", "flipThree", "secondChance"]) assert.equal(d.filter((c) => c.kind === k).length, 3);
  assert.equal(d.filter((c) => c.kind === "x2").length, 1);
});

test("scoreHand: x2 doubles numbers only, plus added, flip 7 bonus", () => {
  assert.equal(scoreHand([n(5), n(7), x2(), plus(4)]).total, 28);
  assert.equal(scoreHand([plus(2), plus(10)]).total, 12);
  const seven = [0, 1, 2, 3, 4, 5, 6].map(n);
  const h = scoreHand(seven);
  assert.equal(h.flip7Bonus, 15);
  assert.equal(h.total, 21 + 15);
  assert.equal(scoreHand(seven, { flip7: false }).total, 21);
});

test("bust scores 0 at round end", () => {
  let s = rigged({ a: [n(5), plus(10)], b: [n(3)] }, [n(5)]);
  s = act(s, "a", { type: "hit" });
  assert.equal(player(s, "a").status, "busted");
  assert.equal(s.lastEvents[1]?.type, "bust");
  s = act(s, "b", { type: "stay" });
  assert.equal(s.phase, "roundOver");
  assert.equal(player(s, "a").total, 0);
  assert.equal(player(s, "b").total, 3);
});

test("second chance absorbs a duplicate, both discarded", () => {
  const scCard = sc();
  const dup = n(5);
  let s = rigged({ a: [n(5), scCard], b: [n(3)] }, [dup]);
  s = act(s, "a", { type: "hit" });
  const a = player(s, "a");
  assert.equal(a.status, "active");
  assert.equal(a.hand.length, 1);
  assert.ok(s.discard.some((c) => c.id === scCard.id) && s.discard.some((c) => c.id === dup.id));
  assert.equal(awaitingPlayerId(s), "b");
});

test("second second chance is passed to a player without one (auto when single option)", () => {
  let s = rigged({ a: [sc()], b: [n(3)] }, [sc()]);
  s = act(s, "a", { type: "hit" });
  assert.equal(player(s, "b").hand.filter((c) => c.kind === "secondChance").length, 1);
  assert.ok(s.lastEvents.some((e) => e.type === "secondChancePassed" && e.toId === "b"));

  s = rigged({ a: [sc()], b: [n(3)], c: [n(4)] }, [sc()]);
  s = act(s, "a", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
  assert.equal(awaitingPlayerId(s), "a");
  s = act(s, "a", { type: "chooseTarget", targetId: "c" });
  assert.ok(player(s, "c").hand.some((c) => c.kind === "secondChance"));
  assert.equal(awaitingPlayerId(s), "b");

  s = rigged({ a: [sc()], b: [sc()] }, [sc()]);
  s = act(s, "a", { type: "hit" });
  assert.equal(s.discard.length, 1);
});

test("one hit is one card, then the turn passes; the last player left keeps hitting", () => {
  let s = rigged({ a: [n(1)], b: [n(2)], c: [n(3)] }, [n(4), n(5), n(6), n(7), n(8), n(9), n(10)]);
  const handSizes = () => s.players.map((p) => p.hand.length);
  for (const [who, next] of [["a", "b"], ["b", "c"], ["c", "a"]] as const) {
    assert.equal(awaitingPlayerId(s), who);
    const before = handSizes();
    s = act(s, who, { type: "hit" });
    assert.equal(s.lastEvents.filter((e) => e.type === "draw").length, 1);
    assert.deepEqual(handSizes(), before.map((len, i) => (s.players[i]?.id === who ? len + 1 : len)));
    assert.equal(awaitingPlayerId(s), next);
    assert.equal(applyIntent(s, who, { type: "hit" }, { isHost: false }).ok, false, "can't hit out of turn");
  }
  s = act(s, "a", { type: "stay" });
  s = act(s, "b", { type: "stay" });
  assert.equal(awaitingPlayerId(s), "c");
  s = act(s, "c", { type: "hit" });
  assert.equal(awaitingPlayerId(s), "c", "only one left: keeps the turn");
  s = act(s, "c", { type: "hit" });
  assert.equal(player(s, "c").hand.length, 4);
});

test("freeze banks target's points and removes them from the round", () => {
  let s = rigged({ a: [n(2)], b: [n(9), plus(4)], c: [n(1)] }, [freeze()]);
  s = act(s, "a", { type: "hit" });
  assert.deepEqual(s.pending?.type === "chooseTarget" ? s.pending.options : [], ["a", "b", "c"]);
  assert.equal(applyIntent(s, "b", { type: "chooseTarget", targetId: "b" }, { isHost: false }).ok, false);
  s = act(s, "a", { type: "chooseTarget", targetId: "b" });
  assert.equal(player(s, "b").status, "frozen");
  assert.ok(s.lastEvents.some((e) => e.type === "freeze" && e.points === 13));
  assert.equal(awaitingPlayerId(s), "c");
});

test("freeze auto-targets self when only player active", () => {
  const base = rigged({ a: [n(2)], b: [n(9)] }, [freeze()]);
  player(base, "b").status = "stayed";
  const s = act(base, "a", { type: "hit" });
  assert.equal(player(s, "a").status, "frozen");
  assert.equal(s.phase, "roundOver");
});

test("flip three: target draws three, queued freeze resolves after", () => {
  let s = rigged({ a: [n(2)], b: [n(9)], c: [n(1)] }, [flip3(), n(4), freeze(), n(6), n(7)]);
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "b" });
  assert.equal(s.pending?.type, "flipThree");
  assert.equal(awaitingPlayerId(s), "b");
  assert.equal(applyIntent(s, "b", { type: "stay" }, { isHost: false }).ok, false);
  s = act(s, "b", { type: "hit" });
  s = act(s, "b", { type: "hit" });
  assert.ok(s.pending?.type === "flipThree" && s.pending.queued.length === 1);
  s = act(s, "b", { type: "hit" });
  assert.deepEqual(
    player(s, "b").hand.map((c) => (c.kind === "number" ? c.value : c.kind)),
    [9, 4, 6],
  );
  assert.ok(s.pending?.type === "chooseTarget" && s.pending.playerId === "b" && s.pending.card.kind === "freeze");
  s = act(s, "b", { type: "chooseTarget", targetId: "c" });
  assert.equal(player(s, "c").status, "frozen");
  assert.equal(awaitingPlayerId(s), "b"); // turn passed from a to b
});

test("flip three stops early on bust and discards queued actions", () => {
  let s = rigged({ a: [n(2)], b: [n(9)] }, [flip3(), freeze(), n(9), n(3)]);
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "b" });
  s = act(s, "b", { type: "hit" });
  s = act(s, "b", { type: "hit" });
  assert.equal(player(s, "b").status, "busted");
  assert.equal(s.pending, null);
  assert.equal(awaitingPlayerId(s), "a");
  assert.equal(s.deck.length, 1);
});

test("nested flip three queued during flip three", () => {
  let s = rigged({ a: [n(2)], b: [n(9)], c: [n(1)] }, [flip3(), flip3(), n(3), n(4), n(5), n(6), n(7)]);
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "b" });
  for (let i = 0; i < 3; i++) s = act(s, "b", { type: "hit" });
  assert.ok(s.pending?.type === "chooseTarget" && s.pending.playerId === "b");
  s = act(s, "b", { type: "chooseTarget", targetId: "c" });
  assert.equal(awaitingPlayerId(s), "c");
  for (let i = 0; i < 3; i++) s = act(s, "c", { type: "hit" });
  assert.equal(player(s, "c").hand.length, 4);
  assert.equal(s.pending, null);
});

test("flip 7 ends the round immediately with bonus", () => {
  let s = rigged({ a: [1, 2, 3, 4, 5, 6].map(n), b: [n(10), x2()], c: [n(4), n(4)] }, [n(12)]);
  player(s, "c").status = "busted";
  s = act(s, "a", { type: "hit" });
  assert.equal(s.phase, "roundOver");
  assert.equal(player(s, "a").status, "flip7");
  assert.equal(player(s, "a").total, 21 + 12 + 15);
  assert.equal(player(s, "b").total, 20);
  assert.equal(player(s, "c").total, 0);
});

test("game over at 200 with shared win on tie", () => {
  let s = rigged({ a: [n(10)], b: [n(10)] }, []);
  player(s, "a").total = 195;
  player(s, "b").total = 195;
  s = act(s, "a", { type: "stay" });
  s = act(s, "b", { type: "stay" });
  assert.equal(s.phase, "gameOver");
  const over = s.lastEvents.find((e) => e.type === "gameOver");
  assert.deepEqual(over?.type === "gameOver" ? over.winnerIds : [], ["a", "b"]);
  const again = act(s, "a", { type: "playAgain" }, true);
  assert.equal(again.phase, "lobby");
  assert.equal(player(again, "a").total, 0);
});

test("reshuffles discard when deck is empty", () => {
  const s = rigged({ a: [n(2)], b: [n(9)] }, []);
  s.discard = [n(11)];
  const r = act(s, "a", { type: "hit" });
  assert.equal(r.lastEvents[0]?.type, "reshuffle");
  assert.ok(player(r, "a").hand.some((c) => c.kind === "number" && c.value === 11));
  assert.equal(r.discard.length, 0);
});

test("start requires 2+ players, host, and all humans connected; ready is not required", () => {
  const solo = lobby(["h"]);
  assert.equal(applyIntent(solo, "h", { type: "start" }, { isHost: true }).ok, false);
  const pair = lobby(["h", "g"]);
  assert.equal(applyIntent(pair, "h", { type: "start" }, { isHost: true }).ok, true, "host can start over unready guests");
  assert.equal(applyIntent(setConnected(pair, "g", false), "h", { type: "start" }, { isHost: true }).ok, false, "offline guest blocks start");
  let s = addPlayer(lobby(["h"]), { id: "bot", name: "Pip", isBot: true });
  assert.equal(applyIntent(s, "h", { type: "start" }, { isHost: false }).ok, false);
  s = act(s, "h", { type: "start" }, true);
  assert.equal(s.phase, "playing");
  assert.equal(s.round, 1);
  const cardsOut = s.players.reduce((a, p) => a + p.hand.length, 0) + s.discard.length + s.deck.length;
  assert.equal(cardsOut + (s.pending?.type === "chooseTarget" ? 1 : 0), 94);
  assert.equal(redactGame(s).deck.length, 0);
  assert.equal(redactGame(s).deckCount, s.deck.length);
});

test("bustChance matches server and redacted client view", () => {
  const s = rigged({ a: [n(12)], b: [n(3)] }, [n(12), n(1), n(2), n(4)]);
  assert.equal(bustChance(s, "a"), 0.25);
  assert.equal(bustChance(rigged({ a: [n(12), sc()], b: [] }, [n(12)]), "a"), 0);
  const real = act(act(lobby(["a", "b"]), "a", { type: "ready", ready: true }), "b", { type: "ready", ready: true });
  const started = act(real, "a", { type: "start" }, true);
  for (const p of started.players) assert.equal(bustChance(redactGame(started), p.id), bustChance(started, p.id));
});

test("bustInThree counts a Second Chance as one absorbed duplicate, not immunity", () => {
  const deck = [n(12), n(1), n(2), n(4)];
  assert.equal(bustInThree(rigged({ a: [n(12)], b: [] }, deck), "a"), 1 - 0.75 ** 3);
  const shielded = bustInThree(rigged({ a: [n(12), sc()], b: [] }, deck), "a");
  assert.ok(Math.abs(shielded - (1 - 0.75 ** 3 - 3 * 0.25 * 0.75 ** 2)) < 1e-12);
  assert.ok(shielded > 0);
});

function card(c: Card): string {
  return c.id;
}

test("200 seeded bot-only games run to completion with legal intents", () => {
  for (let g = 0; g < 200; g++) {
    const rng = seeded(g + 1);
    const count = 2 + (g % 9);
    let s = lobby(
      Array.from({ length: count }, (_, i) => `bot${i}`),
      true,
    );
    s = act(s, "bot0", { type: "start" }, true);
    let steps = 0;
    while (s.phase !== "gameOver") {
      assert.ok(++steps < 20000, `game ${g} stuck`);
      if (s.phase === "roundOver") {
        s = act(s, "bot0", { type: "nextRound" }, true);
        continue;
      }
      const who = awaitingPlayerId(s);
      assert.ok(who, `game ${g}: nobody to act`);
      const intent = chooseBotIntent(s, who, rng);
      assert.ok(intent, `game ${g}: bot returned null`);
      const r = applyIntent(s, who, intent, { isHost: who === "bot0", rng });
      assert.ok(r.ok, `game ${g}: illegal intent ${JSON.stringify(intent)} ${r.ok ? "" : r.error}`);
      s = r.state;
      const all = [
        ...s.players.flatMap((p) => p.hand),
        ...s.deck,
        ...s.discard,
        ...(s.pending?.type === "chooseTarget" ? [s.pending.card] : []),
        ...(s.pending?.type === "flipThree" ? s.pending.queued : []),
        ...s.actionQueue.map((q) => q.card),
      ].map(card);
      assert.equal(all.length, 94, `game ${g}: card count`);
      assert.equal(new Set(all).size, 94, `game ${g}: duplicate card`);
    }
    assert.ok(s.players.some((p) => p.total >= 200));
  }
});

test("physical scoring and scorekeeper flow", () => {
  assert.equal(scorePhysical({ numbers: [3, 5], x2: true, plus: [4], busted: false }), 20);
  assert.equal(scorePhysical({ numbers: [0, 1, 2, 3, 4, 5, 6], x2: false, plus: [], busted: false }), 36);
  assert.equal(scorePhysical({ numbers: [12], x2: true, plus: [10], busted: true }), 0);

  let s = createScoreGame({ goal: 30 });
  s = addScoreSeat(s, { id: "a", name: "Mom", ownerId: "a" });
  s = addScoreSeat(s, { id: "b", name: "Dad", ownerId: "b" });
  const run = (actor: string, intent: Parameters<typeof applyScoreIntent>[2], isHost = false) => {
    const r = applyScoreIntent(s, actor, intent, { isHost });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  };
  assert.equal(applyScoreIntent(s, "b", { type: "start" }, { isHost: false }).ok, false);
  run("a", { type: "start" }, true);
  const entry = { numbers: [12, 11], x2: false, plus: [], busted: false };
  const sub = (seatId: string, e: typeof entry) => ({ type: "submitEntry" as const, seatId, entry: e, round: s.round });
  assert.equal(applyScoreIntent(s, "a", sub("b", entry), { isHost: false }).ok, false);
  assert.equal(applyScoreIntent(s, "a", sub("a", { ...entry, numbers: [5, 5] }), { isHost: false }).ok, false);
  run("a", sub("a", entry));
  run("b", sub("b", { ...entry, busted: true }));
  run("a", { type: "finishRound", round: 1 }, true);
  assert.equal(s.round, 2);
  // Double-tapped finish and stale submits from round 1 are rejected.
  assert.equal(applyScoreIntent(s, "a", { type: "finishRound", round: 1 }, { isHost: true }).ok, false);
  assert.equal(applyScoreIntent(s, "a", { type: "submitEntry", seatId: "a", entry, round: 1 }, { isHost: false }).ok, false);
  s = addScoreSeat(s, { id: "c", name: "Kid", ownerId: "c" });
  assert.deepEqual(s.players[2]?.rounds, [null]);
  run("a", sub("a", { ...entry, numbers: [7] }));
  run("a", sub("b", entry), true);
  run("c", sub("c", entry));
  run("a", { type: "finishRound", round: 2 }, true);
  assert.equal(s.phase, "gameOver");
  assert.deepEqual(s.winnerIds, ["a"]);
  assert.equal(applyScoreIntent(s, "a", { type: "undoRound", round: 1 }, { isHost: true }).ok, false);
  run("a", { type: "undoRound", round: 2 }, true);
  assert.equal(s.phase, "playing");
  assert.equal(s.players[0]?.total, 23);
  // Undo keeps the round's hands so one typo can be fixed and re-finished.
  assert.deepEqual(s.entries.a?.numbers, [7]);
  assert.deepEqual(s.entries.c?.numbers, [11, 12]);
  // Double-tapped undo only removes one round.
  assert.equal(applyScoreIntent(s, "a", { type: "undoRound", round: 2 }, { isHost: true }).ok, false);
  assert.equal(s.players[0]?.rounds.length, 1);
});

test("scorekeeper: missing hands score 0 and goal can rise mid-game", () => {
  let s = createScoreGame({ goal: 100 });
  s = addScoreSeat(s, { id: "a", name: "Mom", ownerId: "a" });
  s = addScoreSeat(s, { id: "b", name: "Dad", ownerId: "b" });
  const run = (intent: Parameters<typeof applyScoreIntent>[2]) => {
    const r = applyScoreIntent(s, "a", intent, { isHost: true });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  };
  run({ type: "start" });
  run({ type: "submitEntry", seatId: "a", entry: { numbers: [12, 11, 10], x2: true, plus: [], busted: false }, round: 1 });
  run({ type: "finishRound", round: 1 });
  assert.deepEqual(s.players.map((p) => p.rounds), [[66], [0]]);
  assert.equal(applyScoreIntent(s, "a", { type: "setGoal", goal: 50 }, { isHost: true }).ok, false);
  assert.equal(applyScoreIntent(s, "a", { type: "setGoal", goal: 300 }, { isHost: false }).ok, false);
  run({ type: "setGoal", goal: 300 });
  assert.equal(s.goal, 300);
});

test("freeze target: bank yourself to win, else lock in the leader with the fewest round points", () => {
  const pickFor = (a: Card[], aTotal: number) => {
    const base = rigged({ a, b: [n(9), n(10)], c: [n(3)] }, [freeze()]);
    player(base, "a").total = aTotal;
    player(base, "b").total = 50;
    player(base, "c").total = 50;
    const s = act(base, "a", { type: "hit" });
    assert.ok(s.pending?.type === "chooseTarget" && s.pending.options.includes("a"));
    const intent = chooseBotIntent(s, "a", () => 0.5);
    return intent?.type === "chooseTarget" ? intent.targetId : null;
  };
  assert.equal(pickFor([n(5)], 0), "c"); // tied leaders: freeze the one holding 3, not 19
  assert.equal(pickFor([n(12), n(11), n(10), plus(10)], 160), "a"); // 160 + 43 wins the game
});

test("scorekeeper: consecutive undos each restore their own round's hands", () => {
  let s = createScoreGame({ goal: 500 });
  s = addScoreSeat(s, { id: "a", name: "Mom", ownerId: "a" });
  const run = (intent: Parameters<typeof applyScoreIntent>[2]) => {
    const r = applyScoreIntent(s, "a", intent, { isHost: true });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  };
  run({ type: "start" });
  for (const n of [3, 5]) {
    run({ type: "submitEntry", seatId: "a", entry: { numbers: [n], x2: false, plus: [], busted: false }, round: s.round });
    run({ type: "finishRound", round: s.round });
  }
  assert.equal(s.round, 3);
  run({ type: "undoRound", round: 2 });
  assert.deepEqual(s.entries.a?.numbers, [5]);
  run({ type: "undoRound", round: 1 });
  assert.deepEqual(s.entries.a?.numbers, [3]);
  assert.equal(s.players[0]?.total, 0);
  assert.equal(s.entryHistory.length, 0);
});

function playedRounds(): GameState {
  let s = act(lobby(["h", "g", "bot"], true), "h", { type: "start" }, true);
  const rng = seeded(7);
  while (s.round < 3 || s.phase !== "playing") {
    if (s.phase === "gameOver") throw new Error("game ended early");
    if (s.phase === "roundOver") {
      s = act(s, "h", { type: "nextRound" }, true);
      continue;
    }
    const who = awaitingPlayerId(s);
    const intent = who && chooseBotIntent(s, who, rng);
    if (!who || !intent) throw new Error("stuck");
    s = act(s, who, intent);
  }
  return s;
}

test("restart resets totals and deals round 1 from a fresh 94-card deck", () => {
  const mid = playedRounds();
  assert.ok(mid.players.some((p) => p.total > 0));
  const s = act(mid, "h", { type: "restart" }, true);
  assert.equal(s.phase, "playing");
  assert.equal(s.round, 1);
  assert.equal(s.players.length, 3);
  for (const p of s.players) {
    assert.equal(p.total, 0);
    assert.deepEqual(p.roundHistory, []);
  }
  assert.ok(s.lastEvents.some((e) => e.type === "deal"));
  const all = [
    ...s.players.flatMap((p) => p.hand),
    ...s.deck,
    ...s.discard,
    ...(s.pending?.type === "chooseTarget" ? [s.pending.card] : []),
    ...(s.pending?.type === "flipThree" ? s.pending.queued : []),
    ...s.actionQueue.map((q) => q.card),
  ].map(card);
  assert.equal(new Set(all).size, 94);
  assert.equal(all.length, 94);
});

test("endGame finishes on current totals without scoring the live round, ties shared", () => {
  const s = rigged({ a: [n(12)], b: [n(5)], c: [] }, [n(1)]);
  s.players.forEach((p, i) => (p.total = [40, 40, 10][i] ?? 0));
  const r = act(s, "a", { type: "endGame" }, true);
  assert.equal(r.phase, "gameOver");
  assert.deepEqual(r.players.map((p) => p.total), [40, 40, 10]);
  assert.deepEqual(r.lastEvents, [{ type: "gameOver", winnerIds: ["a", "b"] }]);
  assert.equal(applyIntent(r, "a", { type: "endGame" }, { isHost: true }).ok, false, "already over");
});

test("restart and endGame are host only", () => {
  const s = rigged({ a: [], b: [] }, [n(1)]);
  for (const type of ["restart", "endGame"] as const) {
    assert.equal(applyIntent(s, "b", { type }, { isHost: false }).ok, false);
    assert.equal(applyIntent(lobby(["a", "b"]), "a", { type }, { isHost: true }).ok, false, "not from lobby");
  }
});
