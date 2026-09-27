"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ScorePlayer, ScoreState } from "@/lib/engine/types";
import type { ScoreConnection } from "@/lib/client/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { MAX_PLAYERS } from "@/lib/protocol";

export function canControl(conn: ScoreConnection, seat: ScorePlayer): boolean {
  return conn.isHost || seat.ownerId === conn.you;
}

export function hostName(conn: ScoreConnection): string {
  return conn.game.players.find((p) => p.ownerId === conn.hostId)?.name ?? "the host";
}

export function standings(players: ScorePlayer[]): ScorePlayer[] {
  return [...players].sort((a, b) => b.total - a.total);
}

// Competition ranking: tied totals share a place (1, 1, 3).
export function rankOf(sorted: ScorePlayer[], p: ScorePlayer): number {
  return sorted.findIndex((q) => q.total === p.total);
}

// Blocks taps briefly after mount and after hold(), so the second tap of a double tap on a button that
// swaps the screen can't land on whatever ends up under the finger.
export function useTapGuard(ms = 400): [held: boolean, hold: () => void] {
  const [held, setHeld] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    timer.current = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(timer.current);
  }, [ms]);
  function hold() {
    setHeld(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeld(false), ms);
  }
  return [held, hold];
}

export function AddSeatForm({ conn, className }: { conn: ScoreConnection; className?: string }) {
  const [name, setName] = useState("");
  if (conn.game.players.length >= MAX_PLAYERS) {
    return <p className={cx("text-center text-sm text-muted", className)}>Table is full ({MAX_PLAYERS} players)</p>;
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    conn.send({ type: "addSeat", name: n });
    setName("");
  }
  return (
    <form onSubmit={submit} className={cx("flex gap-2", className)}>
      <label className="sr-only" htmlFor="seat-name">
        Add someone sharing this phone
      </label>
      <input
        id="seat-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={20}
        autoComplete="off"
        enterKeyHint="done"
        placeholder="Add someone on this phone"
        className="min-h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-fg placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <Button type="submit" variant="secondary" disabled={!name.trim()} className="flex-none">
        Add
      </Button>
    </form>
  );
}

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[11px] font-bold uppercase tracking-[0.18em] text-muted", className)}>{children}</p>;
}

// Ticks from the previous value to the new one; instant under reduced motion.
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      setShown(Math.round(start + (value - start) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={cx("tabular-nums", className)}>{shown}</span>;
}

export function GoalBar({ total, goal, lead }: { total: number; goal: number; lead?: boolean }) {
  const pct = Math.min(100, (total / goal) * 100);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
      <div
        className={cx("h-full origin-left rounded-full transition-transform duration-700 ease-[var(--ease-out)]", lead ? "bg-accent" : "bg-fg/60")}
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}

export function HistoryTable({ game }: { game: ScoreState }) {
  const rounds = game.players[0]?.rounds.length ?? 0;
  if (rounds === 0) return <p className="py-8 text-center text-muted">No rounds finished yet.</p>;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full border-separate border-spacing-0 text-center tabular-nums">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-surface pr-3 pb-2 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
              Rd
            </th>
            {game.players.map((p, i) => (
              <th key={p.id} scope="col" className="min-w-14 px-1 pb-2">
                <span className="flex flex-col items-center gap-1">
                  <Avatar id={p.id} seat={i} name={p.name} size="sm" />
                  <span className="max-w-16 truncate text-xs font-semibold">{p.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, r) => (
            <tr key={r}>
              <th scope="row" className="sticky left-0 border-t border-line bg-surface py-2 pr-3 text-left font-display text-sm text-muted">
                {r + 1}
              </th>
              {game.players.map((p) => {
                const v = p.rounds[r];
                // Colour from the stored hand, not the number: a 0 can be a bust, a skipped hand, or a late seat.
                // entryHistory can be shorter than rounds (hands not kept), so align it to the latest rounds.
                const hands = game.entryHistory[r - (rounds - game.entryHistory.length)];
                const hand = hands?.[p.id];
                return (
                  <td
                    key={p.id}
                    className={cx(
                      "border-t border-line py-2 font-semibold",
                      hand?.busted && "text-busted",
                      v == null ? "text-muted/50" : hands && !hand && "text-muted",
                    )}
                  >
                    {v ?? "–"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 border-t-2 border-line bg-surface pt-2 pr-3 text-left text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
              Total
            </th>
            {game.players.map((p) => (
              <td key={p.id} className="border-t-2 border-line pt-2 font-display text-lg text-accent">
                {p.total}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

