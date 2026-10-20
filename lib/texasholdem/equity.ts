import { evaluate } from "./eval.ts";
import { newDeck } from "./rules.ts";
import type { TxCard } from "./types.ts";

export interface Odds {
  win: number; // percent of boards where this hand is the sole best
  tie: number; // percent of boards where it shares the best hand
}

export const PREFLOP_SAMPLES = 20_000; // a full preflop enumeration is up to 1.7 million boards
const SEED = 0x9e3779b9;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sameCard = (a: TxCard, b: TxCard): boolean => a.rank === b.rank && a.suit === b.suit;

// Every way to finish a flop or turn: at most C(45,2) = 990 boards.
function* combos(pool: readonly TxCard[], need: number, start = 0, picked: TxCard[] = []): Generator<TxCard[]> {
  if (picked.length === need) {
    yield picked;
    return;
  }
  for (let i = start; i < pool.length; i++) {
    const card = pool[i];
    if (card) yield* combos(pool, need, i + 1, [...picked, card]);
  }
}

// A fixed-seed sample of five-card boards, so every client sees the same figures.
function* samples(pool: readonly TxCard[], count: number): Generator<TxCard[]> {
  const rng = mulberry32(SEED);
  for (let n = 0; n < count; n++) {
    const taken = new Set<number>();
    while (taken.size < 5) taken.add(Math.floor(rng() * pool.length));
    yield [...taken].flatMap((i) => pool[i] ?? []);
  }
}

// Win chances for hands that are all face up, given the board so far. Only the cards passed in are ever read:
// cards nobody can see stay in the unknown pool. Work happens in slices so a phone never drops a frame.
export function oddsRunner(holes: readonly (readonly TxCard[])[], board: readonly TxCard[]): { run: (budgetMs: number) => boolean; result: () => Odds[] } {
  const seen = [...holes.flat(), ...board];
  const pool = newDeck(() => 0).filter((c) => !seen.some((s) => sameCard(s, c)));
  const need = 5 - board.length;
  const boards = need === 5 ? samples(pool, PREFLOP_SAMPLES) : combos(pool, need);
  const wins = holes.map(() => 0);
  const ties = holes.map(() => 0);
  let total = 0;

  const tally = (rest: TxCard[]) => {
    const values = holes.map((h) => evaluate([...h, ...board, ...rest]).value);
    const top = Math.max(...values);
    const sharing = values.filter((v) => v === top).length;
    values.forEach((v, i) => {
      if (v !== top) return;
      if (sharing === 1) wins[i] = (wins[i] ?? 0) + 1;
      else ties[i] = (ties[i] ?? 0) + 1;
    });
    total++;
  };

  return {
    // Returns true once every board has been counted.
    run(budgetMs) {
      const end = performance.now() + budgetMs;
      for (;;) {
        const next = boards.next();
        if (next.done) return true;
        tally(next.value);
        if (performance.now() >= end) return false;
      }
    },
    result: () => holes.map((_, i) => ({ win: total === 0 ? 0 : ((wins[i] ?? 0) / total) * 100, tie: total === 0 ? 0 : ((ties[i] ?? 0) / total) * 100 })),
  };
}
