import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  applyIntent,
  awaitingPlayerId,
  buildDeck,
  bustChance,
  chooseBotIntent,
  createGame,
  redactGame,
  removePlayer,
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

// Real deck cards so conservation checks work on rigged states.
const DECK = buildDeck();
const byId = (id: string): Card => {
  const c = DECK.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
function num(v: number, i = 0): Card {
  return byId(v === 0 ? "n0" : `n${v}-${i}`);
}

function lobby(ids: string[], bots = false): GameState {
  let s = createGame();
  for (const id of ids) s = addPlayer(s, { id, name: id, isBot: bots });
  return s;
}

// Rigged mid-round state using real card ids; unused cards go to discard so total stays 94.
function rigged(hands: Record<string, Card[]>, deckTopFirst: Card[], turn = 0): GameState {
  const s = structuredClone(lobby(Object.keys(hands)));
  s.phase = "playing";
  s.round = 1;
  s.dealerIndex = s.players.length - 1;
  s.turnIndex = turn;
  const used = new Set<string>();
  s.players.forEach((p) => {
    p.hand = hands[p.id] ?? [];
    p.hand.forEach((c) => used.add(c.id));
    p.status = "active";
  });
  deckTopFirst.forEach((c) => used.add(c.id));
  s.deck = [...deckTopFirst].reverse();
  s.discard = DECK.filter((c) => !used.has(c.id));
  s.deckCount = s.deck.length;
  return s;
}

function act(s: GameState, actor: string, intent: Intent, isHost = false): GameState {
  const r = applyIntent(s, actor, intent, { isHost, rng: seeded(7) });
  if (!r.ok) throw new Error(`${actor} ${intent.type}: ${r.error}`);
  return r.state;
}
const P = (s: GameState, id: string) => {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p;
};

function allCardIds(s: GameState): string[] {
  const ids = [...s.deck, ...s.discard, ...s.players.flatMap((p) => p.hand), ...s.actionQueue.map((q) => q.card)].map((c) => c.id);
  if (s.pending?.type === "chooseTarget") ids.push(s.pending.card.id);
  if (s.pending?.type === "flipThree") ids.push(...s.pending.queued.map((c) => c.id));
  return ids;
}
function assertConserved(s: GameState, ctx: string): void {
  if (s.phase === "lobby") return;
  const ids = allCardIds(s);
  assert.equal(ids.length, 94, `${ctx}: card count ${ids.length}`);
  assert.equal(new Set(ids).size, 94, `${ctx}: duplicate card ids`);
}

test("flip 7 reached mid flip-three ends round immediately, bonus applied, queued actions discarded", () => {
  const s0 = rigged(
    { a: [num(1), num(2), num(3), num(4), num(5)], b: [num(9)] },
    [byId("ft0"), byId("fr0"), num(6), num(7), num(8)],
  );
  let s = act(s0, "a", { type: "hit" }); // a draws Flip Three
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" }); // freeze queued
  s = act(s, "a", { type: "hit" }); // 6
  assert.equal(s.phase, "playing");
  s = act(s, "a", { type: "hit" }); // 7 -> flip 7 (7 uniques? 1..5 + 6 = 6, need one more)
  // hand: 1,2,3,4,5,6 then third card is 7 -> 7 uniques
  assert.equal(s.phase, "roundOver");
  assert.equal(P(s, "a").status, "flip7");
  assert.equal(P(s, "a").roundHistory[0], 1 + 2 + 3 + 4 + 5 + 6 + 7 + 15);
  assert.equal(P(s, "b").roundHistory[0], 9);
  assert.equal(s.pending, null);
  assert.equal(s.actionQueue.length, 0);
  assertConserved(s, "flip7 mid f3");
});

test("freeze options include self; freezing self banks own points", () => {
  const s0 = rigged({ a: [num(10)], b: [num(3)], c: [] }, [byId("fr0")]);
  let s = act(s0, "a", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
  if (s.pending?.type !== "chooseTarget") return;
  assert.deepEqual([...s.pending.options].sort(), ["a", "b", "c"]);
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  assert.equal(P(s, "a").status, "frozen");
  assert.equal(awaitingPlayerId(s), "b");
});

test("second second chance with no eligible receiver is discarded", () => {
  const s0 = rigged({ a: [byId("sc0")], b: [byId("sc1")] }, [byId("sc2")]);
  const s = act(s0, "a", { type: "hit" });
  assert.equal(s.pending, null);
  assert.equal(P(s, "a").hand.filter((c) => c.kind === "secondChance").length, 1);
  assert.ok(s.discard.some((c) => c.id === "sc2"));
  assertConserved(s, "sc discard");
});

test("second chance drawn during flip three is kept immediately and absorbs a later duplicate", () => {
  const s0 = rigged({ a: [num(5)], b: [num(1)] }, [byId("ft0"), byId("sc0"), num(5, 1), num(4)]);
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" });
  assert.ok(P(s, "a").hand.some((c) => c.kind === "secondChance"));
  s = act(s, "a", { type: "hit" });
  assert.equal(P(s, "a").status, "active");
  s = act(s, "a", { type: "hit" });
  assert.equal(s.pending, null);
  assert.deepEqual(P(s, "a").hand.map((c) => c.id).sort(), ["n4-0", "n5-0"]);
  assertConserved(s, "sc in f3");
});

test("auto-target when only one other active player for flip three is NOT auto (self is also valid)", () => {
  const s0 = rigged({ a: [], b: [] }, [byId("ft0")]);
  const s = act(s0, "a", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
});

test("dealer rotates every round and opening deal / first turn start left of dealer", () => {
  let s = lobby(["a", "b", "c"]);
  for (const id of ["a", "b", "c"]) s = act(s, id, { type: "ready", ready: true });
  s = act(s, "a", { type: "start" }, true);
  const dealers: number[] = [];
  const rng = seeded(3);
  for (let round = 0; round < 4 && s.phase !== "gameOver"; round++) {
    dealers.push(s.dealerIndex);
    const firstDeal = s.lastEvents.find((e) => e.type === "deal");
    if (firstDeal && firstDeal.type === "deal") {
      assert.equal(firstDeal.playerId, s.players[(s.dealerIndex + 1) % 3]?.id, `round ${s.round} deal order`);
    }
    let guard = 0;
    while (s.phase === "playing" && guard++ < 500) {
      const who = awaitingPlayerId(s);
      assert.ok(who, "playing phase must await someone");
      const intent = chooseBotIntent(s, who, rng);
      assert.ok(intent);
      s = act(s, who, intent);
    }
    if (s.phase === "roundOver") s = act(s, "a", { type: "nextRound" }, true);
  }
  for (let i = 1; i < dealers.length; i++) assert.equal(dealers[i], ((dealers[i - 1] ?? 0) + 1) % 3);
});

test("opening deal pauses for target choice and resumes the deal afterwards", () => {
  const s0 = rigged({ a: [], b: [], c: [] }, [byId("fr0"), num(4), num(6), num(8)]);
  s0.phase = "roundOver";
  s0.dealerIndex = 1; // next round dealer = c, deal order a, b, c
  let s = act(s0, "a", { type: "nextRound" }, true);
  assert.equal(s.dealing, true);
  assert.equal(s.pending?.type, "chooseTarget");
  assert.equal(awaitingPlayerId(s), "a");
  s = act(s, "a", { type: "chooseTarget", targetId: "b" });
  assert.equal(P(s, "b").status, "frozen");
  assert.equal(P(s, "b").hand.length, 0);
  assert.deepEqual(P(s, "c").hand.map((c) => c.id), ["n4-0"]);
  assert.equal(s.dealing, false);
  assert.equal(awaitingPlayerId(s), "a");
  assertConserved(s, "deal");
});

test("host-only intents are rejected for non-hosts", () => {
  let s = lobby(["a", "b"], false);
  s = act(s, "a", { type: "ready", ready: true });
  s = act(s, "b", { type: "ready", ready: true });
  assert.equal(applyIntent(s, "b", { type: "start" }, { isHost: false }).ok, false);
  s = act(s, "a", { type: "start" }, true);
  assert.equal(applyIntent(s, "b", { type: "nextRound" }, { isHost: false }).ok, false);
  assert.equal(applyIntent(s, "zz", { type: "hit" }, { isHost: true }).ok, false);
});

test("bust odds: exact ratio over unseen cards, identical on redacted client view", () => {
  const s = rigged({ a: [num(12), num(12, 1)].slice(0, 1), b: [num(1)] }, [num(12, 2), num(3), num(0)]);
  // deck = 12,3,0 ; a holds 12 -> 1/3
  assert.equal(bustChance(s, "a"), 1 / 3);
  assert.equal(bustChance(redactGame(s), "a"), 1 / 3);
});

test("tie at the top above goal is a shared win; below-top players excluded", () => {
  const s0 = rigged({ a: [num(10)], b: [num(10, 1)], c: [num(1)] }, []);
  s0.players.forEach((p) => (p.total = p.id === "c" ? 195 : 190));
  let s = act(s0, "a", { type: "stay" });
  s = act(s, "b", { type: "stay" });
  s = act(s, "c", { type: "stay" });
  assert.equal(s.phase, "gameOver");
  const go = s.lastEvents.find((e) => e.type === "gameOver");
  assert.ok(go && go.type === "gameOver");
  if (go?.type === "gameOver") assert.deepEqual([...go.winnerIds].sort(), ["a", "b"]);
});

test("removing the only other option from a pending choice auto-resolves instead of prompting a single option", () => {
  const s0 = rigged({ a: [byId("sc0")], b: [], c: [] }, [byId("sc1")]);
  let s = act(s0, "a", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
  s = removePlayer(s, "c", seeded(1));
  // Spec: "If only one player is active when a target is needed, auto-target (no prompt)."
  assert.equal(s.pending, null, "pending should auto-resolve to b");
  assert.ok(P(s, "b").hand.some((c) => c.kind === "secondChance"));
});

test("fuzz: random legal play + random removals never deadlock, always conserve 94 cards, bots always legal", () => {
  for (let g = 0; g < 300; g++) {
    const rng = seeded(1000 + g);
    const count = 2 + Math.floor(rng() * 9);
    const ids = Array.from({ length: count }, (_, i) => `p${i}`);
    let s = lobby(ids, true);
    s = act(s, "p0", { type: "start" }, true);
    let steps = 0;
    while (s.phase !== "gameOver" && steps++ < 5000) {
      assertConserved(s, `game ${g} step ${steps}`);
      if (s.phase === "roundOver") {
        s = act(s, s.players[0]?.id ?? "p0", { type: "nextRound" }, true);
        continue;
      }
      if (s.players.length > 2 && rng() < 0.003) {
        const victim = s.players[Math.floor(rng() * s.players.length)]?.id ?? "p0";
        s = removePlayer(s, victim, rng);
        continue;
      }
      const who = awaitingPlayerId(s);
      assert.ok(who, `game ${g} step ${steps}: deadlock in ${JSON.stringify({ dealing: s.dealing, turn: s.turnIndex, pending: s.pending })}`);
      // Mix of bot and random choices
      let intent: Intent | null;
      if (rng() < 0.5) intent = chooseBotIntent(s, who, rng);
      else if (s.pending?.type === "chooseTarget") {
        const opts = s.pending.options;
        intent = { type: "chooseTarget", targetId: opts[Math.floor(rng() * opts.length)] ?? "" };
      } else intent = s.pending || rng() < 0.7 ? { type: "hit" } : { type: "stay" };
      assert.ok(intent, "bot returned null while awaited");
      const r = applyIntent(s, who, intent, { isHost: false, rng });
      assert.ok(r.ok, `illegal intent ${JSON.stringify(intent)}: ${r.ok ? "" : r.error}`);
      if (r.ok) s = r.state;
      // bust odds sanity
      for (const p of s.players) {
        const b = bustChance(s, p.id);
        assert.ok(b >= 0 && b <= 1);
        assert.equal(bustChance(redactGame(s), p.id), b, "client/server bust odds diverge");
      }
    }
    assert.ok(steps < 5000, `game ${g} did not finish`);
  }
});

test("bot quality: Flip Three goes to a high-risk leader, not a leader with an empty (zero-risk) hand", () => {
  // bot b drew Flip Three. a leads on total but has no cards (Flip Three is a free 3-card gift);
  // c is close behind with six numbers (Flip Three is ~certain bust).
  const s0 = rigged(
    { a: [], b: [num(1)], c: [num(12), num(11), num(10), num(9), num(8), num(7)] },
    [byId("ft0")],
    1,
  );
  s0.players.forEach((p) => (p.total = p.id === "a" ? 150 : p.id === "c" ? 80 : 20));
  s0.players.forEach((p) => (p.isBot = true));
  const s = act(s0, "b", { type: "hit" });
  const intent = chooseBotIntent(s, "b", seeded(1));
  assert.deepEqual(intent, { type: "chooseTarget", targetId: "c" });
});

test("second chance with no receiver emits a discarded event", () => {
  const s0 = rigged({ a: [byId("sc0")], b: [byId("sc1")] }, [byId("sc2")]);
  const s = act(s0, "a", { type: "hit" });
  assert.deepEqual(
    s.lastEvents.map((e) => e.type),
    ["draw", "discarded"],
  );
  const d = s.lastEvents[1];
  assert.ok(d?.type === "discarded" && d.playerId === "a" && d.card.id === "sc2");
});

test("queued freeze dropped when the flip three target busts emits a discarded event", () => {
  const s0 = rigged({ a: [num(5)], b: [num(1)] }, [byId("ft0"), byId("fr0"), num(5, 1)]);
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" }); // freeze queued
  s = act(s, "a", { type: "hit" }); // duplicate 5 -> bust
  assert.equal(P(s, "a").status, "busted");
  assert.ok(s.lastEvents.some((e) => e.type === "discarded" && e.playerId === "a" && e.card.id === "fr0"));
  assertConserved(s, "queued discard");
});

test("bot quality: Freeze goes to a leader with a small hand, not one it would bank a big hand for", () => {
  // a leads slightly but has 45 on the table (freezing banks it); c is close with almost nothing.
  const s0 = rigged({ a: [num(12), num(11), num(10), num(9), num(3)], b: [num(1)], c: [num(2)] }, [byId("fr0")], 1);
  s0.players.forEach((p) => (p.total = p.id === "a" ? 130 : p.id === "c" ? 120 : 20));
  const s = act(s0, "b", { type: "hit" });
  assert.deepEqual(chooseBotIntent(s, "b", seeded(1)), { type: "chooseTarget", targetId: "c" });
});

// ---- round 2 ----

test("r2: second Second Chance drawn during Flip Three is passed (spec: kept normally), not discarded when the target later busts", () => {
  // a holds SC; Flip Three on self draws SC#2 (should go to b, who has none), then two 5s.
  const s0 = rigged({ a: [byId("sc0"), num(5)], b: [num(1)] }, [byId("ft0"), byId("sc1"), num(5, 1), num(5, 2)]);
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" }); // SC#2
  s = act(s, "a", { type: "hit" }); // dup 5, SC#1 used
  s = act(s, "a", { type: "hit" }); // dup 5 again -> bust
  assert.equal(P(s, "a").status, "busted");
  assert.ok(P(s, "b").hand.some((c) => c.id === "sc1"), "b should have received the spare Second Chance");
});

test("r2: second Second Chance drawn during Flip Three is not silently kept by the target after it used its first", () => {
  const s0 = rigged({ a: [byId("sc0"), num(5)], b: [num(1)] }, [byId("ft0"), byId("sc1"), num(5, 1), num(4)]);
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "hit" });
  assert.equal(P(s, "a").status, "active");
  // a held one when SC#2 arrived, so the rules make it go to b
  assert.ok(P(s, "b").hand.some((c) => c.id === "sc1"), "sc1 should be with b, a kept it");
});

test("r2: spare Second Chance from Flip Three is still passed by a busted target with several receivers", () => {
  const s0 = rigged({ a: [byId("sc0"), num(5)], b: [num(1)], c: [num(2)] }, [byId("ft0"), byId("sc1"), num(5, 1), num(5, 2)]);
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "hit" }); // bust
  assert.equal(P(s, "a").status, "busted");
  assert.deepEqual(s.pending, { type: "chooseTarget", playerId: "a", card: byId("sc1"), options: ["b", "c"] });
  assert.equal(awaitingPlayerId(s), "a");
  s = act(s, "a", { type: "chooseTarget", targetId: "c" });
  assert.ok(P(s, "c").hand.some((c) => c.id === "sc1"));
  assertConserved(s, "busted pass");
});

