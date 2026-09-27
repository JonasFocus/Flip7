"use client";

import { useState } from "react";
import { awaitingPlayerId, bustChance } from "@/lib/engine";
import type { TableConnection } from "@/lib/client/types";
import { Toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { Celebration, stampsOver, useBurst } from "./moments/Celebration";
import { GameOver } from "./moments/GameOver";
import { RoundSummary } from "./moments/RoundSummary";
import { ScoreSheet } from "./moments/ScoreSheet";
import { Spotlight } from "./moments/Spotlight";
import { TargetPicker } from "./moments/TargetPicker";
import { useAfterReveals } from "./moments/util";
import { ActionBar } from "./ActionBar";
import { nextUpAfter, shownPlayer } from "./hand";
import { MyHand } from "./MyHand";
import { OpponentRail } from "./OpponentRail";
import { Stage } from "./Stage";
import { TableHeader } from "./TableHeader";
import { useReveal } from "./useReveal";

export function Table({ conn }: { conn: TableConnection }) {
  const { game, you } = conn;
  const [scores, setScores] = useState(false);
  const { current, leaving, hidden, pendingStatus, line, beat, caughtUp, settled } = useReveal(conn.events, game, you);
  const burst = useBurst(line);

  // Round summary / game over wait for the reveal queue, then make the table behind them inert.
  const ended = useAfterReveals((game.phase === "roundOver" || game.phase === "gameOver") && caughtUp, conn.events, game.seq);
  const awaitingId = awaitingPlayerId(game);
  // Live state runs ahead of the reveal queue; until it drains, the turn belongs to whoever the current beat is about.
  // Your own turn goes live the moment the queue drains; someone else's waits out the last beat's dwell.
  const live = caughtUp && (awaitingId === you || settled);
  const shownAwaiting = live ? awaitingId : beat.actor;
  const dealing = live ? game.dealing : beat.dealing;
  const yourTurn = caughtUp && game.phase === "playing" && awaitingId === you;
  // Frozen while cards are still landing, so the meter never reacts to a card you haven't seen.
  // Keyed by round, so a new deal never shows last round's odds next to an empty hand.
  const [frozenBust, setFrozenBust] = useState({ round: game.round, value: 0 });
  if (caughtUp && game.phase === "playing") {
    const live = bustChance(game, you);
    if (live !== frozenBust.value || game.round !== frozenBust.round) setFrozenBust({ round: game.round, value: live });
  }
  const bust = frozenBust.round === game.round ? frozenBust.value : 0;
  const seat = game.players.findIndex((p) => p.id === you);
  // Seat order starting to your left, so the rail reads like the table.
  const opponents = seat < 0 ? game.players : [...game.players.slice(seat + 1), ...game.players.slice(0, seat)];
  const me = seat < 0 ? undefined : game.players[seat];
  // Only on a plain hit/stay turn: the deal and Flip Three / target picks don't follow seat order.
  const nextUp =
    game.phase === "playing" && !dealing && game.pending === null && shownAwaiting
      ? nextUpAfter(game.players.map((p) => shownPlayer(p, hidden, pendingStatus)), shownAwaiting)
      : null;

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md select-none flex-col overflow-hidden pt-safe px-safe short-land:grid short-land:max-w-5xl short-land:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] short-land:gap-2">
      <div inert={ended} className="flex min-h-0 flex-1 flex-col">
        <TableHeader
          game={game}
          code={conn.code}
          status={conn.status}
          isHost={conn.isHost}
          send={conn.send}
          onScores={() => setScores(true)}
          onLeave={conn.leave}
        />
        <OpponentRail players={opponents} seats={game.players} awaitingId={shownAwaiting} nextUpId={nextUp} you={you} hidden={hidden} pendingStatus={pendingStatus} />
        <Stage
          game={game}
          you={you}
          awaitingId={shownAwaiting}
          caughtUp={live}
          dealing={dealing}
          current={current}
          leaving={leaving}
          settled={settled}
          beatCard={beat.card}
          hush={stampsOver(burst)}
          narration={<Spotlight conn={conn} line={line} caughtUp={caughtUp} className="min-w-0" />}
        />
      </div>

      <div
        inert={ended}
        className={cx(
          "flex flex-none flex-col gap-4 rounded-t-[28px] border-t bg-surface px-4 pt-4 pb-safe-4 transition-[border-color,box-shadow] duration-300",
          "short-land:my-2 short-land:mr-2 short-land:justify-end short-land:overflow-y-auto short-land:rounded-[28px] short-land:border short-land:pb-4",
          yourTurn ? "border-accent shadow-[0_-8px_32px_-12px_oklch(0.89_0.18_98/0.45)]" : "border-line",
        )}
      >
        {me && <MyHand me={me} bust={bust} hidden={hidden} pendingStatus={pendingStatus} nextUp={nextUp === you} />}
        <ActionBar game={game} you={you} awaitingId={awaitingId} caughtUp={live} beat={beat} send={conn.send} autoPlay={conn.autoPlay} />
      </div>

      <TargetPicker conn={conn} ready={caughtUp} />
      <Celebration burst={burst} />
      {ended && game.phase === "roundOver" && <RoundSummary conn={conn} />}
      {ended && game.phase === "gameOver" && <GameOver conn={conn} />}
      <ScoreSheet game={game} you={you} hidden={hidden} pendingStatus={pendingStatus} pending={!caughtUp && game.phase !== "playing"} open={scores} onClose={() => setScores(false)} />
      <Toast message={conn.error} tone="danger" />
      {/* Persistent, text-only live region; yourTurn is gated on caughtUp, so it never runs ahead of the reveal. */}
      <p aria-live="polite" aria-atomic className="sr-only">
        {yourTurn
          ? game.pending?.type === "flipThree"
            ? `Flip three, ${game.pending.remaining} to go`
            : game.pending?.type === "chooseTarget"
              ? "Pick a target"
              : "Your turn. Hit or stay"
          : ""}
      </p>
    </main>
  );
}
