// Shared contract for Liar's Dice. Engine (lib/liarsdice), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";

export type DiceCount = 3 | 4 | 5;

export interface Bid {
  count: number; // >= 1
  face: number; // 2-6; ones are wild and can't be bid
}

export interface DicePlayer {
  id: string;
  name: string;
  connected: boolean;
  offlineSince: number | null; // server ms; drives the 30s auto-act for an offline awaited player
  diceCount: number; // always visible; 0 after start = eliminated
  dice: number[]; // REDACTED to [] for other viewers outside reveal/gameOver
}

export interface Challenge {
  bidderId: string;
  callerId: string;
  bid: Bid;
  total: number; // dice showing bid.face or 1 across all active players
  loserId: string;
}

export type DicePhase =
  | "lobby" // host picks dice per player, needs >= 2 players
  | "bidding" // dice rolled; turnId bids or calls liar
  | "reveal" // all dice shown; host (or revealDeadline) starts the next round
  | "gameOver";

export interface DiceState {
  phase: DicePhase;
  players: DicePlayer[]; // seat order
  startDice: DiceCount;
  round: number; // 0 in lobby
  turnId: string | null; // who must act in bidding
  turnAt: number | null; // server ms the current turn began
  bid: Bid | null; // standing bid this round
  bidderId: string | null;
  lastChallenge: Challenge | null;
  revealDeadline: number | null; // server ms the next round auto-starts
  winnerId: string | null;
  seq: number;
}

export type DiceIntent =
  | { type: "setDice"; count: DiceCount } // host, lobby
  | { type: "start" } // host, lobby -> bidding (>= 2 players)
  | { type: "bid"; count: number; face: number } // turn player, bidding; must raise the standing bid
  | { type: "liar" } // turn player, bidding; challenges the standing bid
  | { type: "nextRound" } // host, reveal -> bidding (server also does this at revealDeadline)
  | { type: "playAgain" }; // host, gameOver -> lobby (players kept)

export interface DiceConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: DiceState; // already redacted for you
  deadlineAt?: number; // local ms: next round (reveal) or auto-play for an offline turn player (bidding)
  error: string | null;
  send: (intent: DiceIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
