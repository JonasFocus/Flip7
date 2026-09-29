// Shared contract for the Imposter party game. Engine (lib/imposter), server and UI import from here.

export type ImposterTimer = 90 | 120 | 300;

export interface ImposterPlayer {
  id: string;
  name: string;
  connected: boolean;
  eliminated: boolean; // voted out as an innocent; can't vote or be voted
}

export interface VoteResult {
  round: number;
  tally: Record<string, number>; // targetId -> votes
  votedOutId: string | null; // null = no strict majority
  wasImposter: boolean;
}

export type ImposterPhase =
  | "lobby" // host picks category + timer, needs >= 3 players
  | "clues" // cards dealt, everyone says 1-2 words, deliberation timer running
  | "voting" // everyone still in votes for one other player
  | "reveal" // vote result shown; host taps nextRound for the final round
  | "gameOver";

export interface ImposterState {
  phase: ImposterPhase;
  players: ImposterPlayer[];
  categoryId: string; // lobby setting: a CATEGORIES id or "random"
  timerSec: ImposterTimer;
  maxRounds: number; // 2: one extra round after a wrong vote
  round: number; // 0 in lobby
  category: string | null; // resolved category name for this game
  word: string | null; // REDACTED to null for the imposter's own view (and for everyone in lobby)
  imposterId: string | null; // REDACTED to null for everyone except the imposter, until gameOver
  starterId: string | null; // who gives the first clue this round
  cluesDeadline: number | null; // server clock ms when clues auto-advance to voting; clients get Room.cluesEndsInMs instead
  votingDeadline: number | null;
  votes: Record<string, string>; // voterId -> targetId. REDACTED during voting to only the viewer's own vote
  votedIds: string[]; // who has voted this round (always visible)
  lastResult: VoteResult | null;
  winner: "faithful" | "imposter" | null;
  seq: number;
}

export type ImposterIntent =
  | { type: "setCategory"; categoryId: string } // host, lobby
  | { type: "setTimer"; sec: ImposterTimer } // host, lobby
  | { type: "start" } // host, lobby -> clues (>= 3 players)
  | { type: "startVoting" } // host, clues -> voting (server also does this at cluesDeadline)
  | { type: "vote"; targetId: string } // any non-eliminated player, voting; last vote resolves the round
  | { type: "nextRound" } // host, reveal (not caught, rounds left) -> clues
  | { type: "playAgain" }; // host, gameOver -> lobby (players kept)

export interface Category {
  id: string;
  name: string;
  words: string[]; // family friendly, >= 16 each
}
