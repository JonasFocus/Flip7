"use client";

import { useState } from "react";
import { awaitingPlayerId, bustChance } from "@/lib/engine";
import type { TableConnection } from "@/lib/client/types";
import { Toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { Celebration } from "./moments/Celebration";
import { GameOver } from "./moments/GameOver";
import { RoundSummary } from "./moments/RoundSummary";
import { ScoreSheet } from "./moments/ScoreSheet";
import { Spotlight } from "./moments/Spotlight";
import { TargetPicker } from "./moments/TargetPicker";
import { ActionBar } from "./ActionBar";
import { MyHand } from "./MyHand";
import { OpponentRail } from "./OpponentRail";
import { Stage } from "./Stage";
import { TableHeader } from "./TableHeader";
import { useReveal } from "./useReveal";

export function Table({ conn }: { conn: TableConnection }) {
  const { game, you } = conn;
  const [scores, setScores] = useState(false);
  const { current, leaving, hidden } = useReveal(conn.events);

  const awaitingId = awaitingPlayerId(game);
  const seat = game.players.findIndex((p) => p.id === you);
  // Seat order starting to your left, so the rail reads like the table.
  const opponents = seat < 0 ? game.players : [...game.players.slice(seat + 1), ...game.players.slice(0, seat)];
  const me = seat < 0 ? undefined : game.players[seat];

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md select-none flex-col overflow-hidden pt-safe px-safe [@media(orientation:landscape)_and_(max-height:560px)]:grid [@media(orientation:landscape)_and_(max-height:560px)]:max-w-5xl [@media(orientation:landscape)_and_(max-height:560px)]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] [@media(orientation:landscape)_and_(max-height:560px)]:gap-2">
      <div className="flex min-h-0 flex-1 flex-col">
        <TableHeader
          game={game}
          code={conn.code}
          status={conn.status}
          onScores={() => setScores(true)}
          onLeave={conn.leave}
        />
        <OpponentRail players={opponents} awaitingId={awaitingId} hidden={hidden} />
        <Stage
          game={game}
          you={you}
          awaitingId={awaitingId}
          current={current}
          leaving={leaving}
          narration={<Spotlight conn={conn} />}
        />
      </div>

      <div
        className={cx(
          "flex flex-none flex-col gap-4 rounded-t-[28px] border-t bg-surface px-4 pt-4 pb-safe-4 transition-[border-color,box-shadow] duration-300",
          "[@media(orientation:landscape)_and_(max-height:560px)]:my-2 [@media(orientation:landscape)_and_(max-height:560px)]:mr-2 [@media(orientation:landscape)_and_(max-height:560px)]:justify-end [@media(orientation:landscape)_and_(max-height:560px)]:overflow-y-auto [@media(orientation:landscape)_and_(max-height:560px)]:rounded-[28px] [@media(orientation:landscape)_and_(max-height:560px)]:border [@media(orientation:landscape)_and_(max-height:560px)]:pb-4",
          awaitingId === you ? "border-accent shadow-[0_-8px_32px_-12px_oklch(0.89_0.18_98/0.45)]" : "border-line",
        )}
      >
        {me && <MyHand me={me} bust={bustChance(game, you)} hidden={hidden} />}
        <ActionBar game={game} you={you} awaitingId={awaitingId} send={conn.send} />
      </div>

      <TargetPicker conn={conn} />
      <Celebration conn={conn} />
      <RoundSummary conn={conn} />
      <GameOver conn={conn} />
      <ScoreSheet game={game} you={you} open={scores} onClose={() => setScores(false)} />
      <Toast message={conn.error} tone="danger" />
    </main>
  );
}
