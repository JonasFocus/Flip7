"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyIntent, awaitingPlayerId, chooseBotIntent, removePlayer as removeFromGame } from "../engine/index.ts";
import type { Intent } from "../engine/types.ts";
import { botDelay, LOCAL_ME, loadLocal, newLocalGame, saveLocal, withBot, type LocalSave } from "./local.ts";
import type { TableConnection } from "./types.ts";
import { useFlashError } from "./useRoom.ts";

// Client-only: mount after hydration (NameGate does) so the saved game can be restored synchronously.
// ponytail: `name` is read once at start.
export function useLocalGame(name: string, botCount = 2): TableConnection {
  const [local, setLocal] = useState<LocalSave>(() => {
    const saved = loadLocal();
    return saved ? { game: saved.game, events: [] } : { game: newLocalGame(name, botCount), events: [] };
  });
  const ref = useRef(local);
  const [error, flash] = useFlashError();

  const commit = useCallback((next: LocalSave, persist = true) => {
    ref.current = next;
    setLocal(next);
    if (persist) saveLocal(next);
  }, []);

  const apply = useCallback(
    (actorId: string, intent: Intent) => {
      const result = applyIntent(ref.current.game, actorId, intent, { isHost: actorId === LOCAL_ME });
      if (result.ok) commit({ game: result.state, events: result.events });
      else if (actorId === LOCAL_ME) flash(result.error);
      else console.error(`Bot ${actorId} intent rejected: ${result.error}`, intent);
    },
    [commit, flash],
  );

  useEffect(() => {
    const game = local.game;
    const id = awaitingPlayerId(game);
    if (!id || !game.players.some((p) => p.id === id && p.isBot)) return;
    const timer = setTimeout(() => {
      const intent = chooseBotIntent(ref.current.game, id);
      if (intent) apply(id, intent);
    }, botDelay(game));
    return () => clearTimeout(timer);
  }, [local.game, apply]);

  const send = useCallback((intent: Intent) => apply(LOCAL_ME, intent), [apply]);
  const addBot = useCallback(() => {
    const game = ref.current.game;
    if (game.phase === "lobby") commit({ game: withBot(game), events: [] });
  }, [commit]);
  const removePlayer = useCallback(
    (playerId: string) => {
      const game = ref.current.game;
      if (game.phase === "lobby" && playerId !== LOCAL_ME) commit({ game: removeFromGame(game, playerId), events: [] });
    },
    [commit],
  );
  const leave = useCallback(() => {
    saveLocal(null);
    const me = ref.current.game.players.find((p) => p.id === LOCAL_ME);
    commit({ game: newLocalGame(me?.name ?? name, botCount), events: [] }, false);
  }, [commit, name, botCount]);

  return useMemo(
    () => ({
      kind: "local",
      code: null,
      status: "open",
      you: LOCAL_ME,
      hostId: LOCAL_ME,
      isHost: true,
      game: local.game,
      events: local.events,
      error,
      send,
      addBot,
      removePlayer,
      leave,
    }),
    [local, error, send, addBot, removePlayer, leave],
  );
}
