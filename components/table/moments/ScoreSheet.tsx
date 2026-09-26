"use client";

import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import type { GameState } from "@/lib/engine/types";
import { rankOf, roundPoints } from "./util";

export function ScoreSheet({ game, you, open, onClose }: { game: GameState; you: string; open: boolean; onClose: () => void }) {
  const sorted = [...game.players].sort((a, b) => b.total - a.total);
  const ranks = rankOf(sorted, (p) => p.total);
  const rounds = Math.max(0, ...game.players.map((p) => p.roundHistory.length));
  const live = game.phase === "playing";
  const best = Math.max(0, ...game.players.flatMap((p) => p.roundHistory));

  return (
    <Sheet open={open} onClose={onClose} title="Scores">
      <p className="-mt-1 mb-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">
        {game.round > 0 ? `Round ${game.round} · ` : ""}first to {game.goal}
      </p>

      <ol className="space-y-2.5">
        {sorted.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3">
            <span className="w-4 text-center font-display text-sm text-muted tabular-nums">{ranks[i]}</span>
            <Avatar id={p.id} name={p.name} isBot={p.isBot} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cx("truncate font-semibold", p.id === you && "text-accent")}>{p.id === you ? "You" : p.name}</span>
                <span className="font-display tabular-nums">{p.total}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div
                  className={cx("h-full rounded-full", ranks[i] === 1 && p.total > 0 ? "bg-accent" : "bg-muted/50")}
                  style={{ width: `${Math.min(100, (p.total / game.goal) * 100)}%` }}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>

      {(rounds > 0 || live) && (
        <div className="-mx-5 mt-6 overflow-x-auto overscroll-x-contain px-5">
          <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
            <caption className="mb-2 text-left text-xs font-bold uppercase tracking-[0.16em] text-muted">By round</caption>
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="sticky left-0 bg-surface py-1.5 pr-3 text-left font-semibold">
                  Player
                </th>
                {Array.from({ length: rounds }, (_, r) => (
                  <th key={r} scope="col" className="px-2 py-1.5 text-right font-semibold">
                    R{r + 1}
                  </th>
                ))}
                {live && (
                  <th scope="col" className="px-2 py-1.5 text-right font-semibold text-accent">
                    Now
                  </th>
                )}
                <th scope="col" className="py-1.5 pl-3 text-right font-semibold">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="[&>*]:border-t [&>*]:border-line">
                  <th scope="row" className="sticky left-0 max-w-28 truncate bg-surface py-2 pr-3 text-left font-semibold">
                    {p.id === you ? "You" : p.name}
                  </th>
                  {Array.from({ length: rounds }, (_, r) => {
                    const v = p.roundHistory[r];
                    return (
                      <td
                        key={r}
                        className={cx(
                          "px-2 py-2 text-right",
                          v === 0 && "text-busted",
                          v !== undefined && v > 0 && v === best && "font-bold text-accent",
                        )}
                      >
                        {v ?? "–"}
                      </td>
                    );
                  })}
                  {live && <td className="px-2 py-2 text-right text-muted italic">{p.status === "waiting" ? "–" : roundPoints(p)}</td>}
                  <td className="py-2 pl-3 text-right font-display">{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  );
}
