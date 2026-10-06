"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createGame, createScoreGame } from "../engine/index.ts";
import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "../engine/types.ts";
import { createImposterGame } from "../imposter/index.ts";
import type { ImposterIntent, ImposterState } from "../imposter/types.ts";
import type { DiceIntent } from "../liarsdice/types.ts";
import type { PotatoIntent } from "../hotpotato/types.ts";
import type { SpyIntent } from "../spyfall/types.ts";
import type { BjIntent } from "../blackjack/types.ts";
import type { DuelIntent } from "../bjduel/types.ts";
import type { BacIntent } from "../baccarat/types.ts";
import type { RlIntent } from "../roulette/types.ts";
import type { TxIntent } from "../texasholdem/types.ts";
import { KICKED_MESSAGE, REPLACED_CLOSE_CODE, REPLACED_MESSAGE, type ClientMessage, type PartyMode, type PartyRoom, type Room } from "../protocol.ts";
import { clearLastRoom, getClientId, setLastRoom } from "./identity.ts";
import { parseServerMessage, wsUrl } from "./rooms.ts";
import type {
  ConnectionStatus,
  DiceConnection,
  ImposterConnection,
  PotatoConnection,
  ScoreConnection,
  SpyConnection,
  BjConnection,
  DuelConnection,
  BacConnection,
  RlConnection,
  TxConnection,
  TableConnection,
} from "./types.ts";

const PING_MS = 20_000;
const PONG_WAIT_MS = 10_000; // measured from the ping, so throttled background timers can't fake staleness
const WAKE_CHECK_MS = 5_000;
const MAX_BACKOFF_MS = 15_000;
const ERROR_MS = 4_000;
const OPEN_TIMEOUT_MS = 8_000; // a mobile SYN can hang for a minute; give up and retry sooner
const STALE_CONNECT_MS = 5_000;
const LEAVE_TIMEOUT_MS = 5_000;
const UNREACHABLE_AFTER = 4; // failed attempts (~8s of backoff) before the first join

export function useFlashError(ms = ERROR_MS) {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(
    (message: string) => {
      setError(message);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setError(null), ms);
    },
    [ms],
  );
  return [error, flash] as const;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Lets reconnect indicators say "Offline" when the device itself has no network.
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

interface Snapshot {
  code: string;
  room: Room;
  you: string;
  events: GameEvent[];
  receivedAt: number;
}

// Set while we keep failing to reach the server before ever joining; retries continue.
export type Unreachable = "offline" | "server" | null;

interface RoomCore {
  code: string;
  status: ConnectionStatus;
  room: Room | null;
  you: string;
  hostId: string;
  isHost: boolean;
  events: GameEvent[];
  receivedAt: number;
  error: string | null;
  hadRoom: boolean; // with a fatal error: we had a live snapshot of this room before it failed
  unreachable: Unreachable;
  send: (intent: Intent) => void;
  sendScore: (intent: ScoreIntent) => void;
  sendImposter: (intent: ImposterIntent) => void;
  sendDice: (intent: DiceIntent) => void;
  sendPotato: (intent: PotatoIntent) => void;
  sendSpy: (intent: SpyIntent) => void;
  sendBj: (intent: BjIntent) => void;
  sendDuel: (intent: DuelIntent) => void;
  sendBac: (intent: BacIntent) => void;
  sendRl: (intent: RlIntent) => void;
  sendTx: (intent: TxIntent) => void;
  addBot: () => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}