test("r2: bot as last active player hits when a rival already has the game won", () => {
  const s0 = rigged({ a: [num(12), num(11), num(7)], b: [num(3)] }, [num(1)], 1);
  P(s0, "a").status = "stayed";
  P(s0, "a").total = 190;
  P(s0, "b").total = 150;
  assert.deepEqual(chooseBotIntent(s0, "b", seeded(1)), { type: "hit" });
});

test("r2: bot does not stay into a certain loss when a banked opponent already outscores its goal-reaching total", () => {
  // a stayed: 190 + 30 = 220. bot b alone active: 180 + 25 = 205 >= goal. Staying ends the game with a winning.
  const s0 = rigged({ a: [num(12), num(11), num(7)], b: [num(12, 1), num(10), num(3)] }, [num(1)], 1);
  P(s0, "a").status = "stayed";
  P(s0, "a").total = 190;
  P(s0, "b").total = 180;
  P(s0, "b").isBot = true;
  assert.equal(awaitingPlayerId(s0), "b");
  assert.deepEqual(chooseBotIntent(s0, "b", seeded(1)), { type: "hit" });
});

test("r2: bot drawing Freeze does not freeze itself into a certain loss", () => {
  // a stayed at 220 standing; bot b (205 standing) draws Freeze with c also active.
  const s0 = rigged({ a: [num(12), num(11), num(7)], b: [num(12, 1), num(10), num(3)], c: [num(2)] }, [byId("fr0")], 1);
  P(s0, "a").status = "stayed";
  P(s0, "a").total = 190;
  P(s0, "b").total = 180;
  P(s0, "c").total = 10;
  const s = act(s0, "b", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
  assert.notDeepEqual(chooseBotIntent(s, "b", seeded(1)), { type: "chooseTarget", targetId: "b" });
});

test("r2: 10-player bot fuzz conserves 94 cards and never reshuffles cards in front of players", () => {
  let reshuffles = 0;
  for (let g = 0; g < 60; g++) {
    const rng = seeded(9000 + g);
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    let s = act(lobby(ids, true), "p0", { type: "start" }, true);
    let steps = 0;
    while (s.phase !== "gameOver" && steps++ < 8000) {
      assertConserved(s, `g${g}`);
      if (s.phase === "roundOver") {
        // hands are never in the deck
        s = act(s, "p0", { type: "nextRound" }, true);
        continue;
      }
      const who = awaitingPlayerId(s);
      assert.ok(who);
      const intent = chooseBotIntent(s, who, rng);
      assert.ok(intent);
      const r = applyIntent(s, who, intent, { isHost: false, rng });
      assert.ok(r.ok);
      if (!r.ok) break;
      if (r.events.some((e) => e.type === "reshuffle")) {
        reshuffles++;
        const inFront = new Set(r.state.players.flatMap((p) => p.hand.map((c) => c.id)));
        assert.ok(r.state.deck.every((c) => !inFront.has(c.id)), "reshuffled a card that is in front of a player");
      }
      s = r.state;
    }
  }
  assert.ok(reshuffles > 0, "fuzz never exercised a reshuffle");
});

// ---- round 3 ----

test("r3: doomed bot hits instead of staying into a certain loss even while another player is still active", () => {
  // a banked 190 + 30 = 220 (game ends this round). bot b: 180 + 25 = 205 < 220, c still active.
  // Staying locks in b's loss; hitting is strictly dominant. Deck is rigged so b's bust odds are high.
  const s0 = rigged(
    { a: [num(12), num(11), num(7)], b: [num(12, 1), num(10), num(3)], c: [num(2)] },
    [num(12, 2), num(10, 1), num(3, 1), num(12, 3), num(1)],
    1,
  );
  P(s0, "a").status = "stayed";
  P(s0, "a").total = 190;
  P(s0, "b").total = 180;
  P(s0, "b").isBot = true;
  assert.equal(awaitingPlayerId(s0), "b");
  for (let seed = 1; seed < 20; seed++) assert.deepEqual(chooseBotIntent(s0, "b", seeded(seed)), { type: "hit" }, `seed ${seed}`);
});

test("r3: bot Flip Three with every rival at zero round points does not gift the total leader three free cards", () => {
  // First card of the opening deal is Flip Three for bot a. Nobody has a card, so no rival can bust;
  // the bot hands the game leader ~3 free cards instead of taking them itself (or giving them to the weakest).
  const s0 = rigged({ a: [], b: [], c: [] }, [byId("ft0"), num(4), num(6), num(8), num(9), num(10)]);
  s0.phase = "roundOver";
  s0.players.forEach((p) => (p.isBot = true));
  P(s0, "b").total = 150;
  P(s0, "c").total = 40;
  P(s0, "a").total = 60;
  s0.dealerIndex = 1; // next dealer c, deal order a, b, c
  const s = act(s0, "a", { type: "nextRound" }, true);
  assert.equal(s.pending?.type, "chooseTarget");
  const intent = chooseBotIntent(s, "a", seeded(1));
  assert.notDeepEqual(intent, { type: "chooseTarget", targetId: "b" });
  assert.deepEqual(intent, { type: "chooseTarget", targetId: "a" }, "three near-free cards are worth taking yourself");
});

test("r3: opening-deal Flip Three on a not-yet-dealt player still deals them their opening card", () => {
  const s0 = rigged({ a: [], b: [], c: [] }, [byId("ft0"), num(4), num(6), num(8), num(9), num(10)]);
  s0.phase = "roundOver";
  s0.dealerIndex = 1;
  let s = act(s0, "a", { type: "nextRound" }, true);
  s = act(s, "a", { type: "chooseTarget", targetId: "c" });
  for (let i = 0; i < 3; i++) s = act(s, "c", { type: "hit" });
  assert.equal(P(s, "c").hand.length, 4);
  assert.equal(P(s, "b").hand.length, 1);
  assert.equal(s.dealing, false);
  assert.equal(awaitingPlayerId(s), "a");
  assertConserved(s, "deal f3");
});

test("r3: modifiers-only hand scores its modifiers; x2 never doubles plus cards", () => {
  const s0 = rigged({ a: [byId("p10"), byId("x2")], b: [num(5), byId("p4")] }, []);
  let s = act(s0, "a", { type: "stay" });
  s = act(s, "b", { type: "stay" });
  assert.equal(P(s, "a").roundHistory[0], 10);
  assert.equal(P(s, "b").roundHistory[0], 9);
});

test("r3: queued Freeze after Flip Three on the last active player auto-targets self", () => {
  const s0 = rigged({ a: [num(1)], b: [num(2)] }, [byId("ft0"), byId("fr0"), num(3), num(4)]);
  P(s0, "b").status = "stayed";
  let s = act(s0, "a", { type: "hit" }); // ft auto-targets a (only active)
  assert.equal(s.pending?.type, "flipThree");
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "hit" });
  s = act(s, "a", { type: "hit" });
  assert.equal(P(s, "a").status, "frozen");
  assert.equal(s.phase, "roundOver");
  assertConserved(s, "auto self freeze");
});

