import assert from "node:assert/strict";
import { test } from "node:test";
import {
  START_CHIPS,
  START_MS,
  TX_BOT_STYLES,
  addTxPlayer,
  applyTxIntent,
  chooseTxIntent,
  createTxGame,
  legalActions,
  newDeck,
  nextTxBotMove,
  onDeadline,
  serverDeadline,
  type Rank,
  type TxCard,
  type TxIntent,
  type TxPersonality,
  type TxState,
} from "../lib/texasholdem/index.ts";
import { preflopTier } from "../lib/texasholdem/bot.ts";

const cd = (s: string): TxCard => ({ rank: s.slice(0, -1) as Rank, suit: s.slice(-1) as TxCard["suit"] });
const pair = (a: string, b: string): [TxCard, TxCard] => [cd(a), cd(b)];
const PERSONALITIES: TxPersonality[] = ["tight", "maniac", "station"];

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function act(s: TxState, actor: string, intent: TxIntent, now = 100_000): TxState {
  const r = applyTxIntent(s, actor, intent, { isHost: false, now });
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.state;
}

function seat(ids: string[], chips: number[] = []): TxState {
  let s = createTxGame();
  ids.forEach((id, i) => {
    s = addTxPlayer(s, { id, name: id });
    s = act(s, id, { type: "sit", seat: i }, 1000);
  });
  return { ...s, players: s.players.map((p, i) => ({ ...p, chips: chips[i] ?? p.chips })) };
}

// Deals the first hand; `hole` and `board` rig the cards.
function table(ids: string[], opts: { hole?: Record<string, string[]>; board?: string[] } = {}): TxState {
  const started = onDeadline(seat(ids), 1000 + START_MS, mulberry(7));
  assert.equal(started.phase, "preflop");
  return {
    ...started,
    players: started.players.map((p) => (opts.hole?.[p.id] ? { ...p, cards: opts.hole[p.id]!.map(cd) } : p)),
    deck: opts.board ? [...opts.board.map(cd), ...newDeck(() => 0.5)] : started.deck,
  };
}

const total = (s: TxState) => s.players.reduce((n, p) => n + p.chips, 0) + (s.phase === "showdown" ? 0 : s.pot);

test("preflopTier ranks pairs, suited and connected hands above trash", () => {
  const tier = (a: string, b: string) => preflopTier(pair(a, b));
  assert.ok(tier("As", "Ah") > tier("As", "Ks"));
  assert.ok(tier("Ks", "Kh") > tier("As", "Ks"));
  assert.ok(tier("As", "Ks") > tier("7c", "2d"));
  assert.equal(tier("7c", "2d"), 0);
  assert.ok(tier("9s", "8s") > tier("9s", "4d"), "suited connectors beat an offsuit gapper");
  assert.ok(tier("Ks", "Qs") > tier("Kd", "Qc"), "suited beats offsuit");
  assert.ok(tier("Qs", "Qh") > tier("5s", "5h"));
});

test("styles use known personalities with unique names", () => {
  assert.equal(new Set(TX_BOT_STYLES.map((b) => b.name)).size, TX_BOT_STYLES.length);
  for (const p of PERSONALITIES) assert.ok(TX_BOT_STYLES.some((b) => b.personality === p));
});

