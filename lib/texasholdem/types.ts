// Shared contract for Texas Hold'em. Engine (lib/texasholdem), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";
import type { Rank, Suit } from "../blackjack/types.ts";

export type { Rank, Suit };
export interface TxCard {
  rank: Rank;
  suit: Suit;
}

export const TX_REACTIONS = ["👍", "😂", "😮", "😭", "🔥", "👏", "🤝", "💀"] as const;
export type TxReaction = (typeof TX_REACTIONS)[number];

export interface TxHandResult {
  won: number; // chips collected from the pots, not counting an uncalled bet returned to you
  net: number; // everything you got back minus everything you put in
  hand: string | null; // "Two pair, Kings and Fives"; null when folded or the hand was never shown down
  best: TxCard[]; // the five cards that make `hand`, for highlighting; [] when hand is null
  second?: { hand: string | null; best: TxCard[]; won: number }; // run twice: the same for the second board, whose share of `won` is this (`hand` and `best` are the first board)
}

export interface TxPlayer {
  id: string;
  name: string;
  connected: boolean;
  droppedAt: number | null; // server ms the socket dropped; null while connected
  seat: number | null; // 0..SEATS-1, null = watching
  chips: number; // stack behind, excluding what is already in the pot
  bet: number; // committed this street
  total: number; // committed this hand
  cards: (TxCard | null)[]; // [] = not in this hand; null entries are hidden from this viewer (REDACTED)
  folded: boolean;
  allIn: boolean;
  acted: boolean; // acted since the last full raise; may raise only while false
  sitOut: boolean; // skipped when dealing the next hand (timed out or chose to)
  timedOut: boolean; // sat out by the turn clock; cleared when they sit in or out themselves
  gone: boolean; // left mid-hand: kept until the hand ends so their chips stay in the pot
  shown: boolean; // turned their hand face up voluntarily
  result: TxHandResult | null; // showdown only
  reaction: { emoji: TxReaction; at: number } | null; // last emoji sent and its server ms; shown briefly, stale ones ignored
}

export type TxPhase =
  | "lobby" // between hands; the next one starts once two funded players are seated
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"; // pots paid, results shown until settleAt

export type TxPace = "casual" | "turbo"; // casual: static blinds; turbo: they rise every few hands

export interface TxBlinds {
  smallBlind: number;
  bigBlind: number; // of the hand in play, or of the next hand in the lobby
  next: { smallBlind: number; bigBlind: number; inHands: number } | null; // the following level and how many hands away it starts; null when the blinds no longer rise
}

export interface TxState {
  phase: TxPhase;
  players: TxPlayer[]; // join order, seat lives on the player
  board: TxCard[];
  deck: TxCard[]; // REDACTED to []
  stacks: Record<string, number>; // chips kept for players who left with more than 0, restored if they rejoin; REDACTED to {}
  pot: number; // everything committed this hand, including the current street
  button: number | null; // seat of the dealer button
  sbId: string | null;
  bbId: string | null;
  currentBet: number; // highest street bet to match
  pace: TxPace;
  paceRound: number; // hands already dealt when the pace was chosen; blind levels count from here
  blinds: TxBlinds;
  minRaise: number; // size of the last full raise (the big blind at street start)
  turnId: string | null;
  turnAt: number | null; // server ms the current turn begins
  startAt: number | null; // lobby: server ms the next hand is dealt
  dealAt: number | null; // all-in runout: server ms the next street is dealt
  settleAt: number | null; // showdown: server ms the table resets
  runout: boolean; // betting is over, the board is running out with cards face up
  runTwice: boolean; // host setting: offer to run the board twice when everyone is all-in before the river
  ask: { ids: string[]; yes: string[] } | null; // runout: players asked to run it twice and who agreed so far; the vote closes at dealAt
  second: TxCard[] | null; // run twice: the second board, dealt once the first is complete; the cards both boards share are repeated
  round: number;
  seq: number;
}

export type TxIntent =
  | { type: "sit"; seat: number }
  | { type: "standUp" }
  | { type: "sitOut" }
  | { type: "sitIn" }
  | { type: "rebuy" } // busted: back to the starting stack between hands
  | { type: "setPace"; pace: TxPace } // host only, between hands
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "bet"; amount: number } // raise TO this street total (an opening bet when nothing is bet yet)
  | { type: "allIn" }
  | { type: "react"; emoji: TxReaction } // any phase, never touches the hand
  | { type: "setRunTwice"; on: boolean } // host, between hands
  | { type: "runTwice"; yes: boolean } // everyone in the pot is asked once the betting is over; it only runs twice if all say yes
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
  addBot: () => void;
  leave: () => void;
}