// ---- round 4 ----

function assertInvariants(s: GameState, ctx: string): void {
  assertConserved(s, ctx);
  const done = s.phase === "playing" ? s.round - 1 : s.phase === "lobby" ? 0 : s.round;
  for (const p of s.players) {
    assert.ok(p.hand.filter((c) => c.kind === "secondChance").length <= 1, `${ctx}: ${p.id} holds 2 second chances`);
    const nums = p.hand.flatMap((c) => (c.kind === "number" ? [c.value] : []));
    if (p.status !== "busted") assert.equal(new Set(nums).size, nums.length, `${ctx}: ${p.id} kept a duplicate`);
    if (p.status === "flip7") assert.equal(new Set(nums).size, 7, `${ctx}: flip7 without 7 uniques`);
    assert.equal(p.total, p.roundHistory.reduce((a, b) => a + b, 0), `${ctx}: total drift`);
    if (s.phase !== "lobby") assert.equal(p.roundHistory.length, done, `${ctx}: ${p.id} roundHistory length`);
  }
  if (s.phase === "playing" && !s.pending && !s.dealing) {
    const who = awaitingPlayerId(s);
    assert.ok(who && P(s, who).status === "active", `${ctx}: awaited player not active`);
  }
  if (s.pending?.type === "chooseTarget") {
    assert.ok(s.pending.options.length >= 2, `${ctx}: prompt with a single option should auto-target`);
    for (const o of s.pending.options) assert.equal(P(s, o).status, "active", `${ctx}: inactive option`);
  }
}

