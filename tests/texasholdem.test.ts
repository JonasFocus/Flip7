import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BIG_BLIND,
  FOLD_WIN_MS,
  RUNOUT_MS,
  SHOWDOWN_MS,
  SMALL_BLIND,
  START_CHIPS,
  START_MS,
  TURN_MS,
  addTxPlayer,
  applyTxIntent,
  createTxGame,
  legalActions,
  newDeck,
  onDeadline,
  redactTx,
  removeTxPlayer,
  serverDeadline,
  setTxConnected,
  type Rank,
  type TxCard,
  type TxIntent,
  type TxState,
} from "../lib/texasholdem/index.ts";
import { parseTxIntent } from "../lib/texasholdem/validate.ts";

const cd = (s: string): TxCard => ({ rank: s.slice(0, -1) as Rank, suit: s.slice(-1) as TxCard["suit"] });
const NOW = 100_000;

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function act(s: TxState, actor: string, intent: TxIntent, now = NOW): TxState {
  const r = applyTxIntent(s, actor, intent, { isHost: false, now });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function err(s: TxState, actor: string, intent: TxIntent): string {
  const r = applyTxIntent(s, actor, intent, { isHost: false, now: NOW });
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error;
}

const player = (s: TxState, id: string) => s.players.find((p) => p.id === id)!;

// Seats ids in seats 0.. and deals the first hand; `hole` and `board` rig the cards, `chips` the stacks.
function table(ids: string[], opts: { hole?: Record<string, string[]>; board?: string[]; chips?: Record<string, number> } = {}): TxState {
  let s = createTxGame();
  ids.forEach((id, seat) => {
    s = addTxPlayer(s, { id, name: id.toUpperCase() });
    s = act(s, id, { type: "sit", seat }, 1000);
  });
  s = { ...s, players: s.players.map((p) => ({ ...p, chips: opts.chips?.[p.id] ?? p.chips })) };
  const started = onDeadline(s, 1000 + START_MS, newRng());
  assert.equal(started.phase, "preflop");
  return {
    ...started,
    players: started.players.map((p) => (opts.hole?.[p.id] ? { ...p, cards: opts.hole[p.id]!.map(cd) } : p)),
    deck: opts.board ? [...opts.board.map(cd), ...newDeck(() => 0.5)] : started.deck,
  };
}
const newRng = () => mulberry(7);

const chipsAndPot = (s: TxState) => s.players.reduce((n, p) => n + p.chips, 0) + (s.phase === "showdown" ? 0 : s.pot);

test("lobby waits for two funded players, then deals after the start beat", () => {
  let s = addTxPlayer(createTxGame(), { id: "a", name: "A" });
  s = act(s, "a", { type: "sit", seat: 0 }, 1000);
  assert.equal(serverDeadline(s), null);
  s = addTxPlayer(s, { id: "b", name: "B" });
  s = act(s, "b", { type: "sit", seat: 3 }, 1000);
  assert.equal(serverDeadline(s), 1000 + START_MS);
  assert.equal(onDeadline(s, 1000 + START_MS - 1), s);
  const dealt = onDeadline(s, 1000 + START_MS, newRng());
  assert.equal(dealt.phase, "preflop");
  assert.equal(dealt.round, 1);
  assert.ok(dealt.players.every((p) => p.cards.length === 2));
  assert.equal(dealt.deck.length, 52 - 4);
});

test("heads-up: the button posts the small blind and acts first preflop, then last", () => {
  const s = table(["a", "b"]);
  assert.equal(s.button, 0);
  assert.equal(s.sbId, "a");
  assert.equal(s.bbId, "b");
  assert.equal(player(s, "a").bet, SMALL_BLIND);
  assert.equal(player(s, "b").bet, BIG_BLIND);
  assert.equal(s.pot, 30);
  assert.equal(s.turnId, "a");
  let n = act(s, "a", { type: "call" });
  assert.equal(n.turnId, "b"); // big blind keeps the option
  n = act(n, "b", { type: "check" });
  assert.equal(n.phase, "flop");
  assert.equal(n.board.length, 3);
  assert.equal(n.turnId, "b"); // out of position postflop
});

test("three-handed: small blind left of the button, action starts after the big blind", () => {
  const s = table(["a", "b", "c"]);
  assert.deepEqual([s.sbId, s.bbId, s.turnId], ["b", "c", "a"]);
  const n = act(act(act(s, "a", { type: "call" }), "b", { type: "call" }), "c", { type: "check" });
  assert.equal(n.phase, "flop");
  assert.equal(n.turnId, "b"); // first live seat after the button
});

test("the button moves one seat each hand and skips players who sit out", () => {
  let s = table(["a", "b", "c"]);
  s = act(act(s, "a", { type: "fold" }), "b", { type: "fold" });
  assert.equal(s.phase, "showdown");
  s = onDeadline(s, s.settleAt!, newRng());
  s = act(s, "b", { type: "sitOut" }, s.startAt ?? NOW);
  s = onDeadline(s, s.startAt!, newRng());
  assert.equal(s.button, 2); // seat 1 sits out, so the button jumps to c
  assert.equal(player(s, "b").cards.length, 0);
  assert.equal(s.sbId, "c"); // heads-up: the button is the small blind
  assert.equal(s.bbId, "a");
});

test("everyone folds: the last player wins the pot unseen", () => {
  let s = table(["a", "b"], { hole: { a: ["As", "Ah"], b: ["Kc", "Kd"] } });
  s = act(s, "a", { type: "fold" });
  assert.equal(s.phase, "showdown");
  assert.equal(s.settleAt! - NOW, FOLD_WIN_MS);
  assert.equal(player(s, "b").chips, START_CHIPS + SMALL_BLIND);
  assert.equal(player(s, "a").chips, START_CHIPS - SMALL_BLIND);
  assert.equal(player(s, "b").result?.hand, null);
  const view = redactTx(s, "a");
  assert.ok(player(view, "b").cards.every((c) => c === null));
  assert.ok(player(view, "a").cards.every((c) => c !== null));
  const shown = redactTx(act(s, "b", { type: "show" }), "a");
  assert.ok(player(shown, "b").cards.every((c) => c !== null));
  assert.equal(err(s, "a", { type: "show" }), "Nothing to show");
});

test("full hand to showdown pays the best hand and resets the table", () => {
  let s = table(["a", "b"], { hole: { a: ["As", "Ah"], b: ["Kc", "Kd"] }, board: ["2c", "7d", "9h", "Jc", "3s"] });
  s = act(act(s, "a", { type: "call" }), "b", { type: "check" });
  for (const street of ["flop", "turn", "river"]) {
    assert.equal(s.phase, street);
    assert.equal(s.turnId, "b");
    s = act(act(s, "b", { type: "check" }), "a", { type: "check" });
  }
  assert.equal(s.phase, "showdown");
  assert.equal(s.settleAt! - NOW, SHOWDOWN_MS);
  assert.equal(player(s, "a").chips, START_CHIPS + BIG_BLIND);
  assert.equal(player(s, "b").chips, START_CHIPS - BIG_BLIND);
  assert.deepEqual([player(s, "a").result?.net, player(s, "b").result?.net], [20, -20]);
  assert.ok(player(s, "a").result?.hand);
  assert.equal(player(s, "a").result?.best.length, 5);
  const view = redactTx(s, "c");
  assert.ok(player(view, "a").cards.every((c) => c !== null)); // contested showdown turns hands up
  const reset = onDeadline(s, s.settleAt!, newRng());
  assert.equal(reset.phase, "lobby");
  assert.equal(reset.board.length, 0);
  assert.equal(reset.pot, 0);
  assert.ok(reset.players.every((p) => p.cards.length === 0 && p.result === null));
  assert.equal(reset.startAt, s.settleAt! + START_MS);
});

test("min-raise: opening bet, raise size tracks the last full raise", () => {
  let s = table(["a", "b", "c"], { chips: { a: 2000, b: 2000, c: 2000 } });
  assert.equal(legalActions(s, "a")?.minRaiseTo, 40);
  assert.equal(err(s, "a", { type: "bet", amount: 30 }), "Minimum raise is to 40");
  assert.equal(err(s, "a", { type: "bet", amount: 20 }), "Raise must top the current bet");
  assert.equal(err(s, "a", { type: "bet", amount: 5000 }), "Not enough chips");
  s = act(s, "a", { type: "bet", amount: 100 }); // raise by 80
  assert.equal(s.minRaise, 80);
  assert.equal(legalActions(s, "b")?.minRaiseTo, 180);
  assert.equal(err(s, "b", { type: "bet", amount: 150 }), "Minimum raise is to 180");
  s = act(s, "b", { type: "bet", amount: 180 });
  assert.equal(player(s, "a").acted, false); // a full raise reopens the action
  assert.equal(s.turnId, "c");
  s = act(s, "c", { type: "call" });
  assert.equal(s.turnId, "a");
  assert.equal(legalActions(s, "a")?.callAmount, 80);
  s = act(act(s, "a", { type: "call" }), "b", { type: "check" });
  assert.equal(s.phase, "flop");
});

test("postflop opening bet must be at least the big blind", () => {
  let s = table(["a", "b"]);
  s = act(act(s, "a", { type: "call" }), "b", { type: "check" });
  assert.equal(legalActions(s, "b")?.minRaiseTo, BIG_BLIND);
  assert.equal(err(s, "b", { type: "bet", amount: 10 }), "Minimum raise is to 20");
  assert.equal(err(s, "b", { type: "call" }), "Nothing to call");
  s = act(s, "b", { type: "bet", amount: 60 });
  assert.equal(legalActions(s, "a")?.callAmount, 60);
  assert.equal(err(s, "a", { type: "check" }), "You must call or fold");
});

test("a short all-in raise does not reopen betting for players who already acted", () => {
  let s = table(["a", "b", "c"], { chips: { a: 2000, b: 150, c: 2000 } });
  s = act(s, "a", { type: "bet", amount: 100 });
  s = act(s, "b", { type: "allIn" }); // to 150: only a 50 raise on an 80 minimum
  assert.equal(s.currentBet, 150);
  assert.equal(s.minRaise, 80);
  assert.equal(player(s, "a").acted, true);
  s = act(s, "c", { type: "call" });
  assert.equal(s.turnId, "a");
  const legal = legalActions(s, "a");
  assert.equal(legal?.canRaise, false);
  assert.equal(legal?.callAmount, 50);
  assert.equal(err(s, "a", { type: "bet", amount: 400 }), "You can't raise here");
  s = act(s, "a", { type: "allIn" }); // all-in while raising is closed just calls
  assert.equal(player(s, "a").bet, 0); // street closed and collected
  assert.equal(player(s, "a").total, 150);
});

test("all-in and called: hands turn up and the board runs out on the server clock", () => {
  let s = table(["a", "b"], { hole: { a: ["As", "Ah"], b: ["Kc", "Kd"] }, board: ["2c", "7d", "9h", "Jc", "3s"] });
  s = act(s, "a", { type: "allIn" });
  assert.equal(s.turnId, "b");
  s = act(s, "b", { type: "call" });
  assert.equal(s.runout, true);
  assert.equal(s.turnId, null);
  assert.equal(s.board.length, 0);
  assert.ok(player(redactTx(s, "c"), "a").cards.every((c) => c !== null));
  assert.equal(serverDeadline(s), s.dealAt);
  s = onDeadline(s, s.dealAt!, newRng());
  assert.deepEqual([s.phase, s.board.length], ["flop", 3]);
  s = onDeadline(s, s.dealAt! - 1);
  assert.equal(s.board.length, 3);
  s = onDeadline(s, s.dealAt!);
  assert.deepEqual([s.phase, s.board.length], ["turn", 4]);
  s = onDeadline(s, s.dealAt!);
  assert.deepEqual([s.phase, s.board.length], ["river", 5]);
  s = onDeadline(s, s.dealAt!);
  assert.equal(s.phase, "showdown");
  assert.equal(player(s, "a").chips, START_CHIPS * 2);
  assert.equal(player(s, "b").chips, 0);
  assert.equal(s.runout, false);
  assert.equal(RUNOUT_MS, 2200);
});

test("side pots: short stack can only win what it covered", () => {
  let s = table(["a", "b", "c"], {
    chips: { a: 100, b: 300, c: 1000 },
    hole: { a: ["As", "Ah"], b: ["Kc", "Kd"], c: ["Qc", "Qd"] },
    board: ["2c", "7d", "9h", "Jc", "3s"],
  });
  s = act(s, "a", { type: "allIn" }); // 100
  s = act(s, "b", { type: "allIn" }); // 300
  s = act(s, "c", { type: "call" }); // 300
  assert.equal(s.runout, true);
  while (s.phase !== "showdown") s = onDeadline(s, serverDeadline(s)!);
  assert.equal(player(s, "a").chips, 300); // main pot: 100 from each
  assert.equal(player(s, "b").chips, 400); // side pot: 200 from b and c
  assert.equal(player(s, "c").chips, 700); // c keeps the uncalled 700
  assert.equal(player(s, "a").result?.net, 200);
  assert.equal(player(s, "c").result?.net, -300);
});

test("split pot hands the odd chip to the first winner left of the button", () => {
  let s = table(["a", "b", "c"], {
    chips: { a: 5, b: 2000, c: 2000 },
    hole: { a: ["2c", "3d"], b: ["2h", "3h"], c: ["2s", "3s"] },
    board: ["10c", "Jd", "Qh", "Ks", "Ac"],
  });
  s = act(s, "a", { type: "allIn" }); // a button: calls 5 all-in
  s = act(s, "b", { type: "fold" });
  assert.equal(s.runout, true); // big blind has nobody left to bet against
  while (s.phase !== "showdown") s = onDeadline(s, serverDeadline(s)!);
  // 15 main pot split between a and c: c is first left of the button and takes the odd chip
  assert.equal(player(s, "a").chips, 7);
  assert.equal(player(s, "c").chips, 1980 + 8 + 10 + 10);
  assert.equal(player(s, "b").chips, 1990);
  assert.equal(chipsAndPot(s), 5 + 4000);
});

test("auto-action: checks when free, folds to a bet, and sits the player out", () => {
  let s = table(["a", "b"]);
  const due = serverDeadline(s)!;
  assert.equal(due, s.turnAt! + TURN_MS);
  assert.equal(onDeadline(s, due - 1), s);
  const folded = onDeadline(s, due);
  assert.equal(folded.phase, "showdown");
  assert.equal(player(folded, "a").folded, true);
  assert.equal(player(folded, "a").sitOut, true);
  s = act(act(s, "a", { type: "call" }), "b", { type: "check" });
  const checked = onDeadline(s, serverDeadline(s)!);
  assert.equal(player(checked, "b").sitOut, true);
  assert.equal(checked.turnId, "a");
  assert.equal(checked.phase, "flop");
});

test("hole cards never leak to other viewers and the deck is hidden", () => {
  const s = table(["a", "b", "c"], { hole: { a: ["As", "Ah"], b: ["Kc", "Kd"], c: ["Qc", "Qd"] } });
  for (const viewer of ["a", "b", "c", "watcher"]) {
    const v = redactTx(s, viewer);
    assert.deepEqual(v.deck, []);
    for (const p of v.players) {
      if (p.id === viewer) assert.ok(p.cards.every((c) => c !== null));
      else assert.deepEqual(p.cards, [null, null]);
    }
    const raw = JSON.stringify(v);
    for (const p of s.players) if (p.id !== viewer) for (const card of p.cards) assert.ok(!raw.includes(JSON.stringify(card)) || v.board.some((b) => JSON.stringify(b) === JSON.stringify(card)));
  }
  const folded = act(s, "a", { type: "fold" });
  assert.deepEqual(player(redactTx(folded, "b"), "a").cards, [null, null]);
  assert.equal(player(redactTx(folded, "b"), "a").result, null);
});

test("folded players stay mucked at a contested showdown", () => {
  let s = table(["a", "b", "c"], { hole: { a: ["As", "Ah"], b: ["Kc", "Kd"], c: ["Qc", "Qd"] }, board: ["2c", "7d", "9h", "Jc", "3s"] });
  s = act(s, "a", { type: "fold" });
  s = act(act(s, "b", { type: "call" }), "c", { type: "check" });
  for (let i = 0; i < 3; i++) s = act(act(s, "b", { type: "check" }), "c", { type: "check" });
  assert.equal(s.phase, "showdown");
  const v = redactTx(s, "c");
  assert.deepEqual(player(v, "a").cards, [null, null]);
  assert.ok(player(v, "b").cards.every((c) => c !== null));
  assert.equal(player(s, "b").chips, START_CHIPS + 20);
});

test("busted players rebuy between hands, only when low and not in a hand", () => {
  let s = table(["a", "b"], { hole: { a: ["As", "Ah"], b: ["Kc", "Kd"] }, board: ["2c", "7d", "9h", "Jc", "3s"] });
  assert.equal(err(s, "a", { type: "rebuy" }), "Wait for the hand to finish");
  s = act(act(s, "a", { type: "allIn" }), "b", { type: "call" });
  while (s.phase !== "showdown") s = onDeadline(s, serverDeadline(s)!);
  assert.equal(err(s, "b", { type: "rebuy" }), "Wait for the hand to finish");
  s = onDeadline(s, s.settleAt!, newRng());
  assert.equal(s.startAt, null); // b is broke, one funded player cannot play
  assert.equal(err(s, "a", { type: "rebuy" }), "You still have chips");
  s = act(s, "b", { type: "rebuy" }, s.settleAt ?? NOW);
  assert.equal(player(s, "b").chips, START_CHIPS);
  assert.ok(s.startAt !== null);
});

test("joiners sit between hands and are dealt in next hand only", () => {
  let s = table(["a", "b"]);
  s = addTxPlayer(s, { id: "c", name: "C" });
  s = act(s, "c", { type: "sit", seat: 4 });
  assert.equal(player(s, "c").cards.length, 0);
  s = act(s, "a", { type: "fold" });
  s = onDeadline(s, s.settleAt!, newRng());
  s = onDeadline(s, s.startAt!, newRng());
  assert.equal(player(s, "c").cards.length, 2);
  assert.equal(s.round, 2);
});

test("leaving mid-hand folds and keeps the chips in the pot", () => {
  let s = table(["a", "b", "c"]);
  s = act(s, "a", { type: "bet", amount: 100 });
  const left = removeTxPlayer(s, "b", { now: NOW });
  assert.equal(player(left, "b").folded, true);
  assert.equal(left.turnId, "c"); // b's own turn passes on
  assert.equal(player(left, "b").total, SMALL_BLIND);
  const won = removeTxPlayer(left, "c", { now: NOW });
  assert.equal(won.phase, "showdown");
  assert.equal(player(won, "a").chips, START_CHIPS - 100 + 130);
  const reset = onDeadline(won, won.settleAt!, newRng());
  assert.deepEqual(reset.players.map((p) => p.id), ["a"]);
});

test("disconnect sits you out for the next hand, reconnect sits you back in", () => {
  let s = table(["a", "b", "c"]);
  s = setTxConnected(s, "c", false, NOW);
  assert.equal(player(s, "c").sitOut, true);
  assert.equal(player(s, "c").cards.length, 2); // current hand untouched
  s = setTxConnected(s, "c", true, NOW);
  assert.equal(player(s, "c").sitOut, false);
  s = setTxConnected(s, "c", false, NOW);
  s = act(s, "a", { type: "fold" });
  s = act(s, "b", { type: "fold" });
  s = onDeadline(s, s.settleAt!, newRng());
  s = onDeadline(s, s.startAt!, newRng());
  assert.equal(s.phase, "preflop");
  assert.equal(player(s, "c").cards.length, 0);
});

test("adversarial intents are refused without changing state", () => {
  const s = table(["a", "b"]);
  assert.equal(err(s, "ghost", { type: "fold" }), "You are not at this table");
  assert.equal(err(s, "b", { type: "fold" }), "It's not your turn");
  assert.equal(err(s, "a", { type: "sit", seat: 9 }), "No such seat");
  assert.equal(err(s, "a", { type: "sit", seat: 2 }), "Finish your hand first");
  assert.equal(err(s, "a", { type: "bet", amount: 1.5 }), "Not enough chips");
  assert.equal(err(s, "a", { type: "bet", amount: -5 }), "Raise must top the current bet");
  assert.equal(err(s, "a", { type: "check" }), "You must call or fold");
  assert.equal(err(s, "a", { type: "standUp" }), "Finish your hand first");
  assert.equal(err(s, "a", { type: "nope" } as unknown as TxIntent), "Unknown action");
  const lobby = createTxGame();
  const joined = addTxPlayer(lobby, { id: "a", name: "A" });
  assert.equal(err(joined, "a", { type: "fold" }), "No hand in play");
  assert.equal(err(joined, "a", { type: "standUp" }), "You're not seated");
  const sat = act(joined, "a", { type: "sit", seat: 0 });
  assert.equal(err(addTxPlayer(sat, { id: "b", name: "B" }), "b", { type: "sit", seat: 0 }), "Seat taken");
  assert.equal(addTxPlayer(s, { id: "a", name: "dupe" }), s);
});

test("parseTxIntent is strict about shape, ints and extra fields", () => {
  assert.deepEqual(parseTxIntent({ type: "fold" }), { type: "fold" });
  assert.deepEqual(parseTxIntent({ type: "bet", amount: 60 }), { type: "bet", amount: 60 });
  assert.deepEqual(parseTxIntent({ type: "sit", seat: 7 }), { type: "sit", seat: 7 });
  for (const bad of [
    null,
    "fold",
    [],
    {},
    { type: "fold", extra: 1 },
    { type: "bet" },
    { type: "bet", amount: 1.5 },
    { type: "bet", amount: -1 },
    { type: "bet", amount: 0 },
    { type: "bet", amount: "60" },
    { type: "bet", amount: 1e12 },
    { type: "bet", amount: 60, seat: 1 },
    { type: "sit", seat: -1 },
    { type: "sit", seat: 1.2 },
    { type: "sit", seat: 10 },
    { type: "hit" },
  ])
    assert.equal(parseTxIntent(bad), null, JSON.stringify(bad));
});

test("fuzz: chips are conserved and the engine never throws across random hands", () => {
  const rng = mulberry(42);
  let s = createTxGame();
  const ids = ["a", "b", "c", "d", "e"];
  ids.forEach((id, seat) => {
    s = addTxPlayer(s, { id, name: id });
    s = act(s, id, { type: "sit", seat }, 0);
  });
  let total = START_CHIPS * ids.length;
  let now = 0;
  let hands = 0;
  for (let i = 0; i < 4000 && hands < 60; i++) {
    const due = serverDeadline(s);
    const actor = s.turnId;
    const legal = actor ? legalActions(s, actor) : null;
    if (actor && legal && rng() < 0.9) {
      const roll = rng();
      let intent: TxIntent;
      if (roll < 0.15) intent = { type: "fold" };
      else if (roll < 0.5) intent = legal.canCheck ? { type: "check" } : { type: "call" };
      else if (roll < 0.85 && legal.canRaise) intent = { type: "bet", amount: legal.minRaiseTo + Math.floor(rng() * (legal.maxRaiseTo - legal.minRaiseTo + 1)) };
      else intent = { type: "allIn" };
      const r = applyTxIntent(s, actor, intent, { isHost: false, now, rng });
      assert.ok(r.ok, `${JSON.stringify(intent)} ${r.ok ? "" : r.error}`);
      s = r.state;
    } else if (due !== null) {
      now = Math.max(now, due);
      if (s.phase === "showdown") hands++;
      s = onDeadline(s, now, rng);
      s = { ...s, players: s.players.map((p) => (p.sitOut && p.seat !== null ? { ...p, sitOut: false } : p)) };
    }
    assert.equal(chipsAndPot(s), total);
    assert.ok(s.players.every((p) => p.chips >= 0));
    if (s.phase === "lobby") {
      for (const p of s.players) {
        if (p.seat === null || p.chips >= BIG_BLIND) continue;
        total += START_CHIPS - p.chips;
        s = act(s, p.id, { type: "rebuy" }, now);
      }
    }
  }
  assert.ok(hands >= 10);
});
