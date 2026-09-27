import type { Rng } from "./deck.ts";
import { awaitingPlayerId, bustChance, duplicateChance } from "./rules.ts";
import { scoreHand, uniqueNumbers } from "./score.ts";
import type { ActionCard, GameState, Intent, Player } from "./types.ts";

export const BOT_NAMES = ["Pip", "Scout", "Juno", "Biscuit", "Mochi", "Ziggy", "Pepper", "Nova", "Waffles", "Bean"];

function roundPoints(p: Player): number {
  return p.status === "busted" ? 0 : scoreHand(p.hand).total;
}

function standing(p: Player): number {
  return p.total + roundPoints(p);
}

// Busted rivals still count: they keep their banked total.
function bestRival(s: GameState, me: Player): number {
  return Math.max(0, ...s.players.filter((p) => p.id !== me.id).map(standing));
}

// The game ends this round and `me` would finish behind: banking now only locks in the loss (a tie is a shared win).
function doomed(s: GameState, me: Player): boolean {
  const best = bestRival(s, me);
  return best >= s.goal && standing(me) < best;
}

// ponytail: treats the 3 flips as independent at today's odds; ignores the hand growing between them.
// A Second Chance absorbs one duplicate, so a shielded player busts only on two of the three.
export function bustInThree(s: GameState, playerId: string): number {
  const shielded = s.players.some((p) => p.id === playerId && p.hand.some((c) => c.kind === "secondChance"));
  const q = duplicateChance(s, playerId);
  return shielded ? 1 - (1 - q) ** 3 - 3 * q * (1 - q) ** 2 : 1 - (1 - q) ** 3;
}

// Freeze: bank yourself when it wins the game or a big hand is at risk; otherwise lock in a leader
// who has little on the table (never one it would push past the goal).
// Flip Three: the rival with the most expected points to lose (bust loss minus the value of 3 free cards).
// When no rival is expected to lose, take the cards yourself if they help, else give them to the weakest.
// A spare Second Chance goes to the weakest player. Shared with the UI's "Best pick".
export function pickTarget(s: GameState, chooserId: string, card: ActionCard, options: string[]): string | null {
  const candidates = s.players.filter((p) => options.includes(p.id));
  const me = candidates.find((p) => p.id === chooserId);
  if (card.kind === "freeze" && me && !doomed(s, me) && (standing(me) >= s.goal || (roundPoints(me) >= 25 && bustChance(s, me.id) >= 0.25)))
    return me.id;
  const others = candidates.filter((p) => p.id !== chooserId);
  const pool = others.length > 0 ? others : candidates;
  if (pool.length === 0) return null;
  if (card.kind === "flipThree") {
    // ponytail: flat ~20-point value for three cards; derive from the deck if bots misjudge it
    const GAIN = 20;
    const ev = (p: Player) => bustInThree(s, p.id) * roundPoints(p) - (1 - bustInThree(s, p.id)) * GAIN;
    const best = pool.reduce((a, b) => (ev(b) + b.total / 1000 > ev(a) + a.total / 1000 ? b : a));
    if (ev(best) > 0) return best.id;
    if (me && ev(me) < 0) return me.id;
    return pool.reduce((a, b) => (standing(b) - b.total / 1000 < standing(a) - a.total / 1000 ? b : a)).id;
  }
  const value: (p: Player) => number =
    card.kind === "secondChance"
      ? (p) => -standing(p)
      : (p) => (standing(p) >= s.goal ? -Infinity : p.total - roundPoints(p));
  const pick = pool.reduce((a, b) => (value(b) > value(a) ? b : a));
  // Every rival would bank a winning total: freezing yourself at least leaves them a chance to bust.
  if (card.kind === "freeze" && me && value(pick) === -Infinity) return me.id;
  return pick.id;
}

export function chooseBotIntent(s: GameState, botId: string, rng: Rng = Math.random): Intent | null {
  if (awaitingPlayerId(s) !== botId) return null;
  const pend = s.pending;
  if (pend?.type === "chooseTarget") {
    const targetId = pickTarget(s, botId, pend.card, pend.options);
    return targetId ? { type: "chooseTarget", targetId } : null;
  }
  if (pend?.type === "flipThree") return { type: "hit" };
  const me = s.players.find((p) => p.id === botId);
  if (!me) return null;
  const pts = scoreHand(me.hand).total;
  if (pts === 0) return { type: "hit" };
  if (doomed(s, me)) {
    // Nothing left to lose once the rival who beats us has banked, or nobody else can still bust.
    const best = bestRival(s, me);
    const lockedIn = s.players.some((p) => p.id !== botId && p.status !== "active" && standing(p) === best);
    if (lockedIn || !s.players.some((p) => p.id !== botId && p.status === "active")) return { type: "hit" };
  } else if (me.total + pts >= s.goal) return { type: "stay" };
  const risk = bustChance(s, botId);
  // ponytail: fixed risk threshold with jitter; tune if bots feel too timid/bold
  let limit = 0.28 + (rng() - 0.5) * 0.1;
  if (pts >= 30) limit -= 0.08;
  if (uniqueNumbers(me.hand) === 6) limit += 0.08;
  return risk < limit ? { type: "hit" } : { type: "stay" };
}
