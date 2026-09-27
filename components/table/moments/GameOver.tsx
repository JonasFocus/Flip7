"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import type { TableConnection } from "@/lib/client/types";
import type { Player } from "@/lib/engine/types";
import { ScoreSheet } from "./ScoreSheet";
import { rankOf, useCountUp, useFocusOnShow } from "./util";
import "./moments.css";

const BIT_COLORS = [1, 3, 5, 7, 8, 9, 10, 12].map((v) => `var(--color-card-${v})`);
const STEP: Record<number, string> = { 1: "h-28 landscape:h-14", 2: "h-20 landscape:h-10", 3: "h-14 landscape:h-8" };

export function GameOver({ conn }: { conn: TableConnection }) {
  const { game, you, isHost } = conn;
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [sentSeq, setSentSeq] = useState<number | null>(null);
  const title = useFocusOnShow<HTMLHeadingElement>();
  const host = game.players.find((p) => p.id === conn.hostId)?.name ?? "the host";

  const sorted = [...game.players].sort((a, b) => b.total - a.total);
  const ranks = rankOf(sorted, (p) => p.total);
  const winners = sorted.filter((_, i) => ranks[i] === 1);
  const youWon = winners.some((p) => p.id === you);
  const podium = sorted.slice(0, 3).map((p, i) => ({ p, rank: ranks[i] ?? i + 1 }));
  // Visual order: 2nd, 1st, 3rd.
  const staged = [podium[1], podium[0], podium[2]].filter((x) => x !== undefined);
  const rest = sorted.slice(3).map((p, i) => ({ p, rank: ranks[i + 3] ?? i + 4 }));

  const headline =
    winners.length > 1
      ? `${winners.map((p) => (p.id === you ? "You" : p.name)).join(" & ")} tie!`
      : youWon
        ? "You win!"
        : `${winners[0]?.name ?? "Nobody"} wins!`;

  return (
    <section aria-labelledby="game-over-title" className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-bg px-safe pt-safe">
      <div aria-hidden className="pointer-events-none absolute top-[30%] left-1/2">
        {Array.from({ length: 40 }, (_, i) => {
          const style: CSSProperties & Record<`--${string}`, string> = {
            "--a": `${i * 9}deg`,
            "--d": `${160 + ((i * 41) % 6) * 40}px`,
            "--spin": `${(i % 2 ? 1 : -1) * (200 + i * 15)}deg`,
            "--c": BIT_COLORS[i % BIT_COLORS.length] ?? "var(--color-accent)",
            animationDelay: `${300 + (i % 5) * 40}ms`,
            animationDuration: "1600ms",
          };
          return <span key={i} className="m-bit" style={style} />;
        })}
      </div>

      <div className="relative mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
        <header className="m-rise flex-none px-4 pt-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
            Game over · {game.round} {game.round === 1 ? "round" : "rounds"}
          </p>
          <h2 ref={title} tabIndex={-1} id="game-over-title" className="mt-1 font-display text-4xl uppercase leading-none text-accent text-balance outline-none">
            {headline}
          </h2>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="my-auto">
          <ol className="mt-6 grid grid-cols-3 items-end gap-2" aria-label="Podium">
            {staged.map(({ p, rank }, i) => (
              <Step key={p.id} p={p} seat={game.players.indexOf(p)} rank={rank} you={you} delay={[250, 0, 450][i] ?? 0} />
            ))}
          </ol>

          {rest.length > 0 && (
            <ol className="mt-5 space-y-1.5" aria-label="Other players">
              {rest.map(({ p, rank }, i) => (
                <li
                  key={p.id}
                  className="m-rise flex items-center gap-3 rounded-xl bg-surface px-3 py-2"
                  style={{ animationDelay: `${600 + i * 50}ms` }}
                >
                  <span className="w-5 text-center font-display text-sm text-muted tabular-nums">{rank}</span>
                  <Avatar id={p.id} seat={game.players.indexOf(p)} name={p.name} isBot={p.isBot} size="sm" />
                  <span className={cx("min-w-0 flex-1 truncate font-semibold", p.id === you && "text-accent")}>
                    {p.id === you ? "You" : p.name}
                  </span>
                  <span className="text-right">
                    <span className="block font-display tabular-nums">{p.total}</span>
                    <LastRound p={p} />
                  </span>
                </li>
              ))}
            </ol>
          )}
          </div>
        </div>

        <footer className="flex flex-none flex-col gap-2 border-t border-line px-4 pt-3 pb-safe-4 landscape:flex-row landscape:items-center landscape:pb-safe-3">
          {isHost ? (
            <Button
              size="lg"
              block
              className="landscape:flex-1"
              loading={sentSeq === game.seq && !conn.error}
              onClick={() => {
                setSentSeq(game.seq);
                conn.send({ type: "playAgain" });
              }}
            >
              Play again
            </Button>
          ) : (
            <p role="status" className="py-2 text-center text-sm text-muted landscape:flex-1">
              Waiting for {host} to start a new game…
            </p>
          )}
          <div className="flex gap-2 landscape:flex-none">
            <Button variant="secondary" block onClick={() => setSheet(true)}>
              Scores
            </Button>
            <Button
              variant="ghost"
              block
              onClick={() => {
                conn.leave();
                router.push("/");
              }}
            >
              Home
            </Button>
          </div>
        </footer>
      </div>
      <ScoreSheet game={game} you={you} open={sheet} onClose={() => setSheet(false)} />
    </section>
  );
}

function Step({ p, seat, rank, you, delay }: { p: Player; seat: number; rank: number; you: string; delay: number }) {
  const total = useCountUp(p.total, 0, delay + 200, 900);
  const first = rank === 1;
  return (
    <li className="m-rise flex min-w-0 flex-col items-center" style={{ animationDelay: `${delay}ms` }}>
      <Avatar id={p.id} seat={seat} name={p.name} isBot={p.isBot} size="lg" className={cx(first && "turn-glow")} />
      <span className={cx("mt-2 max-w-full truncate text-sm font-semibold", p.id === you && "text-accent")}>
        {p.id === you ? "You" : p.name}
      </span>
      <span className={cx("font-display text-lg tabular-nums", first ? "text-accent" : "text-fg")}>{total}</span>
      <LastRound p={p} />
      <div
        className={cx(
          "mt-2 grid w-full place-items-start justify-center rounded-t-xl pt-2 font-display text-2xl",
          STEP[rank] ?? "h-14",
          first ? "bg-accent text-ink" : "bg-surface-2 text-muted",
        )}
      >
        {rank}
      </div>
    </li>
  );
}

// The deciding round: game over replaces the round summary, so show what it was worth here.
function LastRound({ p }: { p: Player }) {
  const last = p.roundHistory.at(-1);
  if (last === undefined) return null;
  return (
    <span className={cx("block text-xs tabular-nums", p.status === "busted" ? "text-busted" : "text-muted")}>
      {p.status === "busted" ? "Bust" : `+${last}`} last round
    </span>
  );
}