function useRoomSocket(code: string, name: string): RoomCore {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // An error before the server accepted our join (room gone, full, started) is fatal: stop retrying.
  const [fatal, setFatal] = useState<{ code: string; message: string; hadRoom: boolean } | null>(null);
  const [unreachable, setUnreachable] = useState<{ code: string; why: Exclude<Unreachable, null> } | null>(null);
  const [flashError, flash] = useFlashError();
  const wsRef = useRef<WebSocket | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const seatedRef = useRef(false); // the server holds a seat for us (joined, not failed)
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let lastSeen = 0;
    let pingSentAt = 0;
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;
    let hadRoom = false;
    let failures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let connectStartedAt = 0;

    const stop = () => {
      stopped = true;
      seatedRef.current = false;
      clearTimeout(retryTimer);
      clearTimeout(openTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
    stopRef.current = stop;

    const fail = (message: string) => {
      stop();
      setFatal({ code, message, hadRoom });
      setStatus("closed");
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      setStatus(hadRoom ? "reconnecting" : "connecting");
      if (!hadRoom && ++failures >= UNREACHABLE_AFTER) setUnreachable({ code, why: navigator.onLine ? "server" : "offline" });
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    const drop = () => {
      clearTimeout(openTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      scheduleReconnect();
    };

    const connect = () => {
      clearTimeout(retryTimer);
      if (stopped) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl());
      } catch {
        fail("Could not reach the game server");
        return;
      }
      wsRef.current = ws;
      connectStartedAt = Date.now();
      let joined = false;
      clearTimeout(openTimer);
      openTimer = setTimeout(() => {
        if (wsRef.current === ws && !joined) drop();
      }, OPEN_TIMEOUT_MS);

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        lastSeen = Date.now();
        const msg: ClientMessage = { t: "join", code, name: nameRef.current.trim(), clientId: getClientId() };
        ws.send(JSON.stringify(msg));
      };
      ws.onmessage = (e) => {
        if (wsRef.current !== ws) return;
        lastSeen = Date.now();
        const msg = parseServerMessage(e.data);
        if (msg?.t === "room" || msg?.t === "error") clearTimeout(openTimer);
        if (msg?.t === "room") {
          if (!joined) {
            joined = true;
            hadRoom = true;
            seatedRef.current = true;
            attempt = 0;
            setStatus("open");
            setUnreachable(null);
            setLastRoom(code);
          }
          setSnapshot({ code, room: msg.room, you: msg.you, events: msg.events, receivedAt: Date.now() });
        } else if (msg?.t === "error") {
          // The server keeps the socket open after a kick but no longer counts us in the room.
          if (!joined || msg.message === KICKED_MESSAGE) {
            clearLastRoom(code);
            fail(msg.message);
          } else flash(msg.message);
        }
      };
      ws.onclose = (e) => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        // Rejoining would kick the other tab, which would kick us back, forever.
        if (e.code === REPLACED_CLOSE_CODE) fail(REPLACED_MESSAGE);
        else scheduleReconnect();
      };
    };

    const ping = (ws: WebSocket) => {
      pingSentAt = Date.now();
      ws.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
    };

    const pingTimer = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (pingSentAt > lastSeen && Date.now() - pingSentAt > PONG_WAIT_MS) drop();
      else ping(ws);
    }, PING_MS);

    // Phones suspend sockets in the background; come back fast instead of waiting out the backoff.
    const wake = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.CONNECTING) {
        if (Date.now() - connectStartedAt < STALE_CONNECT_MS) return;
        wsRef.current = null;
        ws.close();
      }
      if (ws?.readyState === WebSocket.OPEN) {
        // Probe instead of trusting lastSeen: a quiet room plus throttled timers makes a healthy socket look old.
        ping(ws);
        clearTimeout(wakeTimer);
        wakeTimer = setTimeout(() => {
          if (wsRef.current === ws && lastSeen < pingSentAt) drop();
        }, WAKE_CHECK_MS);
        return;
      }
      attempt = 0;
      connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    // A dead network often leaves the socket OPEN until the stale check; drop now so taps say "Reconnecting…".
    const offline = () => {
      if (!stopped) drop();
    };
    window.addEventListener("offline", offline);

    connect();
    return () => {
      stop();
      clearInterval(pingTimer);
      clearTimeout(wakeTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
    };
  }, [code, flash]);

  const sendMessage = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      else flash("Reconnecting…");
    },
    [flash],
  );
  const send = useCallback((intent: Intent) => sendMessage({ t: "intent", intent }), [sendMessage]);
  const sendScore = useCallback((intent: ScoreIntent) => sendMessage({ t: "score", intent }), [sendMessage]);
  const sendImposter = useCallback((intent: ImposterIntent) => sendMessage({ t: "imposter", intent }), [sendMessage]);
  const sendDice = useCallback((intent: DiceIntent) => sendMessage({ t: "liarsdice", intent }), [sendMessage]);
  const sendPotato = useCallback((intent: PotatoIntent) => sendMessage({ t: "hotpotato", intent }), [sendMessage]);
  const sendSpy = useCallback((intent: SpyIntent) => sendMessage({ t: "spyfall", intent }), [sendMessage]);
  const sendBj = useCallback((intent: BjIntent) => sendMessage({ t: "blackjack", intent }), [sendMessage]);
  const sendDuel = useCallback((intent: DuelIntent) => sendMessage({ t: "bjduel", intent }), [sendMessage]);
  const sendBac = useCallback((intent: BacIntent) => sendMessage({ t: "baccarat", intent }), [sendMessage]);
  const sendRl = useCallback((intent: RlIntent) => sendMessage({ t: "roulette", intent }), [sendMessage]);
  const sendTx = useCallback((intent: TxIntent) => sendMessage({ t: "texasholdem", intent }), [sendMessage]);
  const addBot = useCallback(() => sendMessage({ t: "addBot" }), [sendMessage]);
  const removePlayer = useCallback((playerId: string) => sendMessage({ t: "removePlayer", playerId }), [sendMessage]);
  const leave = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "leave" } satisfies ClientMessage));
    else if (seatedRef.current) leaveOnFreshSocket(code, nameRef.current.trim());
    stopRef.current();
    clearLastRoom();
    setStatus("closed");
  }, [code]);

  const current = snapshot?.code === code ? snapshot : null;
  const fatalMessage = fatal?.code === code ? fatal.message : null;
  const hadRoom = fatal?.code === code && fatal.hadRoom;
  const unreachableWhy = unreachable?.code === code && !fatalMessage ? unreachable.why : null;
  return useMemo(
    () => ({
      code,
      status: fatalMessage ? "closed" : status,
      room: current?.room ?? null,
      you: current?.you ?? "",
      hostId: current?.room.hostId ?? "",
      isHost: current !== null && current.room.hostId === current.you,
      events: current?.events ?? [],
      receivedAt: current?.receivedAt ?? 0,
      error: fatalMessage ?? flashError,
      hadRoom,
      unreachable: unreachableWhy,
      send,
      sendScore,
      sendImposter,
      sendDice,
      sendPotato,
      sendSpy,
      sendBj,
      sendDuel,
      sendBac,
      sendRl,
      sendTx,
      addBot,
      removePlayer,
      leave,
    }),
    [code, status, current, fatalMessage, hadRoom, unreachableWhy, flashError, send, sendScore, sendImposter, sendDice, sendPotato, sendSpy, sendBj, sendDuel, sendBac, sendRl, sendTx, addBot, removePlayer, leave],
  );
}