test("r4: invariant fuzz (single second chance, no kept duplicates, totals = history, options >= 2 and active)", () => {
  for (let g = 0; g < 200; g++) {
    const rng = seeded(40000 + g);
    const ids = Array.from({ length: 2 + (g % 9) }, (_, i) => `p${i}`);
    let s = act(lobby(ids, true), "p0", { type: "start" }, true);
    let steps = 0;
    while (s.phase !== "gameOver" && steps++ < 8000) {
      assertInvariants(s, `g${g} s${steps}`);
      if (s.phase === "roundOver") {
        s = act(s, s.players[0]?.id ?? "p0", { type: "nextRound" }, true);
        continue;
      }
      if (s.players.length > 2 && rng() < 0.002) {
        s = removePlayer(s, s.players[Math.floor(rng() * s.players.length)]?.id ?? "p0", rng);
        continue;
      }
      const who = awaitingPlayerId(s);
      assert.ok(who);
      const intent = rng() < 0.6 ? chooseBotIntent(s, who, rng) : s.pending?.type === "chooseTarget"
        ? { type: "chooseTarget" as const, targetId: s.pending.options[Math.floor(rng() * s.pending.options.length)] ?? "" }
        : s.pending || rng() < 0.75 ? { type: "hit" as const } : { type: "stay" as const };
      assert.ok(intent);
      const r = applyIntent(s, who, intent, { isHost: false, rng });
      assert.ok(r.ok, r.ok ? "" : r.error);
      if (!r.ok) break;
      const over = r.events.find((e) => e.type === "gameOver");
      if (over && over.type === "gameOver") {
        const top = Math.max(...r.state.players.map((p) => p.total));
        assert.deepEqual([...over.winnerIds].sort(), r.state.players.filter((p) => p.total === top).map((p) => p.id).sort());
      }
      s = r.state;
    }
    assertInvariants(s, `g${g} end`);
  }
});

