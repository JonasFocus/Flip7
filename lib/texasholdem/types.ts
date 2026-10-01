// Shared contract for Texas Hold'em. Engine (lib/texasholdem), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";
import type { Rank, Suit } from "../blackjack/types.ts";

export type { Rank, Suit };
export interface TxCard {
  rank: Rank;
  suit: Suit;
}

export interface TxHandResult {
  won: number; // chips collected from the pots
  net: number; // won minus everything you put in
  hand: string | null; // "Two pair, Kings and Fives"; null when folded or the hand was never shown down
  best: TxCard[]; // the five cards that make `hand`, for highlighting; [] when hand is null
}

export interface TxPlayer {
  id: string;
  name: string;
  connected: boolean;
  seat: number | null; // 0..SEATS-1, null = watching
  chips: number; // stack behind, excluding what is already in the pot
  bet: number; // committed this street
  total: number; // committed this hand
  cards: (TxCard | null)[]; // [] = not in this hand; null entries are hidden from this viewer (REDACTED)
  folded: boolean;
  allIn: boolean;
  acted: boolean; // acted since the last full raise; may raise only while false
  sitOut: boolean; // skipped when dealing the next hand (timed out, disconnected or chose to)
  gone: boolean; // left mid-hand: kept until the hand ends so their chips stay in the pot
  shown: boolean; // turned their hand face up voluntarily
  result: TxHandResult | null; // showdown only
}

export type TxPhase =
  | "lobby" // between hands; the next one starts once two funded players are seated
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"; // pots paid, results shown until settleAt

export interface TxState {
  phase: TxPhase;
  players: TxPlayer[]; // join order, seat lives on the player
  board: TxCard[];
  deck: TxCard[]; // REDACTED to []
  pot: number; // everything committed this hand, including the current street
  button: number | null; // seat of the dealer button
  sbId: string | null;
  bbId: string | null;
  currentBet: number; // highest street bet to match
  minRaise: number; // size of the last full raise (the big blind at street start)
  turnId: string | null;
  turnAt: number | null; // server ms the current turn begins
  startAt: number | null; // lobby: server ms the next hand is dealt
  dealAt: number | null; // all-in runout: server ms the next street is dealt
  settleAt: number | null; // showdown: server ms the table resets
  runout: boolean; // betting is over, the board is running out with cards face up
  round: number;
  seq: number;
}

export type TxIntent =
  | { type: "sit"; seat: number }
  | { type: "standUp" }
  | { type: "sitOut" }
  | { type: "sitIn" }
  | { type: "rebuy" } // busted: back to the starting stack between hands
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; amount: number } // raise TO this street total (an opening bet when nothing is bet yet)
  | { type: "allIn" }
  | { type: "show" }; // showdown: turn your hand face up after everyone else folded

export interface TxActions {
  canCheck: boolean;
  callAmount: number; // chips to put in to call, capped at your stack
  canRaise: boolean;
  minRaiseTo: number; // lowest legal `bet` amount (your stack when that is less: an all-in)
  maxRaiseTo: number; // your whole stack as a street total
}

export interface TxConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: TxState; // already redacted for you
  deadlineAt?: number; // local ms: hand start (lobby), auto-action (your street), runout deal or table reset
  error: string | null;
  send: (intent: TxIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
