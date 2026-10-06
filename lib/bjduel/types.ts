// Shared contract for Head-to-Head Blackjack: two players, one dealer, one 7-deck shoe. Cards come from lib/blackjack.
// The dealer is the referee, not the bank: whoever does better against the dealer takes the other's chips.
import type { ConnectionStatus } from "../client/types.ts";
import type { BjCard, Outcome } from "../blackjack/types.ts";

export type { BjCard, Outcome, Rank, Suit } from "../blackjack/types.ts";

export type Denom = 1 | 2 | 5;
export type Versus = "win" | "lose" | "push";

export interface DuelPlayer {
  id: string;
  name: string;
  connected: boolean;
  seat: 0 | 1; // 0 = the challenger who opened the table; each phone draws itself at the near side
  chips: number; // bankroll, excluding the stake while a hand is live
  stack: Denom[]; // the chips in the betting circle, in the order they were set down
  ready: boolean; // betting: locked the bet in
  cards: BjCard[]; // empty = not in this hand
  done: boolean; // stood, busted, doubled or dealt 21
  doubled: boolean; // the second half of `stack` is the double
  // settle only: how you did against the dealer, whether that beat your opponent, and the chips that changed hands
  result: { outcome: Outcome; vs: Versus; net: number } | null;
  rematch: boolean; // over: tapped Rematch
}

export type DuelPhase =
  | "lobby" // waiting for the second player
  | "betting" // both stack chips and lock in
  | "playing" // first to act alternates each hand; dealer's hole card hidden
  | "settle" // dealer played out, results shown until settleAt
  | "over"; // someone is broke; both tap Rematch for a fresh one

export interface DuelState {
  phase: DuelPhase;
  players: DuelPlayer[];
  dealer: (BjCard | null)[]; // null = hole card, REDACTED while playing
  shoe: BjCard[]; // REDACTED to []
  shoeLeft: number; // set by redact
  shuffled: boolean; // this hand came out of a freshly shuffled shoe (the table shows the shuffle before the deal)
  firstSeat: 0 | 1; // who is dealt to and acts first this hand
  turnId: string | null;
  turnAt: number | null; // server ms the current turn's clock began
  dealAt: number | null; // betting: server ms the hand deals once someone locked in
  settleAt: number | null; // settle: server ms the table moves on
  hand: number; // 1-based hand of the match; 0 before the first deal
  round: number; // hands dealt at this table, for animation keys
  matches: number; // matches started at this table
  seq: number;
}

export type DuelIntent =
  | { type: "chip"; value: Denom } // betting: set a chip in your circle
  | { type: "undo" } // betting: take the last chip back
  | { type: "clear" } // betting: take them all back
  | { type: "allin" } // betting: push every chip you have into the circle
  | { type: "lock" } // betting: done betting
  | { type: "hit" }
  | { type: "stand" }
  | { type: "double" }
  | { type: "rematch" }; // over

export interface DuelConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: DuelState; // already redacted for you
  deadlineAt?: number; // local ms: auto-deal (betting), auto-stand (playing) or next hand (settle)
  error: string | null;
  send: (intent: DuelIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