// Without this the server keeps our seat as "disconnected" and auto-plays it for the rest of the game.
function leaveOnFreshSocket(code: string, name: string) {
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    return;
  }
  const timer = setTimeout(() => ws.close(), LEAVE_TIMEOUT_MS);
  ws.onopen = () => {
    const join: ClientMessage = { t: "join", code, name, clientId: getClientId() };
    ws.send(JSON.stringify(join));
    ws.send(JSON.stringify({ t: "leave" } satisfies ClientMessage));
  };
  // Messages are handled in order, so the leave is already queued behind the join's reply.
  ws.onmessage = () => {
    clearTimeout(timer);
    ws.close();
  };
}

function tableOf(c: RoomCore, game: GameState): TableConnection {
  const auto = c.room?.mode === "virtual" ? c.room.autoPlay : undefined;
  const nextIn = c.room?.mode === "virtual" ? c.room.nextRoundInMs : undefined;
  return {
    autoPlay: auto ? { playerId: auto.playerId, deadline: c.receivedAt + auto.inMs } : undefined,
    nextRoundAt: typeof nextIn === "number" ? c.receivedAt + nextIn : undefined,
    kind: "online",
    code: c.code,
    status: c.status,
    you: c.you,
    hostId: c.hostId,
    isHost: c.isHost,
    game,
    events: c.events,
    error: c.error,
    send: c.send,
    addBot: c.addBot,
    removePlayer: c.removePlayer,
    leave: c.leave,
  };
}

function scoreOf(c: RoomCore, game: ScoreState): ScoreConnection {
  return {
    code: c.code,
    status: c.status,
    you: c.you,
    hostId: c.hostId,
    isHost: c.isHost,
    game,
    error: c.error,
    send: c.sendScore,
    leave: c.leave,
  };
}

