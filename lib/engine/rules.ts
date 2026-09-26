import { buildDeck, shuffle, type Rng } from "./deck.ts";
import { scoreHand, uniqueNumbers } from "./score.ts";
import type { ActionCard, ApplyResult, Card, GameEvent, GameState, Intent, Player } from "./types.ts";

export const MAX_GAME_PLAYERS = 10;

// Internal: rules mutate a structuredClone of the input, so the public API stays pure.
type Ctx = { s: GameState; events: GameEvent[]; rng: Rng };

export function createGame(opts: { goal?: number } = {}): GameState {
  return {
    phase: "lobby",
    round: 0,
    goal: opts.goal ?? 200,
    players: [],
    dealerIndex: 0,
    turnIndex: 0,
    dealing: false,
    deck: [],
    deckCount: 0,
    discard: [],
    pending: null,
    actionQueue: [],
    seq: 0,
    lastEvents: [],
  };
}

export function addPlayer(s: GameState, p: { id: string; name: string; isBot: boolean }): GameState {
  if (s.phase !== "lobby" || s.players.length >= MAX_GAME_PLAYERS || s.players.some((x) => x.id === p.id)) return s;
  const player: Player = {
    ...p,
    connected: true,
    ready: p.isBot,
    total: 0,
    hand: [],
    status: "waiting",
    roundHistory: [],
  };
  return { ...s, players: [...s.players, player], seq: s.seq + 1, lastEvents: [] };
}

export function setConnected(s: GameState, id: string, connected: boolean): GameState {
  return { ...s, players: s.players.map((p) => (p.id === id ? { ...p, connected } : p)) };
}

export function removePlayer(state: GameState, id: string, rng: Rng = Math.random): GameState {
  const idx = state.players.findIndex((p) => p.id === id);
  const removed = state.players[idx];
  if (!removed) return state;
  const s = structuredClone(state);
  s.players.splice(idx, 1);
  s.seq++;
  s.lastEvents = [];
  const n = s.players.length;
  if (s.phase === "lobby") return s;
  if (n === 0) return { ...createGame({ goal: s.goal }), seq: s.seq };

  s.discard.push(...removed.hand);
  const wasDealer = idx === s.dealerIndex;
  const wasTurn = idx === s.turnIndex;
  if (idx <= s.dealerIndex) s.dealerIndex = (s.dealerIndex - 1 + n) % n;
  if (idx < s.turnIndex) s.turnIndex--;
  s.turnIndex %= n;
  if (s.dealing && wasDealer && wasTurn) {
    s.dealing = false;
    s.turnIndex = nextActiveIndex(s, s.dealerIndex);
  }

  const pend = s.pending;
  if (pend?.type === "chooseTarget") {
    const options = pend.options.filter((o) => o !== id);
    if (pend.playerId === id || options.length === 0) {
      s.discard.push(pend.card);
      s.pending = null;
    } else s.pending = { ...pend, options };
  } else if (pend?.type === "flipThree" && pend.targetId === id) {
    s.discard.push(...pend.queued);
    s.pending = null;
  }
  s.discard.push(...s.actionQueue.filter((q) => q.playerId === id).map((q) => q.card));
  s.actionQueue = s.actionQueue.filter((q) => q.playerId !== id);

  const c: Ctx = { s, events: [], rng };
  advance(c);
  s.deckCount = s.deck.length;
  s.lastEvents = c.events;
  return s;
}

export function applyIntent(
  state: GameState,
  actorId: string,
  intent: Intent,
  opts: { isHost: boolean; rng?: Rng },
): ApplyResult {
  if (!state.players.some((p) => p.id === actorId)) return { ok: false, error: "You are not in this game" };
  const s = structuredClone(state);
  const c: Ctx = { s, events: [], rng: opts.rng ?? Math.random };
  const error = handle(c, actorId, intent, opts.isHost);
  if (error) return { ok: false, error };
  s.deckCount = s.deck.length;
  s.seq++;
  s.lastEvents = c.events;
  return { ok: true, state: s, events: c.events };
}

export function awaitingPlayerId(s: GameState): string | null {
  if (s.phase !== "playing") return null;
  if (s.pending?.type === "chooseTarget") return s.pending.playerId;
  if (s.pending?.type === "flipThree") return s.pending.targetId;
  if (s.dealing) return null;
  const p = s.players[s.turnIndex];
  return p?.status === "active" ? p.id : null;
}

export function redactGame(s: GameState): GameState {
  return { ...s, deck: [], deckCount: s.deck.length > 0 ? s.deck.length : s.deckCount };
}

// Probability the next card busts `playerId` (0 while holding Second Chance).
export function bustChance(s: GameState, playerId: string): number {
  const p = s.players.find((x) => x.id === playerId);
  if (!p || p.status !== "active" || hasSecondChance(p)) return 0;
  const pool = unseenCards(s);
  if (pool.length === 0) return 0;
  const held = new Set(p.hand.flatMap((c) => (c.kind === "number" ? [c.value] : [])));
  return pool.filter((c) => c.kind === "number" && held.has(c.value)).length / pool.length;
}

