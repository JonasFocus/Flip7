import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "../engine/types.ts";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

// What every virtual-table screen consumes. Implemented by useRoom (online, Railway)
// and useLocalGame (solo vs bots, fully on-device), so the UI never knows which.
export interface TableConnection {
  kind: "online" | "local";
  code: string | null; // room code, null for local
  status: ConnectionStatus;
  you: string; // your player id
  hostId: string;
  isHost: boolean;
  game: GameState;
  events: GameEvent[]; // events from the latest change, for animation
  autoPlay?: { playerId: string; deadline: number }; // awaited player is offline; server plays for them at `deadline` (local ms)
  nextRoundAt?: number; // roundOver: the next round deals itself at this local ms time
  error: string | null;
  send: (intent: Intent) => void;
  addBot: () => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}

export interface ScoreConnection {
  code: string;
  status: ConnectionStatus;
  you: string; // client id; ScorePlayer.ownerId === you means you control that seat
  hostId: string;
  isHost: boolean;
  game: ScoreState;
  error: string | null;
  send: (intent: ScoreIntent) => void;
  leave: () => void;
}
