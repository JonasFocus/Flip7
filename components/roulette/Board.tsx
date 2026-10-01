"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { Chip } from "@/components/casino/Chip";
import { betTotals, colorOf, spotNumbers, spotWins, straightSpot } from "@/lib/roulette";
import type { RlPlayer, RlSpot } from "@/lib/roulette/types";
import { COLS, COLUMNS, DOZENS, EVEN_MONEY, ROWS, spotAt, spotCenter, spotName } from "./layout";

// Same hues as Avatar, so a player's chips match their seat.
const SEAT_HUE = [1, 3, 5, 7, 9, 11, 4, 12];
export const seatColor = (seat: number | null) => `var(--color-card-${SEAT_HUE[(seat ?? 0) % SEAT_HUE.length]})`;

interface Marks {
  mine: number;
  others: { seat: number | null; amount: number }[];
}

function marksBySpot(players: readonly RlPlayer[], you: string): Map<RlSpot, Marks> {
  const out = new Map<RlSpot, Marks>();
  for (const p of players) {
    for (const b of betTotals(p.bets)) {
      const m = out.get(b.spot) ?? { mine: 0, others: [] };
      if (p.id === you) m.mine = b.amount;
      else m.others.push({ seat: p.seat, amount: b.amount });
      out.set(b.spot, m);
    }
  }
  return out;
}

function Marker({ marks }: { marks: Marks }) {
  const [first, ...rest] = marks.others;
  const extra = (marks.mine > 0 ? marks.others : rest).slice(0, 3);
  return (
    <span className="relative inline-grid place-items-center">
      {marks.mine > 0 ? (
        <Chip amount={marks.mine} stack size="sm" className="animate-pop" />
      ) : (
        first && <Chip key={first.seat} amount={first.amount} stack size="sm" color={seatColor(first.seat)} className="rl-other animate-pop" />
      )}
      {extra.length > 0 && (
        <span className="absolute -right-2.5 -bottom-1.5 flex -space-x-1.5" aria-label={`${marks.others.length} other bets`}>
          {extra.map((o) => (
            <Chip key={o.seat} amount={o.amount} size="xs" label="" color={seatColor(o.seat)} className="rl-other animate-pop" />
          ))}
        </span>
      )}
    </span>
  );
}

export function Board({
  players,
  you,
  open,
  win,
  onPlace,
}: {
  players: readonly RlPlayer[];
  you: string;
  open: boolean;
  win: number | null; // the landed result: winning cells and chips are lit, the rest dim
  onPlace: (spot: RlSpot) => void;
}) {
  const [preview, setPreview] = useState<ReadonlySet<number> | null>(null);
  const marks = marksBySpot(players, you);
  const nums = useRef<HTMLDivElement>(null);

  // The board scrolls on small phones: bring the winning number into view when the ball lands.
  useEffect(() => {
    if (win === null) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    nums.current?.querySelector(`[data-n="${win}"]`)?.scrollIntoView({ block: "center", behavior });
  }, [win]);

  // A fresh round starts from the top of the layout, not wherever the last winner scrolled to.
  useEffect(() => {
    if (!open) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    nums.current?.closest(".rl-scroll")?.scrollTo({ top: 0, behavior });
  }, [open]);
  const markState = (spot: RlSpot) => (win === null ? {} : spotWins(spot, win) ? { "data-win": true } : { "data-lose": true });

  function look(spot: RlSpot) {
    if (open) setPreview(new Set(spotNumbers(spot) ?? []));
  }
  function lookAt(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    look(spotAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height));
  }
  function pick(e: MouseEvent<HTMLDivElement>) {
    if (!open) return;
    if (e.detail === 0) {
      // keyboard activation has no pointer position: fall back to the focused number
      const n = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-n]")?.dataset.n : undefined;
      if (n !== undefined) onPlace(straightSpot(Number(n)));
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    onPlace(spotAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height));
  }

  const outside = (spot: RlSpot, label: string, style: CSSProperties, tone?: "red" | "black") => {
    const m = marks.get(spot);
    return (
      <button
        key={spot}
        type="button"
        aria-label={spotName(spot)}
        aria-disabled={!open}
        data-out
        data-c={tone}
        data-win={win !== null && spotWins(spot, win) ? true : undefined}
        style={style}
        className="rl-cell"
        onPointerDown={() => look(spot)}
        onPointerUp={() => setPreview(null)}
        onPointerCancel={() => setPreview(null)}
        onPointerLeave={() => setPreview(null)}
        onClick={() => open && onPlace(spot)}
      >
        <span>
          {tone && <i className="rl-dot" data-c={tone} />}
          {label.split(" ").map((w, i) => (i === 0 ? <Fragment key={w}>{w}</Fragment> : <b key={w}>{w}</b>))}
        </span>
        {m && (
          <span className="rl-mark top-1/2 left-1/2" {...markState(spot)}>
            <Marker marks={m} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="rl-board" data-closed={!open || undefined} data-settled={win !== null || undefined} role="group" aria-label="Betting layout">
      <div
        ref={nums}
        className="rl-nums"
        onPointerDown={lookAt}
        onPointerMove={(e) => e.buttons > 0 && lookAt(e)}
        onPointerUp={() => setPreview(null)}
        onPointerCancel={() => setPreview(null)}
        onPointerLeave={() => setPreview(null)}
        onClick={pick}
      >
        <button
          type="button"
          data-n={0}
          data-c="green"
          aria-label="Straight 0"
          aria-disabled={!open}
          data-hl={preview?.has(0) || undefined}
          data-win={win === 0 || undefined}
          className="rl-cell"
          style={{ gridColumn: `1 / ${COLS + 1}`, gridRow: 1 }}
        >
          0
        </button>
        {Array.from({ length: 36 }, (_, i) => {
          const n = i + 1;
          return (
            <button
              key={n}
              type="button"
              data-n={n}
              data-c={colorOf(n)}
              aria-label={`Straight ${n}`}
              aria-disabled={!open}
              data-hl={preview?.has(n) || undefined}
              data-win={win === n || undefined}
              className="rl-cell"
              style={{ gridColumn: (i % 3) + 1, gridRow: Math.floor(i / 3) + 2 }}
            >
              {n}
            </button>
          );
        })}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[...marks].map(([spot, m]) => {
            const c = spotCenter(spot);
            if (!c) return null;
            return (
              <span key={spot} className="rl-mark" {...markState(spot)} style={{ left: `${(c.x / COLS) * 100}%`, top: `${(c.y / ROWS) * 100}%` }}>
                <Marker marks={m} />
              </span>
            );
          })}
        </div>
      </div>

      {DOZENS.map((d, i) => outside(d.spot, d.label, { gridColumn: 4, gridRow: `${2 + 4 * i} / span 4` }))}
      {EVEN_MONEY.map((o, i) => outside(o.spot, o.label, { gridColumn: 5, gridRow: `${2 + 2 * i} / span 2` }, o.tone))}
      {COLUMNS.map((spot, i) => outside(spot, "2:1", { gridColumn: i + 1, gridRow: 14 }))}
    </div>
  );
}
