import { oddsRunner } from "./equity.ts";
import { evaluate } from "./eval.ts";
import type { TxCard } from "./types.ts";

export const BAD_BEAT_PCT = 75; // a loser needs at least this chance to win before the river

export interface BadBeat {
  loserId: string;
  winnerIds: string[]; // who took the main pot
  chance: number; // the loser's percent to win with the river still to come
}

// A hand that reached showdown with all its cards face up: did a big favorite lose on the last card?
// Odds come from the four cards that were on the board before the river, using only the hands passed in.
export function findBadBeat(contenders: readonly { id: string; hole: readonly TxCard[] }[], board: readonly TxCard[]): BadBeat | null {
  if (board.length !== 5 || contenders.length < 2) return null;
  const values = contenders.map((c) => evaluate([...c.hole, ...board]).value);
  const top = Math.max(...values);
  const runner = oddsRunner(
    contenders.map((c) => c.hole),
    board.slice(0, 4),
  );
  runner.run(Infinity);
  const odds = runner.result();
  const loser = contenders.findIndex((_, i) => (values[i] ?? top) < top && (odds[i]?.win ?? 0) >= BAD_BEAT_PCT);
  const loserId = contenders[loser]?.id;
  if (loserId === undefined) return null;
  return { loserId, winnerIds: contenders.filter((_, i) => values[i] === top).map((c) => c.id), chance: odds[loser]?.win ?? 0 };
}
