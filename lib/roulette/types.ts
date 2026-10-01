// Shared contract for Roulette. Engine (lib/roulette), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";

// A place on the layout where chips go. Numbers: 0..36. Splits are "s:lo-hi", streets "t:first" (1,4..34),
// corners "c:topLeft" (the lowest of the four), six lines "l:first" (first number of the upper street).
export type RlSpot =
  | `n:${number}`
  | `s:${number}-${number}`
  | `t:${number}`
  | `c:${number}`
  | `l:${number}`
  | `col:${1 | 2 | 3}`
  | `doz:${1 | 2 | 3}`
  | "red"
  | "black"
  | "odd"
  | "even"
  | "low"
  | "high";

export interface RlBet {
  spot: RlSpot;
  amount: number;
}

export type RlColor = "green" | "red" | "black";

export interface RlPlayer {
  id: string;
  name: string;
  connected: boolean;
  seat: number | null; // 0..SEATS-1, null = watching
  chips: number; // bankroll, excluding the chips currently on the table
  bets: RlBet[]; // chip placements in order (undo pops the last); use betTotals for one row per spot
  lastBets: RlBet[]; // aggregated bets from the previous spin, for rebet
  ready: boolean; // betting: tapped Spin
  result: { net: number; payout: number } | null; // settle only; payout includes the returned stake
}

export type RlPhase =
  | "betting" // chips go on the layout; the spin clock starts at the first bet
  | "spinning" // ball is in the wheel, result fixed but hidden
  | "settle"; // result shown, winners paid, until settleAt

export interface RlState {
  phase: RlPhase;
  players: RlPlayer[]; // join order, seat lives on the player
  result: number | null; // spinning: REDACTED to null. settle: the winning pocket
  history: number[]; // last HISTORY_SIZE results, oldest first
  spinAt: number | null; // betting: server ms the wheel spins once someone has bet
  landAt: number | null; // spinning: server ms the result is revealed
  settleAt: number | null; // settle: server ms the table reopens for betting
  round: number;
  seq: number;
}

export type RlIntent =
  | { type: "sit"; seat: number }
  | { type: "standUp" } // refunds chips on the layout; not while they are in a live spin
  | { type: "place"; spot: RlSpot; amount: number } // betting, seated: adds a chip placement
  | { type: "undo" } // removes the last placement
  | { type: "clear" } // removes all placements
  | { type: "rebet" } // repeats last spin's bets onto an empty layout
  | { type: "double" } // doubles every spot currently bet
  | { type: "ready" } // betting, with bets: ready up
  | { type: "rebuy" }; // betting, broke

export interface RlConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: RlState; // already redacted for you
  deadlineAt?: number; // local ms: auto-spin (betting), reveal (spinning) or next round (settle)
  error: string | null;
  send: (intent: RlIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
