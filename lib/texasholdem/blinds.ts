import type { TxBlinds, TxPace } from "./types.ts";

// Casual stays on the first level; turbo climbs one level every TURBO_HANDS hands and then holds on the last.
export const BLIND_LEVELS = [
  [10, 20],
  [20, 40],
  [30, 60],
  [50, 100],
  [100, 200],
  [200, 400],
] as const;
export const TURBO_HANDS = 10;

// `handIndex` counts hands under the current pace from 0, so a slow hand never skips a level.
export function blindsFor(pace: TxPace, handIndex: number): TxBlinds {
  const level = pace === "turbo" ? Math.min(Math.floor(handIndex / TURBO_HANDS), BLIND_LEVELS.length - 1) : 0;
  const [smallBlind, bigBlind] = BLIND_LEVELS[level] ?? BLIND_LEVELS[0];
  const up = pace === "turbo" ? BLIND_LEVELS[level + 1] : undefined;
  return { smallBlind, bigBlind, next: up ? { smallBlind: up[0], bigBlind: up[1], inHands: TURBO_HANDS - (handIndex % TURBO_HANDS) } : null };
}
