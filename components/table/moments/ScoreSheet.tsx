"use client";

import { Avatar } from "@/components/ui/Avatar";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import type { GameState, Player } from "@/lib/engine/types";
import { shownPlayer } from "../hand";
import { rankOf, roundPoints } from "./util";

const ZEBRA = "group-odd:bg-[color-mix(in_oklch,var(--color-surface-2)_40%,var(--color-surface))]";
const STICKY_END = "sticky right-0 bg-surface shadow-[-8px_0_8px_-8px_oklch(0_0_0/0.5)]";

// `hidden`/`pendingStatus`: what the table's reveal queue hasn't shown yet, so "Now" can't spoil a bust or Flip 7.
// `pending`: the round has ended in state but not on stage yet, so render the pre-round view.
export function ScoreSheet({
  game,
  you,
  hidden,
  pendingStatus,
  pending = false,
  open,
  onClose,
}: {
  game: GameState;
  you: string;
  hidden?: Set<string>;
  pendingStatus?: Set<string>;
  pending?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const history = (p: Player) => (pending ? p.roundHistory.slice(0, -1) : p.roundHistory);
  const totalOf = (p: Player) => (pending ? p.total - (p.roundHistory.at(-1) ?? 0) : p.total);
  const sorted = [...game.players].sort((a, b) => totalOf(b) - totalOf(a));
  const ranks = rankOf(sorted, totalOf);
  const rounds = Math.max(0, ...game.players.map((p) => history(p).length));
  const live = pending || game.phase === "playing";
  const best = Math.max(0, ...game.players.flatMap(history));

  return (
    <Sheet open={open} onClose={onClose} title="Scores">
      <p className="-mt-1 mb-4 text-xs font-bold uppercase tracking-[0.16em] text-muted">
        {game.round > 0 ? `Round ${game.round} · ` : ""}first to {game.goal}
      </p>

      <ol className="space-y-2.5">
        {sorted.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3">
            <span className="w-4 text-center font-display text-sm text-muted tabular-nums">{ranks[i]}</span>
            <Avatar id={p.id} seat={game.players.indexOf(p)} name={p.name} isBot={p.isBot} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={cx("truncate font-semibold", p.id === you && "text-accent")}>{p.id === you ? "You" : p.name}</span>
                <span className="font-display tabular-nums">{totalOf(p)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div
                  className={cx("h-full rounded-full", ranks[i] === 1 && totalOf(p) > 0 ? "bg-accent" : "bg-muted/50")}
                  style={{ width: `${Math.min(100, (totalOf(p) / game.goal) * 100)}%` }}
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
              <tr className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                <th scope="col" className="sticky left-0 bg-surface py-1.5 pr-3 pl-2 text-left font-bold">
                  Player
                </th>
                {Array.from({ length: rounds }, (_, r) => (
                  <th key={r} scope="col" className="px-2 py-1.5 text-right font-bold">
                    R{r + 1}
                  </th>
                ))}
                {live && (
                  <th scope="col" className="px-2 py-1.5 text-right font-bold text-accent">
                    Now
                  </th>
                )}
                <th scope="col" className={cx("py-1.5 pr-2 pl-3 text-right font-bold", STICKY_END)}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="group">
                  {/* Sticky cell needs an opaque zebra tint so scrolled rounds don't show through. */}
                  <th
                    scope="row"
                    className={cx("sticky left-0 max-w-28 truncate rounded-l-lg bg-surface py-2 pr-3 pl-2 text-left font-semibold", ZEBRA)}
                  >
                    {p.id === you ? "You" : p.name}
                  </th>
                  {Array.from({ length: rounds }, (_, r) => {
                    const v = history(p)[r];
                    return (
                      <td
                        key={r}
                        className={cx(
                          "px-2 py-2 text-right font-display group-odd:bg-surface-2/40",
                          v === 0 && "text-muted", // history doesn't record why: a Freeze on 0 isn't a bust
                          v !== undefined && v > 0 && v === best && "text-accent",
                        )}
                      >
                        {v ?? "–"}
                      </td>
                    );
                  })}
                  {live && (
                    <td className="px-2 py-2 text-right font-display text-muted group-odd:bg-surface-2/40">
                      {p.status === "waiting" ? "–" : roundPoints(hidden ? shownPlayer(p, hidden, pendingStatus) : p)}
                    </td>
                  )}
                  <td className={cx("rounded-r-lg py-2 pr-2 pl-3 text-right font-display", STICKY_END, ZEBRA)}>{totalOf(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  );
}
