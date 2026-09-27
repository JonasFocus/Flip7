// Shared contract for the Flip 7 engine. Server (Railway), local bot games,
// and every UI screen import from here. Keep it free of runtime deps.

export type Card = { id: string } & (
  | { kind: "number"; value: number } // 0..12
  | { kind: "plus"; value: 2 | 4 | 6 | 8 | 10 }
  | { kind: "x2" }
  | { kind: "freeze" }
  | { kind: "flipThree" }
  | { kind: "secondChance" }
);

export type ActionCard = Extract<Card, { kind: "freeze" | "flipThree" | "secondChance" }>;

export type PlayerStatus = "waiting" | "active" | "stayed" | "frozen" | "busted" | "flip7";

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  total: number; // banked score across rounds
  hand: Card[]; // cards in front of the player this round (numbers, modifiers, held second chance)
  status: PlayerStatus;
  roundHistory: number[]; // score per completed round
}

export type Pending =
  // `playerId` drew an action card and must pick a target among `options`.
  | { type: "chooseTarget"; playerId: string; card: ActionCard; options: string[] }
  // `targetId` is mid Flip Three: `remaining` cards still to draw; actions drawn meanwhile resolve after.
  | { type: "flipThree"; sourceId: string; targetId: string; remaining: number; queued: ActionCard[] };

export type GameEvent =
  | { type: "deal"; playerId: string; card: Card }
  | { type: "draw"; playerId: string; card: Card }
  | { type: "bust"; playerId: string; card: Card }
  | { type: "secondChanceUsed"; playerId: string; card: Card } // `card` is the discarded duplicate
  | { type: "secondChancePassed"; fromId: string; toId: string }
  | { type: "stay"; playerId: string; points: number; auto?: true } // auto: the server stayed for an absent human
  | { type: "freeze"; sourceId: string; targetId: string; points: number }
  | { type: "flipThree"; sourceId: string; targetId: string }
  | { type: "flip7"; playerId: string }
  | { type: "discarded"; playerId: string; card: Card } // action card with no legal use (no receiver, or its holder busted/froze before it resolved)
  | { type: "reshuffle" }
  | { type: "roundEnd"; round: number; scores: Record<string, number> }
  | { type: "gameOver"; winnerIds: string[] };

export type Phase = "lobby" | "playing" | "roundOver" | "gameOver";

export interface GameState {
  phase: Phase;
  round: number; // 1-based once play starts, 0 in lobby
  goal: number; // 200
  players: Player[]; // seat order
  dealerIndex: number;
  // Index into players of whose move it is. During the opening deal this is the
  // player about to receive a card; afterwards the player deciding hit/stay.
  turnIndex: number;
  dealing: boolean; // true while the opening one-card-each deal is running
  deck: Card[]; // top = last element. Redacted to [] for clients.
  deckCount: number;
  discard: Card[];
  pending: Pending | null;
  // Action cards waiting to be resolved by `playerId` once the current pending clears
  // (e.g. Freeze/Flip Three queued during a Flip Three, possibly nested). A Second Chance here is always a
  // spare to pass on: it was drawn during Flip Three while `playerId` already held one.
  actionQueue: { playerId: string; card: ActionCard }[];
  seq: number; // increments on every applied intent
  lastEvents: GameEvent[]; // events produced by the most recent applied intent
}

export type Intent =
  | { type: "ready"; ready: boolean }
  | { type: "start" } // host only, lobby → first round
  | { type: "hit" }
  | { type: "stay" }
  | { type: "chooseTarget"; targetId: string }
  | { type: "nextRound" } // host only, roundOver → next round
  | { type: "playAgain" }; // host only, gameOver → lobby with totals reset

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

export interface HandScore {
  numberSum: number;
  doubled: boolean;
  plus: number;
  flip7Bonus: number; // 15 when 7 unique numbers
  total: number; // (numberSum * (doubled ? 2 : 1)) + plus + flip7Bonus; 0 if busted
}

// ---- Physical-card scorekeeper (one shared scoreboard, real cards on the table) ----

export interface PhysicalEntry {
  numbers: number[]; // unique 0..12
  x2: boolean;
  plus: number[]; // subset of [2,4,6,8,10]
  busted: boolean;
}

export interface ScorePlayer {
  id: string;
  name: string;
  ownerId: string; // the phone/client that controls this seat (host can control all)
  total: number;
  rounds: (number | null)[]; // null = not recorded (e.g. joined mid-game)
}

export interface ScoreState {
  phase: "lobby" | "playing" | "gameOver";
  goal: number;
  round: number;
  players: ScorePlayer[];
  entries: Record<string, PhysicalEntry | null>; // current round, keyed by ScorePlayer.id
  entryHistory: Record<string, PhysicalEntry | null>[]; // hands of each finished round, oldest first; undoRound pops one
  winnerIds: string[];
}

export type ScoreIntent =
  | { type: "addSeat"; name: string } // someone sharing this phone
  | { type: "removeSeat"; seatId: string }
  | { type: "start" }
  | { type: "submitEntry"; seatId: string; entry: PhysicalEntry; round: number } // round guards stale submits
  | { type: "clearEntry"; seatId: string }
  | { type: "finishRound"; round: number } // host only; round = the round being finished
  | { type: "undoRound"; round: number } // host only; round = the round being undone (rounds recorded so far)
  | { type: "setGoal"; goal: number } // host only; mid-game only above the current top total
  | { type: "playAgain" };