// Plays one hand to showdown with every seat run by chooseTxIntent, checking each choice against the rules.
function playHand(seed: number, personalities: TxPersonality[]): void {
  const rng = mulberry(seed);
  const stacks = personalities.map(() => [40, 100, 400, 2000, 2000][Math.floor(rng() * 5)] ?? 2000);
  const ids = personalities.map((_, i) => `b${i}`);
  let s = onDeadline(seat(ids, stacks), 1000 + START_MS, rng);
  const chips = total(s);
  let actions = 0;
  let steps = 0;
  while (s.phase !== "showdown") {
    assert.ok(++steps < 400, `seed ${seed} stalled`);
    assert.equal(total(s), chips, `seed ${seed} leaked chips`);
    if (s.turnId === null) {
      const due = serverDeadline(s);
      assert.notEqual(due, null);
      s = onDeadline(s, due ?? 0, rng);
      continue;
    }
    const id = s.turnId;
    const personality = personalities[ids.indexOf(id)] ?? "tight";
    const legal = legalActions(s, id);
    assert.ok(legal);
    const intent = chooseTxIntent(s, id, personality, rng);
    assert.ok(intent, `seed ${seed} no intent`);
    if (intent.type === "check") assert.ok(legal.canCheck);
    if (intent.type === "call") assert.ok(!legal.canCheck);
    if (intent.type === "bet") {
      assert.ok(legal.canRaise);
      assert.ok(Number.isInteger(intent.amount));
      assert.ok(intent.amount >= legal.minRaiseTo && intent.amount <= legal.maxRaiseTo);
    }
    if (intent.type === "allIn") assert.ok(legal.canRaise);
    assert.ok(++actions < 200, `seed ${seed} too many actions`);
    s = act(s, id, intent, s.turnAt ?? 0); // always inside the turn clock, so no timeout is ever needed
    assert.ok(s.players.every((p) => !p.sitOut), `seed ${seed} someone timed out`);
  }
  assert.equal(total(s), chips);
}

test("fuzz: bots only choose legal intents, conserve chips and always finish the hand", () => {
  for (const personality of PERSONALITIES) {
    for (let seed = 1; seed <= 300; seed++) {
      const n = 2 + (seed % 5);
      playHand(seed, Array.from({ length: n }, () => personality));
    }
  }
  for (let seed = 1000; seed < 1300; seed++) {
    const pick = mulberry(seed);
    const n = 2 + Math.floor(pick() * 5);
    playHand(seed, Array.from({ length: n }, () => PERSONALITIES[Math.floor(pick() * 3)] ?? "tight"));
  }
});

test("no intent when it is not the bot's turn, during a runout or between hands", () => {
  const s = table(["a", "b", "c"]);
  const waiting = s.players.find((p) => p.id !== s.turnId)!.id;
  for (const p of PERSONALITIES) assert.equal(chooseTxIntent(s, waiting, p, mulberry(1)), null);
  assert.equal(chooseTxIntent(s, "nobody", "tight", mulberry(1)), null);

  const heads = table(["a", "b"]);
  const runout = act(act(heads, "a", { type: "allIn" }), "b", { type: "call" });
  assert.ok(runout.runout);
  for (const id of ["a", "b"]) assert.equal(chooseTxIntent(runout, id, "maniac", mulberry(1)), null);

  const lobby = seat(["a", "b"]);
  assert.equal(chooseTxIntent(lobby, "a", "maniac", mulberry(1)), null);
  const folded = act(heads, heads.turnId!, { type: "fold" });
  assert.equal(folded.phase, "showdown");
  assert.equal(chooseTxIntent(folded, "a", "maniac", mulberry(1)), null);
});

const trials = (n: number, run: (rng: () => number) => TxIntent | null) =>
  Array.from({ length: n }, (_, i) => run(mulberry(i + 1)));
const isBet = (i: TxIntent | null) => i?.type === "bet" || i?.type === "allIn";

// Heads-up flop with `b` first to act: a limps, b checks, so any later action is on the flop.
function flop(board: string[], hole: Record<string, string[]>): TxState {
  return act(act(table(["a", "b"], { hole, board }), "a", { type: "call" }), "b", { type: "check" });
}

test("a maniac bets a medium hand far more often than a tight player", () => {
  const s = flop(["Kh", "8c", "3s", "4d", "9h"], { a: ["2c", "5d"], b: ["Ks", "7d"] });
  assert.equal(s.turnId, "b");
  const count = (p: TxPersonality) => trials(300, (rng) => chooseTxIntent(s, "b", p, rng)).filter(isBet).length;
  assert.ok(count("maniac") >= 2 * count("tight"), `maniac ${count("maniac")} tight ${count("tight")}`);
  assert.ok(count("maniac") > 200);
});