test("r4: bot tied with a banked rival above the goal stays for the shared win instead of gambling it away", () => {
  // a banked 190 + 30 = 220. bot b last active: 190 + 30 = 220 -> staying is a guaranteed shared win (spec: ties = shared win).
  const s0 = rigged(
    { a: [num(12), num(11), num(7)], b: [num(12, 1), num(11, 1), num(7, 1)] },
    [num(12, 2), num(11, 2), num(7, 2), num(12, 3), num(1)],
    1,
  );
  P(s0, "a").status = "stayed";
  P(s0, "a").total = 190;
  P(s0, "b").total = 190;
  P(s0, "b").isBot = true;
  assert.ok(bustChance(s0, "b") > 0.5);
  for (let seed = 1; seed < 10; seed++) assert.deepEqual(chooseBotIntent(s0, "b", seeded(seed)), { type: "stay" }, `seed ${seed}`);
});

test("r4: Flip Three target holding Second Chance: dup uses it, a later Second Chance in the same Flip Three is kept", () => {
  const s0 = rigged({ a: [num(5), byId("sc0")], b: [num(2)] }, [byId("ft0"), num(5, 1), byId("sc1"), num(9)]);
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  for (let i = 0; i < 3; i++) s = act(s, "a", { type: "hit" });
  assert.equal(P(s, "a").status, "active");
  assert.ok(P(s, "a").hand.some((c) => c.id === "sc1"));
  assert.ok(!P(s, "a").hand.some((c) => c.id === "sc0"));
  assertInvariants(s, "sc in f3");
});

