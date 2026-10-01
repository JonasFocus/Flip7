// Shared contract for Baccarat (punto banco). Engine (lib/baccarat), server and UI import from here.
import type { Rank, Suit } from "../blackjack/types.ts";
import type { ConnectionStatus } from "../client/types.ts";

export interface BacCard {
  rank: Rank;
  suit: Suit;
}

export const BAC_SPOTS = ["player", "banker", "tie", "playerPair", "bankerPair"] as const;
export type BacSpot = (typeof BAC_SPOTS)[number];
export type BacBets = Record<BacSpot, number>;

export type BacWinner = "player" | "banker" | "tie";

// One finished coup: what the bead plate road records.
export interface BacRound {
  winner: BacWinner;
  playerTotal: number; // 0..9
  bankerTotal: number;
  playerPair: boolean;
  bankerPair: boolean;
  natural: boolean; // either side held 8 or 9 on two cards
}

export interface BacPlayer {
  id: string;
  name: string;
  connected: boolean;
  seat: number | null; // 0..SEATS-1, null = watching
  chips: number; // bankroll, excluding `bets` while a coup is live
  bets: BacBets; // betting: wagers for the next coup. dealing/settle: the stakes on the table
  lastBets: BacBets | null; // stakes of the last coup this player was dealt into, for rebet
  ready: boolean; // betting: tapped Deal
  result: { net: number; spots: BacBets } | null; // settle only; spots = net per bet spot (0 = pushed or not bet)
}

export type BacPhase =
  | "betting" // anyone may sit, bet and tap Deal
  | "dealing" // server reveals one card per stepAt, third-card tableau applied
  | "settle"; // result and payouts shown until settleAt

export interface BacState {
  phase: BacPhase;
  players: BacPlayer[]; // join order, seat lives on the player
  playerHand: BacCard[]; // reveal order is P, B, P, B, then third cards (player first)
  bankerHand: BacCard[];
  result: BacRound | null; // settle only
  road: BacRound[]; // last ROAD_LENGTH coups, oldest first
  shoe: BacCard[]; // REDACTED to []
  shoeLeft: number; // set by redact: cards left in the shoe, for counters
  dealAt: number | null; // betting: server ms the coup auto-deals once someone has a bet in
  stepAt: number | null; // dealing: server ms the next card is turned
  settleAt: number | null; // settle: server ms the table resets for betting
  round: number;
  seq: number;
}

export type BacIntent =
  | { type: "sit"; seat: number }
  | { type: "standUp" } // betting only
  | { type: "bet"; spot: BacSpot; amount: number } // betting, seated: sets that spot's wager (0 clears)
  | { type: "clearBets" }
  | { type: "rebet" } // betting, seated: restore the last coup's stakes if affordable
  | { type: "deal" } // betting, seated with a bet: ready up
  | { type: "rebuy" }; // betting, broke

export interface BacConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: BacState; // already redacted for you
  deadlineAt?: number; // local ms: auto-deal (betting) or next coup (settle); none while dealing
  error: string | null;
  send: (intent: BacIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
