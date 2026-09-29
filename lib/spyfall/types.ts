// Shared contract for "Where Are We?" (Spyfall-style). Engine (lib/spyfall), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";

export type SpyTimer = 4 | 6 | 8; // minutes

export interface SpyPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export type SpyPhase =
  | "lobby" // host picks timer, needs >= 3 players
  | "questions" // cards dealt, players ask each other questions; spy may guess, host may start voting
  | "voting" // everyone votes for another player; resolves when every connected player has voted
  | "gameOver";

export type SpyOutcome =
  | "guessRight" // spy named the location
  | "guessWrong" // spy guessed and missed
  | "caught" // strict majority voted for the spy
  | "missed" // majority on an innocent, or no majority
  | "spyLeft" // spy left mid-game
  | "tooFew"; // players left until fewer than MIN remained

export interface SpyResult {
  winner: "spy" | "faithful";
  outcome: SpyOutcome;
  guess: string | null; // the spy's location guess, if any
  tally: Record<string, number>; // targetId -> votes (empty unless voting resolved)
  accusedId: string | null; // strict-majority target, if any
}

export interface SpyState {
  phase: SpyPhase;
  players: SpyPlayer[];
  timerMin: SpyTimer; // lobby setting
  location: string | null; // REDACTED to null for the spy (and everyone in lobby) until gameOver
  roles: Record<string, string>; // playerId -> role. REDACTED to only the viewer's own role until gameOver (spy has none)
  spyId: string | null; // REDACTED to null for everyone except the spy until gameOver
  firstAskerId: string | null;
  deadline: number | null; // server ms when questions or voting end
  votes: Record<string, string>; // voterId -> targetId. REDACTED during voting to only the viewer's own vote
  votedIds: string[]; // who has voted (always visible)
  result: SpyResult | null;
  seq: number;
}

export type SpyIntent =
  | { type: "setTimer"; minutes: SpyTimer } // host, lobby
  | { type: "start" } // host, lobby -> questions (>= 3 players)
  | { type: "guess"; location: string } // spy only, questions: a LOCATIONS name; ends the game
  | { type: "startVoting" } // host, questions -> voting (server also does this at serverDeadline via onDeadline)
  | { type: "vote"; targetId: string } // any player, voting; changeable until all connected players voted
  | { type: "playAgain" }; // host, gameOver -> lobby (players + timer kept)

export interface SpyLocation {
  name: string;
  emoji: string;
  roles: string[]; // >= 6, family friendly
}

export interface SpyConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: SpyState; // redacted for you
  deadlineAt?: number; // local ms when questions or voting end
  error: string | null;
  send: (intent: SpyIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
