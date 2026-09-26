"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createGame, createScoreGame } from "../engine/index.ts";
import type { GameEvent, GameState, Intent, ScoreIntent, ScoreState } from "../engine/types.ts";
import type { ClientMessage, Room } from "../protocol.ts";
import { getClientId } from "./identity.ts";
import { parseServerMessage, wsUrl } from "./rooms.ts";
import type { ConnectionStatus, ScoreConnection, TableConnection } from "./types.ts";

const PING_MS = 20_000;
const STALE_MS = 45_000;
const MAX_BACKOFF_MS = 15_000;
const ERROR_MS = 4_000;

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

interface Snapshot {
  code: string;
  room: Room;
  you: string;
  events: GameEvent[];
}

interface RoomCore {
  code: string;
  status: ConnectionStatus;
  room: Room | null;
  you: string;
  hostId: string;
  isHost: boolean;
  events: GameEvent[];
  error: string | null;
  send: (intent: Intent) => void;
  sendScore: (intent: ScoreIntent) => void;
  addBot: () => void;
  removePlayer: (playerId: string) => void;
  leave: () => void;
}

function useRoomSocket(code: string, name: string): RoomCore {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  // An error before the server accepted our join (room gone, full, started) is fatal: stop retrying.
  const [fatal, setFatal] = useState<{ code: string; message: string } | null>(null);
  const [flashError, flash] = useFlashError();
  const wsRef = useRef<WebSocket | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let lastSeen = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      stopped = true;
      clearTimeout(retryTimer);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
    stopRef.current = stop;

    const scheduleReconnect = () => {
      if (stopped) return;
      setStatus("reconnecting");
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    const drop = () => {
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
        stop();
        setFatal({ code, message: "Could not reach the game server" });
        setStatus("closed");
        return;
      }
      wsRef.current = ws;
      let joined = false;

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
        if (msg?.t === "room") {
          if (!joined) {
            joined = true;
            attempt = 0;
            setStatus("open");
          }
          setSnapshot({ code, room: msg.room, you: msg.you, events: msg.events });
        } else if (msg?.t === "error") {
          if (joined) {
            flash(msg.message);
          } else {
            stop();
            setFatal({ code, message: msg.message });
            setStatus("closed");
          }
        }
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        scheduleReconnect();
      };
    };

    const pingTimer = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastSeen > STALE_MS) drop();
      else ws.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
    }, PING_MS);

    // Phones suspend sockets in the background; come back fast instead of waiting out the backoff.
    const wake = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.CONNECTING) return;
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastSeen > PING_MS + 10_000) drop();
        return;
      }
      attempt = 0;
      connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    connect();
    return () => {
      stop();
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
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
  const addBot = useCallback(() => sendMessage({ t: "addBot" }), [sendMessage]);
  const removePlayer = useCallback((playerId: string) => sendMessage({ t: "removePlayer", playerId }), [sendMessage]);
  const leave = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "leave" } satisfies ClientMessage));
    stopRef.current();
    setStatus("closed");
  }, []);

  const current = snapshot?.code === code ? snapshot : null;
  const fatalMessage = fatal?.code === code ? fatal.message : null;
  return useMemo(
    () => ({
      code,
      status: fatalMessage ? "closed" : status,
      room: current?.room ?? null,
      you: current?.you ?? "",
      hostId: current?.room.hostId ?? "",
      isHost: current !== null && current.room.hostId === current.you,
      events: current?.events ?? [],
      error: fatalMessage ?? flashError,
      send,
      sendScore,
      addBot,
      removePlayer,
      leave,
    }),
    [code, status, current, fatalMessage, flashError, send, sendScore, addBot, removePlayer, leave],
  );
}

function tableOf(c: RoomCore, game: GameState): TableConnection {
  return {
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
    isHost: c.isHost,
    game,
    error: c.error,
    send: c.sendScore,
    leave: c.leave,
  };
}

export interface RoomConnection {
  status: ConnectionStatus;
  error: string | null; // with status "closed" and no table/score: couldn't join (show it, offer home)
  table: TableConnection | null; // set once a virtual room snapshot arrived
  score: ScoreConnection | null; // set once a physical room snapshot arrived
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