test("r4: Flip 7 during Flip Three ends the round before the queued actions and remaining draws", () => {
  const s0 = rigged(
    { a: [num(1), num(2), num(3), num(4), num(5)], b: [num(8)] },
    [byId("ft0"), byId("fr0"), num(6), num(7), num(9)],
  );
  let s = act(s0, "a", { type: "hit" });
  s = act(s, "a", { type: "chooseTarget", targetId: "a" });
  s = act(s, "a", { type: "hit" }); // freeze queued
  s = act(s, "a", { type: "hit" }); // 6
  const r = applyIntent(s, "a", { type: "hit" }, { isHost: false, rng: seeded(1) }); // 7 -> flip 7
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.state.phase, "roundOver");
  assert.equal(P(r.state, "a").roundHistory[0], 28 + 15);
  assert.equal(P(r.state, "b").roundHistory[0], 8);
  assert.ok(!r.events.some((e) => e.type === "freeze"));
  assertInvariants(r.state, "f7 in f3");
});

test("r4: bot drawing Freeze while tied for a banked win freezes itself to lock the shared win", () => {
  // a banked 220. bot b stands at 220 with high bust odds; c active far behind. Self-freeze = guaranteed shared win.
  const s0 = rigged(
    { a: [num(12), num(11), num(7)], b: [num(12, 1), num(11, 1), num(7, 1)], c: [num(2)] },
    [byId("fr0"), num(12, 2), num(11, 2), num(7, 2), num(12, 3)],
    1,
  );
  P(s0, "a").status = "stayed";
  P(s0, "a").total = 190;
  P(s0, "b").total = 190;
  P(s0, "c").total = 10;
  const s = act(s0, "b", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
  assert.deepEqual(chooseBotIntent(s, "b", seeded(1)), { type: "chooseTarget", targetId: "b" });
});

test("r4: bot never freezes the only rival when that banks the rival's game-winning total", () => {
  // bot a (50 + 5) draws Freeze; b stands at 195 + 10 = 205. Freezing b ends the game with b winning;
  // freezing itself leaves b a chance to bust. pickTarget's value() marks b -Infinity but still returns it.
  const s0 = rigged({ a: [num(5)], b: [num(10)] }, [byId("fr0"), num(1)]);
  P(s0, "a").total = 50;
  P(s0, "b").total = 195;
  const s = act(s0, "a", { type: "hit" });
  assert.equal(s.pending?.type, "chooseTarget");
  assert.deepEqual(chooseBotIntent(s, "a", seeded(1)), { type: "chooseTarget", targetId: "a" });
});
