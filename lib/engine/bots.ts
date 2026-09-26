import type { Rng } from "./deck.ts";
import { awaitingPlayerId, bustChance } from "./rules.ts";
import { scoreHand, uniqueNumbers } from "./score.ts";
import type { ActionCard, GameState, Intent, Player } from "./types.ts";

export const BOT_NAMES = ["Pip", "Scout", "Juno", "Biscuit", "Mochi", "Ziggy", "Pepper", "Nova", "Waffles", "Bean"];

function roundPoints(p: Player): number {
  return p.status === "busted" ? 0 : scoreHand(p.hand).total;
}

function standing(p: Player): number {
  return p.total + roundPoints(p);
}

function pickTarget(s: GameState, botId: string, card: ActionCard, options: string[]): string {
  const candidates = s.players.filter((p) => options.includes(p.id));
  const others = candidates.filter((p) => p.id !== botId);
  const pool = others.length > 0 ? others : candidates;
  // Second Chance goes to the weakest player; Freeze / Flip Three hit the leader.
  const better = card.kind === "secondChance" ? (a: Player, b: Player) => standing(a) < standing(b) : (a: Player, b: Player) => standing(a) > standing(b);
  const best = pool.reduce((a, b) => (better(b, a) ? b : a));
  return best.id;
}

export function chooseBotIntent(s: GameState, botId: string, rng: Rng = Math.random): Intent | null {
  if (awaitingPlayerId(s) !== botId) return null;
  const pend = s.pending;
  if (pend?.type === "chooseTarget") return { type: "chooseTarget", targetId: pickTarget(s, botId, pend.card, pend.options) };
  if (pend?.type === "flipThree") return { type: "hit" };
  const me = s.players.find((p) => p.id === botId);
  if (!me) return null;
  const pts = scoreHand(me.hand).total;
  if (pts === 0) return { type: "hit" };
  if (me.total + pts >= s.goal) return { type: "stay" };
  const risk = bustChance(s, botId);
  // ponytail: fixed risk threshold with jitter; tune if bots feel too timid/bold
  let limit = 0.28 + (rng() - 0.5) * 0.1;
  if (pts >= 30) limit -= 0.08;
  if (uniqueNumbers(me.hand) === 6) limit += 0.08;
  return risk < limit ? { type: "hit" } : { type: "stay" };
}