test("a station calls a pot-sized bet with a weak pair where a tight player folds", () => {
  const s = act(flop(["Kh", "7c", "3s", "4d", "9h"], { a: ["Ac", "Qd"], b: ["7s", "5d"] }), "b", { type: "check" });
  const bet = act(s, "a", { type: "bet", amount: 40 });
  assert.equal(bet.turnId, "b");
  const folds = (p: TxPersonality) => trials(300, (rng) => chooseTxIntent(bet, "b", p, rng)).filter((i) => i?.type === "fold").length;
  assert.equal(folds("station"), 0);
  assert.ok(folds("tight") > 250, `tight folded ${folds("tight")}`);
});

test("a tight player folds 72o to a raise", () => {
  const s = act(table(["a", "b"], { hole: { a: ["As", "Ah"], b: ["7c", "2d"] } }), "a", { type: "bet", amount: 60 });
  assert.equal(s.turnId, "b");
  const folds = trials(300, (rng) => chooseTxIntent(s, "b", "tight", rng)).filter((i) => i?.type === "fold").length;
  assert.ok(folds >= 270, `folded ${folds}`);
});

test("every personality bets or shoves quad kings when checked to", () => {
  const s = act(flop(["Kh", "Kd", "4s", "9h", "Jc"], { a: ["Ks", "Kc"], b: ["2c", "3d"] }), "b", { type: "check" });
  assert.equal(s.turnId, "a");
  for (const p of PERSONALITIES) {
    const picks = trials(100, (rng) => chooseTxIntent(s, "a", p, rng));
    assert.ok(picks.every(isBet), p);
  }
});

test("the same state and seed give the same intent", () => {
  const s = flop(["Kh", "8c", "3s", "4d", "9h"], { a: ["2c", "5d"], b: ["Ks", "7d"] });
  for (const p of PERSONALITIES) {
    for (let seed = 1; seed <= 20; seed++) {
      assert.deepEqual(chooseTxIntent(s, "b", p, mulberry(seed)), chooseTxIntent(s, "b", p, mulberry(seed)));
    }
  }
});

test("nextTxBotMove stays quiet on a human's turn and waits out the deal before a bot acts", () => {
  const s = table(["bot-a", "h"]);
  const botTurn = s.turnId === "bot-a" ? s : act(s, "h", { type: "call" });
  const humanTurn = s.turnId === "h" ? s : act(s, "bot-a", { type: "call" });
  assert.equal(nextTxBotMove(humanTurn, 0, mulberry(1)), null);

  const { turnAt } = botTurn;
  assert.ok(turnAt !== null);
  for (let seed = 1; seed <= 20; seed++) {
    const move = nextTxBotMove(botTurn, 0, mulberry(seed));
    assert.ok(move && move.playerId === "bot-a");
    assert.ok(move.atMs >= turnAt + 1000 && move.atMs <= turnAt + 2000, `${move.atMs} vs ${turnAt}`);
    const res = applyTxIntent(botTurn, move.playerId, move.intent, { isHost: false, now: move.atMs });
    assert.ok(res.ok, res.ok ? "" : res.error);
  }
  const late = nextTxBotMove(botTurn, turnAt + 5000, mulberry(1));
  assert.ok(late && late.atMs >= turnAt + 6000);
});