function unseenCards(s: GameState): Card[] {
  if (s.deck.length > 0) return s.deck;
  if (s.deckCount === 0) return s.discard; // next draw reshuffles the discard
  const seen = new Set<string>();
  const mark = (cards: Card[]) => cards.forEach((c) => seen.add(c.id));
  s.players.forEach((p) => mark(p.hand));
  mark(s.discard);
  if (s.pending?.type === "chooseTarget") mark([s.pending.card]);
  if (s.pending?.type === "flipThree") mark(s.pending.queued);
  mark(s.actionQueue.map((q) => q.card));
  return buildDeck().filter((c) => !seen.has(c.id));
}

function handle(c: Ctx, actorId: string, intent: Intent, isHost: boolean): string | null {
  const { s } = c;
  const actor = getPlayer(s, actorId);
  switch (intent.type) {
    case "ready":
      if (s.phase !== "lobby") return "The game has already started";
      actor.ready = intent.ready || actor.isBot;
      return null;
    case "start":
      if (!isHost) return "Only the host can start";
      if (s.phase !== "lobby") return "The game has already started";
      if (s.players.length < 2) return "Need at least 2 players";
      if (s.players.some((p) => !p.isBot && !p.ready)) return "Waiting for everyone to be ready";
      s.deck = shuffle(buildDeck(), c.rng);
      s.discard = [];
      startRound(c, s.players.length - 1);
      return null;
    case "nextRound":
      if (!isHost) return "Only the host can start the next round";
      if (s.phase !== "roundOver") return "The round is not over";
      for (const p of s.players) s.discard.push(...p.hand);
      startRound(c, (s.dealerIndex + 1) % s.players.length);
      return null;
    case "playAgain":
      if (!isHost) return "Only the host can restart";
      if (s.phase !== "gameOver") return "The game is not over";
      {
        const players = s.players.map((p): Player => ({ ...p, ready: p.isBot, total: 0, hand: [], status: "waiting", roundHistory: [] }));
        Object.assign(s, createGame({ goal: s.goal }), { seq: s.seq, players });
      }
      return null;
    case "hit": {
      if (awaitingPlayerId(s) !== actorId) return "It is not your turn";
      const pend = s.pending;
      if (pend?.type === "chooseTarget") return "Choose a target first";
      if (pend?.type === "flipThree") pend.remaining--;
      else s.turnIndex = nextActiveIndex(s, s.turnIndex);
      drawTo(c, actor, "draw");
      advance(c);
      return null;
    }
    case "stay": {
      if (awaitingPlayerId(s) !== actorId) return "It is not your turn";
      if (s.pending) return "You must finish resolving your card";
      actor.status = "stayed";
      c.events.push({ type: "stay", playerId: actorId, points: scoreHand(actor.hand).total });
      s.turnIndex = nextActiveIndex(s, s.turnIndex);
      advance(c);
      return null;
    }
    case "chooseTarget": {
      const pend = s.pending;
      if (pend?.type !== "chooseTarget" || pend.playerId !== actorId) return "Nothing to choose";
      if (!pend.options.includes(intent.targetId)) return "Invalid target";
      s.pending = null;
      resolveAction(c, actorId, pend.card, intent.targetId);
      advance(c);
      return null;
    }
  }
}

