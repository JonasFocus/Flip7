// Shared contract for Hot Potato. Engine (lib/hotpotato), server and UI import from here.
import type { ConnectionStatus } from "../client/types.ts";

export type PotatoLives = 1 | 2 | 3 | 5;

export interface PotatoPlayer {
  id: string;
  name: string;
  connected: boolean;
  lives: number; // 0 = out
}

export type PotatoPhase =
  | "lobby" // host picks lives + category, needs >= 3 players
  | "playing" // bomb is live; holder says a word and passes
  | "boom" // fuse went off; next round starts itself at nextRoundAt
  | "gameOver";

export interface PotatoBoom {
  playerId: string;
  category: string; // the prompt they blew up on
}

export interface PotatoState {
  phase: PotatoPhase;
  players: PotatoPlayer[]; // seat order = pass order
  startLives: PotatoLives;
  categoryId: string; // lobby setting: a POTATO_CATEGORIES id or "random" (new prompt every round)
  round: number; // 0 in lobby
  category: string | null; // current prompt
  holderId: string | null;
  heldSince: number | null; // server ms the holder got the bomb (800ms pass cooldown, 5s offline auto-pass)
  fuseAt: number | null; // SECRET server ms the bomb explodes; redacted to null for everyone
  nextRoundAt: number | null; // boom: server ms the next round starts
  starterId: string | null; // boom: who gets the bomb next round
  lastBoom: PotatoBoom | null;
  winnerId: string | null;
  seq: number;
}

export type PotatoIntent =
  | { type: "setLives"; lives: PotatoLives } // host, lobby
  | { type: "setCategory"; categoryId: string } // host, lobby
  | { type: "start" } // host, lobby -> playing (>= 3 players)
  | { type: "pass" } // holder, playing, after holding >= 800ms
  | { type: "playAgain" }; // host, gameOver -> lobby (players + settings kept)

export interface PotatoCategory {
  id: string;
  prompt: string;
}

export interface PotatoConnection {
  code: string;
  status: ConnectionStatus;
  you: string;
  hostId: string;
  isHost: boolean;
  game: PotatoState; // already redacted for you
  deadlineAt?: number; // boom: local ms the next round starts
  error: string | null;
  send: (intent: PotatoIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