test("nextTxBotMove rebuys a busted bot and sits a benched one back in, only in the lobby", () => {
  let s = seat(["bot-a", "bot-b", "h"]);
  assert.equal(nextTxBotMove(s, 5000, mulberry(1)), null);
  s = { ...s, players: s.players.map((p) => (p.id === "bot-a" ? { ...p, chips: 5 } : p.id === "bot-b" ? { ...p, sitOut: true } : p)) };
  const first = nextTxBotMove(s, 5000, mulberry(1));
  assert.deepEqual(first && [first.playerId, first.intent, first.atMs], ["bot-a", { type: "rebuy" }, 6500]);
  s = act(s, "bot-a", { type: "rebuy" });
  const second = nextTxBotMove(s, 5000, mulberry(1));
  assert.deepEqual(second && [second.playerId, second.intent], ["bot-b", { type: "sitIn" }]);
  assert.equal(nextTxBotMove({ ...s, phase: "showdown" }, 5000, mulberry(1)), null);
});

test("a bot with no answer from the brain still checks or folds", () => {
  const s = table(["bot-a", "h"]);
  const botTurn = s.turnId === "bot-a" ? s : act(s, "h", { type: "call" });
  const stripped = { ...botTurn, players: botTurn.players.map((p) => (p.id === "bot-a" ? { ...p, cards: [] } : p)) };
  assert.equal(chooseTxIntent(stripped, "bot-a", "tight", mulberry(1)), null);
  const canCheck = legalActions(stripped, "bot-a")?.canCheck;
  assert.deepEqual(nextTxBotMove(stripped, 0, mulberry(1))?.intent, { type: canCheck ? "check" : "fold" });
});

// Drives a bot-only table on a virtual clock: a due bot move first, else the engine's own deadline.
function playBots(n: number, hands: number, seed: number): { rebuys: number; redealt: number } {
  const rng = mulberry(seed);
  let s = createTxGame();
  for (let i = 0; i < n; i++) {
    const style = TX_BOT_STYLES[(i + seed) % TX_BOT_STYLES.length]!;
    s = addTxPlayer(s, { id: `bot-${i}`, name: style.name });
    s = act(s, `bot-${i}`, { type: "sit", seat: i }, 1000);
  }
  let total = s.players.reduce((sum, p) => sum + p.chips, 0);
  let rebuys = 0;
  let redealt = 0;
  const waiting = new Set<string>();
  let now = 1000;
  for (let step = 0; step < hands * 400 && s.round < hands; step++) {
    const move = nextTxBotMove(s, now, rng);
    const due = serverDeadline(s);
    if (move && (due === null || move.atMs <= due)) {
      now = Math.max(now, move.atMs);
      if (move.intent.type === "rebuy") {
        total += START_CHIPS - (s.players.find((p) => p.id === move.playerId)?.chips ?? 0);
        rebuys++;
        waiting.add(move.playerId);
      }
      const res = applyTxIntent(s, move.playerId, move.intent, { isHost: false, now, rng });
      assert.ok(res.ok, res.ok ? "" : `${move.playerId} ${JSON.stringify(move.intent)}: ${res.error}`);
      s = res.state;
    } else {
      assert.ok(due !== null, `stalled in ${s.phase} at step ${step}`);
      now = Math.max(now, due);
      s = onDeadline(s, now, rng);
    }
    if (s.phase === "lobby") assert.equal(s.players.reduce((sum, p) => sum + p.chips, 0), total, "chips leaked");
    for (const p of s.players) {
      if (p.cards.length > 0 && waiting.delete(p.id)) redealt++;
    }
  }
  assert.ok(s.round >= hands, `only reached round ${s.round}`);
  return { rebuys, redealt };
}

test("bot-only tables of 3 to 6 play 200 hands with no stall, no illegal move and no leaked chips", () => {
  let rebuys = 0;
  let redealt = 0;
  for (let n = 3; n <= 6; n++) {
    for (const seed of [1, 2]) {
      const r = playBots(n, 200, seed * 10 + n);
      rebuys += r.rebuys;
      redealt += r.redealt;
    }
  }
  assert.ok(rebuys > 0, "nobody busted");
  assert.ok(redealt >= rebuys - 8, `${redealt} redealt of ${rebuys} rebuys`);
});