function getPlayer(s: GameState, id: string): Player {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown player ${id}`);
  return p;
}

function hasSecondChance(p: Player): boolean {
  return p.hand.some((c) => c.kind === "secondChance");
}

function activeIds(s: GameState): string[] {
  return s.players.filter((p) => p.status === "active").map((p) => p.id);
}

// Next active seat after `from` (wrapping, `from` itself last). Falls back to `from`.
function nextActiveIndex(s: GameState, from: number): number {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (s.players[j]?.status === "active") return j;
  }
  return from;
}

function startRound(c: Ctx, dealerIndex: number): void {
  const { s } = c;
  s.phase = "playing";
  s.round++;
  s.dealerIndex = dealerIndex;
  s.turnIndex = (dealerIndex + 1) % s.players.length;
  s.dealing = true;
  s.pending = null;
  s.actionQueue = [];
  for (const p of s.players) {
    p.hand = [];
    p.status = "active";
  }
  advance(c);
}

// Runs the game forward until it needs a player's input or the round ends.
function advance(c: Ctx): void {
  const { s } = c;
  for (;;) {
    if (s.phase !== "playing") return;
    const pend = s.pending;
    if (pend?.type === "chooseTarget") return;
    if (pend?.type === "flipThree") {
      const t = getPlayer(s, pend.targetId);
      if (t.status === "active" && pend.remaining > 0) return;
      s.pending = null;
      if (t.status === "active") s.actionQueue.unshift(...pend.queued.map((card) => ({ playerId: t.id, card })));
      else s.discard.push(...pend.queued);
      continue;
    }
    const queued = s.actionQueue.shift();
    if (queued) {
      const p = getPlayer(s, queued.playerId);
      if (p.status === "active") startAction(c, p, queued.card);
      else s.discard.push(queued.card);
      continue;
    }
    if (activeIds(s).length === 0) return endRound(c);
    if (s.dealing) {
      const i = s.turnIndex;
      const p = s.players[i];
      if (i === s.dealerIndex) {
        s.dealing = false;
        s.turnIndex = nextActiveIndex(s, i);
      } else s.turnIndex = (i + 1) % s.players.length;
      if (p?.status === "active") drawTo(c, p, "deal");
      continue;
    }
    if (s.players[s.turnIndex]?.status === "active") return;
    s.turnIndex = nextActiveIndex(s, s.turnIndex);
  }
}

function takeCard(c: Ctx): Card | undefined {
  const { s } = c;
  if (s.deck.length === 0 && s.discard.length > 0) {
    s.deck = shuffle(s.discard, c.rng);
    s.discard = [];
    c.events.push({ type: "reshuffle" });
  }
  return s.deck.pop();
}

function drawTo(c: Ctx, p: Player, kind: "deal" | "draw"): void {
  const card = takeCard(c);
  if (!card) return endRound(c); // ponytail: every card is on the table; practically unreachable
  c.events.push({ type: kind, playerId: p.id, card });
  receive(c, p, card);
}

function receive(c: Ctx, p: Player, card: Card): void {
  const { s } = c;
  switch (card.kind) {
    case "number": {
      if (p.hand.some((h) => h.kind === "number" && h.value === card.value)) {
        const sc = p.hand.find((h) => h.kind === "secondChance");
        if (sc) {
          p.hand = p.hand.filter((h) => h !== sc);
          s.discard.push(sc, card);
          c.events.push({ type: "secondChanceUsed", playerId: p.id, card });
        } else {
          p.hand.push(card);
          p.status = "busted";
          c.events.push({ type: "bust", playerId: p.id, card });
        }
        return;
      }
      p.hand.push(card);
      if (uniqueNumbers(p.hand) >= 7) {
        p.status = "flip7";
        c.events.push({ type: "flip7", playerId: p.id });
        endRound(c);
      }
      return;
    }
    case "plus":
    case "x2":
      p.hand.push(card);
      return;
    default: {
      const pend = s.pending;
      const inFlipThree = pend?.type === "flipThree" && pend.targetId === p.id;
      if (inFlipThree && (card.kind !== "secondChance" || hasSecondChance(p))) pend.queued.push(card);
      else startAction(c, p, card);
    }
  }
}

function startAction(c: Ctx, p: Player, card: ActionCard): void {
  const { s } = c;
  let options: string[];
  if (card.kind === "secondChance") {
    if (!hasSecondChance(p)) {
      p.hand.push(card);
      return;
    }
    options = s.players.filter((o) => o.id !== p.id && o.status === "active" && !hasSecondChance(o)).map((o) => o.id);
  } else options = activeIds(s);
  const [only] = options;
  if (only === undefined) s.discard.push(card);
  else if (options.length === 1) resolveAction(c, p.id, card, only);
  else s.pending = { type: "chooseTarget", playerId: p.id, card, options };
}

function resolveAction(c: Ctx, sourceId: string, card: ActionCard, targetId: string): void {
  const { s } = c;
  const t = getPlayer(s, targetId);
  if (card.kind === "freeze") {
    t.status = "frozen";
    s.discard.push(card);
    c.events.push({ type: "freeze", sourceId, targetId, points: scoreHand(t.hand).total });
  } else if (card.kind === "flipThree") {
    s.discard.push(card);
    s.pending = { type: "flipThree", sourceId, targetId, remaining: 3, queued: [] };
    c.events.push({ type: "flipThree", sourceId, targetId });
  } else {
    t.hand.push(card);
    c.events.push({ type: "secondChancePassed", fromId: sourceId, toId: targetId });
  }
}

function endRound(c: Ctx): void {
  const { s } = c;
  if (s.pending?.type === "chooseTarget") s.discard.push(s.pending.card);
  if (s.pending?.type === "flipThree") s.discard.push(...s.pending.queued);
  s.discard.push(...s.actionQueue.map((q) => q.card));
  s.pending = null;
  s.actionQueue = [];
  s.dealing = false;
  const scores: Record<string, number> = {};
  for (const p of s.players) {
    const pts = p.status === "busted" ? 0 : scoreHand(p.hand, { flip7: p.status === "flip7" }).total;
    p.total += pts;
    p.roundHistory.push(pts);
    scores[p.id] = pts;
  }
  c.events.push({ type: "roundEnd", round: s.round, scores });
  const top = Math.max(...s.players.map((p) => p.total));
  if (top >= s.goal) {
    s.phase = "gameOver";
    c.events.push({ type: "gameOver", winnerIds: s.players.filter((p) => p.total === top).map((p) => p.id) });
  } else s.phase = "roundOver";
}
