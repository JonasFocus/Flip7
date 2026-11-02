import {
  addPlayer as addBasePlayer,
  applyIntent as applyBaseIntent,
  createGame as createBaseGame,
  redactGame as redactBaseGame,
  removePlayer as removeBasePlayer,
  duplicateChance,
  bustChance as ordinaryBustChance,
  type DrawAdjustment,
} from "../lib/engine/rules.ts";
import { chooseBotIntent as chooseBaseBotIntent, pickTarget, type BotOdds } from "../lib/engine/bots.ts";
import type { Rng } from "../lib/engine/deck.ts";
import { uniqueNumbers } from "../lib/engine/score.ts";
import type { BalanceStats, GameEvent, GameState, Player } from "../lib/engine/types.ts";

const EARLY_HAND_NUMBERS = 2;
const MEANINGFUL_ROUND_SCORE = 15;

function newStats(): BalanceStats {
  return {
    consecutiveBusts: 0,
    consecutiveLowRounds: 0,
    roundsWon: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    gameWins: 0,
    bestRoundScore: 0,
    assistedThisRound: false,
  };
}

export function createGame(opts: Parameters<typeof createBaseGame>[0] = {}): GameState {
  return { ...createBaseGame(opts), balance: {} };
}

export function addPlayer(s: GameState, player: Parameters<typeof addBasePlayer>[1]): GameState {
  const next = addBasePlayer(s, player);
  return next === s ? s : { ...next, balance: { ...s.balance, [player.id]: newStats() } };
}

function reliefChance(s: GameState, player: Player): number {
  const stats = s.balance?.[player.id];
  if (!stats || stats.assistedThisRound || uniqueNumbers(player.hand) > EARLY_HAND_NUMBERS) return 0;
  const leader = Math.max(0, ...s.players.map((p) => p.total));
  if (leader > 0 && player.total >= leader) return 0;
  if (stats.consecutiveBusts >= 2) return 0.8;
  return stats.consecutiveLowRounds >= 3 && leader - player.total >= 30 ? 0.65 : 0;
}

const adjustDraw: DrawAdjustment = (s, player, card, rng) => {
  const chance = reliefChance(s, player);
  if (chance === 0 || card.kind !== "number" || player.hand.some((c) => c.kind === "secondChance")) return card;
  const held = new Set(player.hand.flatMap((c) => c.kind === "number" ? [c.value] : []));
  if (!held.has(card.value)) return card;
  const safe = s.deck.flatMap((candidate, index) => candidate.kind !== "number" || !held.has(candidate.value) ? [index] : []);
  if (safe.length === 0 || rng() >= chance) return card;
  const index = safe[Math.floor(rng() * safe.length)];
  const replacement = index === undefined ? undefined : s.deck[index];
  if (index === undefined || !replacement) return card;
  s.deck[index] = card;
  const stats = s.balance?.[player.id];
  if (stats) stats.assistedThisRound = true;
  return replacement;
};

export const balanceOdds: BotOdds = {
  nextDraw(s, id) {
    const player = s.players.find((p) => p.id === id);
    const ordinary = ordinaryBustChance(s, id);
    return player && ordinary < 1 ? ordinary * (1 - reliefChance(s, player)) : ordinary;
  },
  threeDraws(s, id) {
    const player = s.players.find((p) => p.id === id);
    const q = duplicateChance(s, id);
    const shielded = player?.hand.some((c) => c.kind === "secondChance");
    const ordinary = shielded ? 1 - (1 - q) ** 3 - 3 * q * (1 - q) ** 2 : 1 - (1 - q) ** 3;
    // Like the base bot estimate, hold today's hand and duplicate rate fixed for the three draws.
    const chance = player && q < 1 ? reliefChance(s, player) : 0;
    const oneMoreDuplicate = shielded ? 3 * q ** 2 * (1 - q) : 3 * q * (1 - q) ** 2;
    return Math.max(0, ordinary - chance * oneMoreDuplicate);
  },
};

function finishMove(s: GameState, events: GameEvent[]): void {
  const round = events.find((event) => event.type === "roundEnd");
  if (round) {
    const top = Math.max(0, ...Object.values(round.scores));
    for (const player of s.players) {
      const stats = s.balance?.[player.id];
      if (!stats) continue;
      const points = round.scores[player.id] ?? 0;
      const won = top > 0 && points === top;
      stats.consecutiveBusts = player.status === "busted" ? stats.consecutiveBusts + 1 : 0;
      stats.consecutiveLowRounds = points < MEANINGFUL_ROUND_SCORE ? stats.consecutiveLowRounds + 1 : 0;
      stats.currentWinStreak = won ? stats.currentWinStreak + 1 : 0;
      if (won) stats.roundsWon++;
      stats.bestWinStreak = Math.max(stats.bestWinStreak, stats.currentWinStreak);
      stats.bestRoundScore = Math.max(stats.bestRoundScore, points);
    }
  }
  const ended = events.find((event) => event.type === "gameOver");
  if (!ended) return;
  if (round) for (const id of ended.winnerIds) {
    const stats = s.balance?.[id];
    if (stats) stats.gameWins++;
  }
  s.recap = Object.fromEntries(s.players.flatMap((player) => {
    const stats = s.balance?.[player.id];
    return stats ? [[player.id, { gameWins: stats.gameWins, bestWinStreak: stats.bestWinStreak, bestRoundScore: stats.bestRoundScore }]] : [];
  }));
}

export function applyIntent(state: GameState, actorId: string, intent: Parameters<typeof applyBaseIntent>[2], opts: Parameters<typeof applyBaseIntent>[3]) {
  const startsRound = intent.type === "start" || intent.type === "nextRound" || intent.type === "restart" || intent.type === "playAgain";
  const input = startsRound ? {
    ...state,
    balance: Object.fromEntries(Object.entries(state.balance ?? {}).map(([id, stats]) => [id, { ...stats, assistedThisRound: false }])),
  } : state;
  const result = applyBaseIntent(input, actorId, intent, { ...opts, adjustDraw });
  if (result.ok) finishMove(result.state, result.events);
  return result;
}

export function removePlayer(state: GameState, id: string, rng: Rng = Math.random): GameState {
  const next = removeBasePlayer(state, id, rng, adjustDraw);
  if (next !== state) finishMove(next, next.lastEvents);
  return next;
}

export function chooseBotIntent(s: GameState, id: string, rng: Rng = Math.random) {
  return chooseBaseBotIntent(s, id, rng, balanceOdds);
}

export function redactGame(s: GameState): GameState {
  const visible = redactBaseGame(s);
  const pending = s.pending;
  if (pending?.type === "chooseTarget") {
    visible.suggestedTargetId = pickTarget(s, pending.playerId, pending.card, pending.options, balanceOdds) ?? undefined;
  }
  return visible;
}
