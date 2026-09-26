"use client";

import { useState } from "react";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import type { TableConnection } from "@/lib/client/types";
import { scoreHand } from "@/lib/engine/index";
import type { Card, GameState, Player } from "@/lib/engine/types";
import { ScoreSheet } from "./ScoreSheet";
import { rankOf, useAfterReveals, roundPoints, useCountUp } from "./util";
import "./moments.css";

const ORDER: Record<Card["kind"], number> = { number: 0, plus: 1, x2: 2, secondChance: 3, freeze: 4, flipThree: 5 };

export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] ||
      (a.kind === "number" || a.kind === "plus" ? a.value : 0) - (b.kind === "number" || b.kind === "plus" ? b.value : 0),
  );
}

function breakdown(p: Player): string {
  if (p.status === "busted") return "Busted · 0";
  const s = scoreHand(p.hand, { flip7: p.status === "flip7" });
  const parts = [s.doubled ? `${s.numberSum} ×2` : String(s.numberSum)];
  if (s.plus) parts.push(`+${s.plus}`);
  if (s.flip7Bonus) parts.push(`+${s.flip7Bonus} Flip 7`);
  return parts.join("  ");
}

export function RoundSummary({ conn }: { conn: TableConnection }) {
  const { game, you, isHost } = conn;
  const [sheet, setSheet] = useState(false);
  const [sentRound, setSentRound] = useState<number | null>(null);
  const visible = useAfterReveals(game.phase === "roundOver", conn.events, game.seq);
  if (!visible) return null;

  const sorted = [...game.players].sort((a, b) => roundPoints(b) - roundPoints(a) || b.total - a.total);
  const ranks = rankOf(sorted, roundPoints);
  const top = sorted[0];
  const topPts = top ? roundPoints(top) : 0;

  return (
    <section
      aria-labelledby="round-summary-title"
      className="fixed inset-0 z-30 flex flex-col bg-bg/95 px-safe pt-safe backdrop-blur-sm"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col">
        <header className="m-rise flex-none px-4 pt-5 pb-3 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Round {game.round} · to {game.goal}</p>
          <h2 id="round-summary-title" className="mt-1 font-display text-3xl uppercase leading-none">
            {top && topPts > 0 ? (
              <>
                {top.id === you ? "You" : top.name} <span className="text-accent">+{topPts}</span>
              </>
            ) : (
              "Round over"
            )}
          </h2>
        </header>

        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-4">
          {sorted.map((p, i) => (
            <Row key={p.id} p={p} rank={ranks[i] ?? i + 1} index={i} you={you} game={game} />
          ))}
        </ol>

        <footer className="flex flex-none items-center gap-2 border-t border-line px-4 pt-3 pb-safe-4">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Scores
          </Button>
          {isHost ? (
            <Button
              size="lg"
              block
              loading={sentRound === game.round && !conn.error}
              onClick={() => {
                setSentRound(game.round);
                conn.send({ type: "nextRound" });
              }}
            >
              Next round
            </Button>
          ) : (
            <p role="status" className="flex-1 text-center text-sm text-muted">
              Waiting for the host to deal round {game.round + 1}…
            </p>
          )}
        </footer>
      </div>
      <ScoreSheet game={game} you={you} open={sheet} onClose={() => setSheet(false)} />
    </section>
  );
}

function Row({ p, rank, index, you, game }: { p: Player; rank: number; index: number; you: string; game: GameState }) {
  const pts = roundPoints(p);
  const delay = 250 + index * 90;
  const total = useCountUp(p.total, p.total - pts, delay + 200);
  const busted = p.status === "busted";
  const progress = Math.min(1, p.total / game.goal);

  return (
    <li
      className={cx("m-rise rounded-2xl border bg-surface p-3", p.id === you ? "border-accent/60" : "border-line")}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-3">
        <span className="w-5 flex-none text-center font-display text-sm text-muted tabular-nums">{rank}</span>
        <Avatar id={p.id} name={p.name} isBot={p.isBot} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate font-semibold">{p.id === you ? "You" : p.name}</span>
            {busted && <Badge tone="busted">Bust</Badge>}
            {p.status === "flip7" && <Badge tone="flip7">Flip 7</Badge>}
          </p>
          <p className="text-xs text-muted tabular-nums">{breakdown(p)}</p>
        </div>
        <div className="text-right tabular-nums">
          <p
            className={cx("m-rise font-display text-xl leading-none", busted ? "text-busted" : pts > 0 ? "text-accent" : "text-muted")}
            style={{ animationDelay: `${delay}ms` }}
          >
            {busted ? "0" : `+${pts}`}
          </p>
          <p className="mt-1 text-xs text-muted">
            <span className="font-display text-sm text-fg">{total}</span> total
          </p>
        </div>
      </div>
      {p.hand.length > 0 && (
        <div className={cx("mt-2.5 flex flex-wrap gap-1 pl-8", busted && "opacity-50")}>
          {sortHand(p.hand).map((c) => (
            <PlayingCard key={c.id} card={c} size="xs" />
          ))}
        </div>
      )}
      <div className="mt-2.5 ml-8 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div
          className={cx("m-bar h-full rounded-full", p.total >= game.goal ? "bg-accent" : "bg-muted/60")}
          style={{ width: `${progress * 100}%`, animationDelay: `${delay + 200}ms` }}
        />
      </div>
    </li>
  );
}
