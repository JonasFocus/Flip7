"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Card, Player, PlayerStatus } from "@/lib/engine/types";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/ui/Badge";
import { cardLabel } from "@/components/cards/PlayingCard";
import { SecondChanceIcon, SnowflakeIcon } from "@/components/cards/icons";
import { cx } from "@/components/ui/cx";
import { roundScore, shownPlayer, splitHand } from "./hand";

const RIM: Record<PlayerStatus, string> = {
  waiting: "border-line",
  active: "border-line",
  stayed: "border-stayed/50",
  frozen: "border-frozen/60",
  busted: "border-busted/50",
  flip7: "border-flip7",
};

type ChipStyle = CSSProperties & Record<"--c", string>;

export const STATUS_LABEL: Record<PlayerStatus, string> = {
  waiting: "Waiting",
  active: "In",
  stayed: "Stayed",
  frozen: "Frozen",
  busted: "Bust",
  flip7: "Flip 7",
};

// Compact tiles (5+ opponents) have no room for the word; the tile rim already carries the colour.
function StatusIcon({ status }: { status: PlayerStatus }) {
  const tone: Partial<Record<PlayerStatus, string>> = {
    stayed: "bg-stayed/15 text-stayed",
    frozen: "bg-frozen/15 text-frozen",
    busted: "bg-busted/15 text-busted",
    flip7: "bg-flip7 text-ink",
  };
  const glyph =
    status === "frozen" ? (
      <SnowflakeIcon className="size-3.5" strokeWidth={3} />
    ) : status === "flip7" ? (
      <span className="font-display text-[11px] leading-none">7</span>
    ) : (
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={status === "busted" ? "M6 6l12 12M18 6 6 18" : "M4.5 12.5l5 5L19.5 7"} />
      </svg>
    );
  return (
    <span role="img" aria-label={STATUS_LABEL[status]} className={cx("grid size-5 flex-none place-items-center rounded-full", tone[status])}>
      {glyph}
    </span>
  );
}

const CELLS = 8; // 4 x 2 grid; a live hand holds at most 7 numbers, so at least one cell is left for specials

// Modifiers and Second Chance fill the grid after the numbers; if they don't all fit, the last cell says how many more.
function SpecialChip({ card, more }: { card: Card | null; more?: number }) {
  const label = card ? cardLabel(card) : `${more} more`;
  const color = card?.kind === "secondChance" ? "text-card-chance" : "text-fg";
  return (
    <span
      role="img"
      aria-label={label}
      className={cx("grid h-[22px] place-items-center rounded-[5px] border border-line bg-surface-2 font-display text-[11px] leading-none tracking-[-0.04em] tabular-nums", color)}
    >
      {!card ? "…" : card.kind === "secondChance" ? <SecondChanceIcon className="size-3.5" /> : card.kind === "x2" ? "×2" : card.kind === "plus" ? `+${card.value}` : null}
    </span>
  );
}

