"use client";

import { useEffect, useState } from "react";
import type { GameState, Intent, Player } from "@/lib/engine/types";
import { tap } from "@/lib/client/haptics";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { firstName, roundScore } from "./hand";
import type { Beat } from "./useReveal";

function Waiting({ player, seat, text, alert = false, dots = !alert }: { player?: Player; seat?: number; text: string; alert?: boolean; dots?: boolean }) {
  return (
    <div className="flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-surface-2/60 px-4 text-muted">
      {player && <Avatar id={player.id} seat={seat} name={player.name} isBot={player.isBot} size="sm" className="ring-2 ring-accent" />}
      <span className={alert ? "font-semibold text-balance text-fg tabular-nums" : "truncate font-semibold"}>
        {text}
      </span>
      <span className={dots ? "flex gap-1" : "hidden"} aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 motion-safe:animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </span>
    </div>
  );
}

export function useSecondsLeft(deadline: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === undefined) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [deadline]);
  return deadline === undefined ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export const IDLE_WARN_S = 15;

export function ActionBar({
  game,
  you,
  awaitingId,
  caughtUp,
  beat,
  send,
  autoPlay,
}: {
  game: GameState;
  you: string;
  awaitingId: string | null; // live: who the game waits on
  caughtUp: boolean; // reveal queue drained; only then can you act
  beat: Beat; // what the reveal queue is showing while it hasn't caught up
  send: (intent: Intent) => void;
  autoPlay?: { playerId: string; deadline: number; idle?: boolean };
}) {
  const secondsLeft = useSecondsLeft(caughtUp && autoPlay && autoPlay.playerId === awaitingId ? autoPlay.deadline : undefined);
  // An idle (still connected) player only sees the clock near the end, so a normal think never feels rushed.
  const idleLeft = autoPlay?.idle && secondsLeft !== null && secondsLeft <= IDLE_WARN_S ? secondsLeft : null;
  const me = game.players.find((p) => p.id === you);
  const pending = game.pending;
  // One intent per snapshot: a double tap would otherwise reach the server after the turn has passed.
  // Keyed on the snapshot object, not seq, so a resent snapshot (reconnect) unlocks a send that never left.
  const [sentFor, setSentFor] = useState<GameState | null>(null);
  const act = (intent: Intent) => {
    if (sentFor === game) return;
    setSentFor(game);
    tap();
    send(intent);
  };
  const hit = () => act({ type: "hit" });

  // RoundSummary / GameOver overlays own the host's continue buttons. An end state, not a wait: no dots.
  if (game.phase !== "playing") return <Waiting text={game.phase === "gameOver" ? "Game over" : "Round over"} alert />;

  // Live state (pending, awaiting) runs ahead of the cards still being revealed; describe the beat on stage instead.
  if (!caughtUp) {
    if (beat.dealing) return <Waiting text="Dealing" />;
    const shown = game.players.find((p) => p.id === beat.actor);
    if (!shown) return <Waiting text="Waiting" />;
    // The stage caption and pill already say what happened; the bar only says whose turn the beat belongs to.
    if (shown.id === you) return <Waiting text="Your turn" dots={false} />;
    return <Waiting player={shown} seat={game.players.indexOf(shown)} text={`${firstName(shown.name)}’s turn`} dots={false} />;
  }

  if (awaitingId === you && me) {
    const hurry = idleLeft !== null && (
      <p role="status" className="-mt-1 text-center text-sm font-semibold text-accent tabular-nums">
        {pending?.type === "flipThree" ? "Auto-flipping" : "Auto-staying"} in {idleLeft}s
      </p>
    );
    if (pending?.type === "flipThree") {
      return (
        <div className="flex flex-col gap-3">
          {hurry}
          <Button size="lg" block onClick={hit} className="animate-pop">
            Flip · {pending.remaining} left
          </Button>
        </div>
      );
    }
    if (pending?.type === "chooseTarget") return <Waiting text="Pick a target" />;
    const points = roundScore(me).total;
    return (
      <div className="flex flex-col gap-3">
        {hurry}
        <div className="flex gap-3">
          <Button size="lg" onClick={hit} className="flex-[1.4] text-2xl">
            Hit
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => act({ type: "stay" })}
            className="flex-1"
          >
            <span className="flex flex-col items-center gap-1 leading-none">
              <span className="text-xl">Stay</span>
              <span className="font-sans text-xs font-bold tracking-normal text-muted normal-case tabular-nums">+{points} pts</span>
            </span>
          </Button>
        </div>
      </div>
    );
  }

  // Name the pending's own actor: the chooser picks, the Flip Three target flips.
  const whoId = pending?.type === "chooseTarget" ? pending.playerId : pending?.type === "flipThree" ? pending.targetId : awaitingId;
  const who = game.players.find((p) => p.id === whoId);
  if (!who) return <Waiting text={game.dealing ? "Dealing" : "Waiting"} />;
  const name = firstName(who.name);
  if (secondsLeft !== null && !autoPlay?.idle) {
    return <Waiting player={who} seat={game.players.indexOf(who)} text={`${name} disconnected\u00a0— ${secondsLeft > 0 ? `auto-playing in ${secondsLeft}s` : "auto-playing"}`} alert />;
  }
  if (idleLeft !== null) {
    return <Waiting player={who} seat={game.players.indexOf(who)} text={`${name} is taking a while · ${idleLeft > 0 ? `auto-playing in ${idleLeft}s` : "auto-playing"}`} alert />;
  }
  const text =
    pending?.type === "chooseTarget"
      ? `${name} is picking a target`
      : pending?.type === "flipThree"
        ? `${name} is flipping three`
        : `${name} is deciding`;
  return <Waiting player={who} seat={game.players.indexOf(who)} text={text} />;
}
