import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "../engine/types.ts";
import type { ImposterIntent, ImposterState } from "../imposter/types.ts";

// The party games define their own connection shapes next to their state.
export type { DiceConnection } from "../liarsdice/types.ts";
export type { PotatoConnection } from "../hotpotato/types.ts";
export type { SpyConnection } from "../spyfall/types.ts";
export type { BjConnection } from "../blackjack/types.ts";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

// What every virtual-table screen consumes. Implemented by useRoom (online, Railway)
//.
export interface TableConnection {
  kind: "online";
  code: string | null;
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

export interface ImposterConnection {
  code: string;
  status: ConnectionStatus;
  you: string; // your player id (client id)
  hostId: string;
  isHost: boolean;
  game: ImposterState; // already redacted for you
  votingEndsAt?: number;
  cluesEndsAt?: number; // clues phase: local ms time voting auto-starts
  error: string | null;
  send: (intent: ImposterIntent) => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}
