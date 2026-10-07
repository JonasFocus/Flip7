// Shared contract for Blackjack. Engine (lib/blackjack), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";

export type Suit = "s" | "h" | "d" | "c";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export interface BjCard {
  rank: Rank;
  suit: Suit;
}

export type Outcome = "blackjack" | "win" | "push" | "lose";

// Kept per player for as long as the table lives; there are no accounts, so a new table starts fresh.
export interface BjStats {
  hands: number;
  wins: number; // wins and blackjacks
  pushes: number;
  bestStreak: number;
  biggestWin: number; // best single-hand net
  net: number; // chips won minus chips lost across all hands
}

// The second hand of a split. Hand 1 stays in the player's own cards/bet/done/doubled fields.
export interface BjHand {
  cards: BjCard[];
  bet: number;
  done: boolean;
  doubled: boolean;
}

export interface BjPlayer {
  id: string;
  name: string;
  connected: boolean;
  seat: number | null; // 0..SEATS-1, null = watching
  chips: number; // bankroll, excluding `bet` while a hand is live
  bet: number; // lobby: the wager for the next hand. playing/settle: the stake on the table
  ready: boolean; // lobby: tapped Deal
  cards: BjCard[]; // empty = not in this hand
  done: boolean; // stood, busted, doubled or dealt 21
  doubled: boolean;
  hand2: BjHand | null; // set by a split; hand 2 is played after hand 1
  insurance: number | null; // side bet already taken out of chips (half the bet, once per seat); null = still deciding in the insurance phase
  stats: BjStats;
  streak: number; // consecutive winning hands; a push keeps it, a loss resets it
  // settle only; net includes the streak bonus and insurance. After a split, outcome is the round's aggregate (win if net > 0, push if 0, else lose)
  // and `split` holds each hand's own result, hand 1 first.
  result: { outcome: Outcome; net: number; bonus: number; split?: { outcome: Outcome; net: number }[] } | null;
}

export type BjPhase =
  | "lobby" // betting between hands; anyone may sit, bet and tap Deal
  | "insurance" // dealer shows an ace: each player takes or declines insurance until the deadline, then the dealer peeks
  | "playing" // seats act in order; dealer's hole card hidden
  | "settle"; // dealer played out, results shown until settleAt

export interface BjState {
  phase: BjPhase;
  players: BjPlayer[]; // join order, seat lives on the player
  dealer: (BjCard | null)[]; // null = hole card, REDACTED while playing
  shoe: BjCard[]; // REDACTED to []
  shoeLeft: number; // set by redact: cards left in the shoe (jumps back to 364 on a shuffle), for counters
  turnId: string | null;
  turnAt: number | null; // server ms the current turn (or the insurance offer) began
  dealAt: number | null; // lobby: server ms the hand auto-deals once someone tapped Deal
  settleAt: number | null; // settle: server ms the table resets for betting
  round: number;
  seq: number;
}

export type BjIntent =
  | { type: "sit"; seat: number }
  | { type: "standUp" } // not while holding cards
  | { type: "bet"; amount: number } // lobby, seated: sets the wager (0 clears)
  | { type: "deal" } // lobby, seated with a bet: ready up
  | { type: "hit" }
  | { type: "stand" }
  | { type: "double" }
  | { type: "split" } // first two cards of equal value, one split per round
  | { type: "insure" } // insurance phase: stake half the bet, pays 2:1 if the dealer has blackjack
  | { type: "decline" } // insurance phase: no thanks
  | { type: "rebuy" }; // lobby, broke

export interface BjConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: BjState; // already redacted for you
  deadlineAt?: number; // local ms: auto-deal (lobby), auto-stand (playing) or next hand (settle)
  error: string | null;
  send: (intent: BjIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