function imposterOf(c: RoomCore, game: ImposterState): ImposterConnection {
  const endsIn = c.room?.mode === "imposter" ? c.room.cluesEndsInMs : undefined;
  return {
    code: c.code,
    status: c.status,
    you: c.you,
    hostId: c.hostId,
    isHost: c.isHost,
    game,
    votingEndsAt: c.room?.mode === "imposter" && typeof c.room.votingEndsInMs === "number"
      ? c.receivedAt + c.room.votingEndsInMs : undefined,
    cluesEndsAt: typeof endsIn === "number" ? c.receivedAt + endsIn : undefined,
    error: c.error,
    send: c.sendImposter,
    removePlayer: c.removePlayer,
    leave: c.leave,
  };
}

// Shared by the party games; only `game` and `send` differ per mode.
function partyOf<M extends PartyMode, I>(c: RoomCore, room: PartyRoom<M>, send: (intent: I) => void) {
  return {
    code: c.code,
    status: c.status,
    you: c.you,
    hostId: c.hostId,
    isHost: c.isHost,
    game: room.game,
    deadlineAt: typeof room.deadlineInMs === "number" ? c.receivedAt + room.deadlineInMs : undefined,
    error: c.error,
    send,
    removePlayer: c.removePlayer,
    leave: c.leave,
  };
}

export interface RoomConnection {
  status: ConnectionStatus;
  error: string | null; // with status "closed" and no table/score: couldn't join (show it, offer home)
  table: TableConnection | null; // set once a virtual room snapshot arrived
  score: ScoreConnection | null; // set once a physical room snapshot arrived
  imposter: ImposterConnection | null; // set once an imposter room snapshot arrived
  dice: DiceConnection | null;
  potato: PotatoConnection | null;
  spy: SpyConnection | null;
  bj: BjConnection | null;
  duel: DuelConnection | null;
  bac: BacConnection | null;
  rl: RlConnection | null;
  tx: TxConnection | null;
  hadRoom: boolean;
  unreachable: Unreachable;
  leave: () => void;
}

// For /room/[code], where the mode is only known after the first snapshot.
export function useRoom(code: string, name: string): RoomConnection {
  const c = useRoomSocket(code, name);
  return useMemo(() => {
    const room = c.room;
    return {
      status: c.status,
      error: c.error,
      table: room?.mode === "virtual" ? tableOf(c, room.game) : null,
      score: room?.mode === "physical" ? scoreOf(c, room.game) : null,
      imposter: room?.mode === "imposter" ? imposterOf(c, room.game) : null,
      dice: room?.mode === "liarsdice" ? partyOf(c, room, c.sendDice) : null,
      potato: room?.mode === "hotpotato" ? partyOf(c, room, c.sendPotato) : null,
      spy: room?.mode === "spyfall" ? partyOf(c, room, c.sendSpy) : null,
      bj: room?.mode === "blackjack" ? partyOf(c, room, c.sendBj) : null,
      duel: room?.mode === "bjduel" ? partyOf(c, room, c.sendDuel) : null,
      bac: room?.mode === "baccarat" ? partyOf(c, room, c.sendBac) : null,
      rl: room?.mode === "roulette" ? partyOf(c, room, c.sendRl) : null,
      tx: room?.mode === "texasholdem" ? partyOf(c, room, c.sendTx) : null,
      hadRoom: c.hadRoom,
      unreachable: c.unreachable,
      leave: c.leave,
    };
  }, [c]);
}

// Before the first snapshot `game` is an empty placeholder (no players); gate on game.players.length.
export function useVirtualRoom(code: string, name: string): TableConnection {
  const c = useRoomSocket(code, name);
  const [empty] = useState(() => createGame());
  const game = c.room?.mode === "virtual" ? c.room.game : empty;
  return useMemo(() => tableOf(c, game), [c, game]);
}

export function useScoreRoom(code: string, name: string): ScoreConnection {
  const c = useRoomSocket(code, name);
  const [empty] = useState(() => createScoreGame());
  const game = c.room?.mode === "physical" ? c.room.game : empty;
  return useMemo(() => scoreOf(c, game), [c, game]);
}

export function useImposterRoom(code: string, name: string): ImposterConnection {
  const c = useRoomSocket(code, name);
  const [empty] = useState(() => createImposterGame());
  const game = c.room?.mode === "imposter" ? c.room.game : empty;
  return useMemo(() => imposterOf(c, game), [c, game]);
}