export function OpponentRail({
  players,
  seats,
  awaitingId,
  nextUpId,
  you,
  hidden,
  pendingStatus,
}: {
  players: Player[];
  seats: Player[];
  awaitingId: string | null;
  nextUpId: string | null;
  you: string;
  hidden: Set<string>;
  pendingStatus: Set<string>;
}) {
  const list = useRef<HTMLUListElement>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const compact = players.length > 4;

  // Horizontal-only scroll on the rail itself; scrollIntoView would also scroll the table's ancestors.
  useEffect(() => {
    const ul = list.current;
    if (!ul || !awaitingId) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // Your turn: show who's next (the player to your left, first in the rail).
    const el = awaitingId === you ? undefined : items.current.get(awaitingId);
    if (awaitingId !== you && !el) return;
    ul.scrollTo({ left: el ? el.offsetLeft - (ul.clientWidth - el.clientWidth) / 2 : 0, behavior });
  }, [awaitingId, you]);

  if (players.length === 0) return null;

  return (
    <ul
      ref={list}
      aria-label="Other players"
      className="relative flex flex-none snap-x [&>li:first-child]:ml-auto [&>li:last-child]:mr-auto snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-4 py-2 [scrollbar-width:none] short-land:py-1.5 [&::-webkit-scrollbar]:hidden"
    >
      {players.map((raw) => {
        const p = shownPlayer(raw, hidden, pendingStatus);
        const turn = p.id === awaitingId;
        const out = p.status === "busted";
        const { numbers, specials } = splitHand(p.hand);
        const room = CELLS - (p.hand.length === 0 ? 1 : numbers.length);
        const shownSpecials = specials.length <= room ? specials : specials.slice(0, room - 1);
        const hasStatus = p.status !== "active" && p.status !== "waiting";
        return (
          <li
            key={p.id}
            ref={(el) => {
              if (el) items.current.set(p.id, el);
              else items.current.delete(p.id);
            }}
            aria-current={turn || undefined}
            className={cx(
              "flex flex-1 snap-center flex-col overflow-hidden rounded-2xl border-2 bg-surface transition-[border-color,opacity] duration-200",
              compact ? "min-w-[104px] max-w-[160px] gap-1.5 p-2" : "min-w-[140px] max-w-[240px] gap-2 p-2.5 short-land:gap-1.5 short-land:p-2",
              turn ? "turn-glow border-accent" : RIM[p.status],
            )}
          >
            <div className="flex items-center gap-2">
              <Avatar
                id={p.id}
                seat={seats.findIndex((x) => x.id === p.id)}
                name={p.name}
                isBot={p.isBot}
                size="sm"
                className={cx("short-land:hidden", !p.connected && "opacity-40")}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
              {p.id === nextUpId && <span className="flex-none text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Next</span>}
              {/* The avatar (and its faded offline state) is hidden in landscape; this dot survives it. */}
              {!p.connected && !p.isBot && <span role="img" aria-label="Offline" className="size-2 flex-none rounded-full bg-busted" />}
            </div>

            <div className="flex min-w-0 items-center gap-1.5">
              <span className={cx("flex-none font-display leading-none tabular-nums", compact ? "text-xl" : "text-2xl", out ? "text-busted" : "text-fg")}>
                {roundScore(p).total}
              </span>
              {hasStatus && <span className="ml-auto flex-none">{compact ? <StatusIcon status={p.status} /> : <StatusBadge status={p.status} />}</span>}
            </div>

            {/* Card chips in a fixed 4 x 2 grid, numbers first: never overlapped, and the rail's height is
                set from round start, so it never grows mid-round. */}
            <div
              className={cx("grid h-[47px] grid-cols-[repeat(4,minmax(0,28px))] content-start gap-[3px]", out && "opacity-50")}
              role="group"
              aria-label="Cards"
            >
              {p.hand.length === 0 ? (
                <span className="h-[22px] rounded-[5px] border-2 border-dashed border-line" />
              ) : (
                numbers.map((c) => {
                  const v = c.kind === "number" ? c.value : 0;
                  const style: ChipStyle = { "--c": `var(--color-card-${v})` };
                  return (
                    <span
                      key={c.id}
                      className="animate-deal grid h-[22px] place-items-center rounded-[5px] bg-(--c) font-display text-[13px] leading-none tracking-[-0.04em] text-ink tabular-nums shadow-[0_2px_0_0_color-mix(in_oklch,var(--c)_45%,black)]"
                      style={style}
                    >
                      {v}
                    </span>
                  );
                })
              )}
              {shownSpecials.map((c) => (
                <SpecialChip key={c.id} card={c} />
              ))}
              {shownSpecials.length < specials.length && <SpecialChip card={null} more={specials.length - shownSpecials.length} />}
            </div>

            <div className="-mt-0.5 flex justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-muted tabular-nums">
              <span>Total {p.total}</span>
              {!p.connected && !p.isBot && <span className="text-busted">Offline</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
