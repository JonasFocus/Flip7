"use client";

import { useEffect, useRef } from "react";
import type { Player, PlayerStatus } from "@/lib/engine/types";
import { Avatar } from "@/components/ui/Avatar";
import { StatusBadge } from "@/components/ui/Badge";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { cx } from "@/components/ui/cx";
import { roundScore, splitHand } from "./hand";

const RIM: Record<PlayerStatus, string> = {
  waiting: "border-line",
  active: "border-line",
  stayed: "border-stayed/50",
  frozen: "border-frozen/60",
  busted: "border-busted/50",
  flip7: "border-flip7",
};

export function OpponentRail({
  players,
  awaitingId,
  hidden,
}: {
  players: Player[];
  awaitingId: string | null;
  hidden: Set<string>;
}) {
  const items = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    const el = awaitingId ? items.current.get(awaitingId) : undefined;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
  }, [awaitingId]);

  if (players.length === 0) return null;

  return (
    <ul
      aria-label="Other players"
      className="flex flex-none snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {players.map((p) => {
        const turn = p.id === awaitingId;
        const out = p.status === "busted";
        const { numbers, specials } = splitHand(p.hand.filter((c) => !hidden.has(c.id)));
        const cards = [...numbers, ...specials];
        return (
          <li
            key={p.id}
            ref={(el) => {
              if (el) items.current.set(p.id, el);
              else items.current.delete(p.id);
            }}
            aria-current={turn || undefined}
            className={cx(
              "flex min-w-[140px] max-w-[240px] flex-1 snap-center flex-col gap-2 rounded-2xl border-2 bg-surface p-2.5 transition-[border-color,opacity] duration-200",
              turn ? "animate-glow border-accent" : RIM[p.status],
            )}
          >
            <div className="flex items-center gap-2">
              <Avatar id={p.id} name={p.name} isBot={p.isBot} size="sm" className={cx(!p.connected && "opacity-40")} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
            </div>

            <div className="flex items-end justify-between gap-1">
              <span className={cx("font-display text-2xl leading-none tabular-nums", out ? "text-busted" : "text-fg")}>
                {roundScore(p).total}
              </span>
              {p.status !== "active" && p.status !== "waiting" && <StatusBadge status={p.status} />}
            </div>

            <div className={cx("flex min-h-[39px] flex-wrap content-start gap-[3px] text-[28px]", out && "opacity-50")}>
              {cards.length === 0 ? (
                <span className="card border-dashed !bg-transparent !shadow-none [--c:var(--color-line)]" aria-hidden />
              ) : (
                cards.map((c) => <PlayingCard key={c.id} card={c} size="xs" className="animate-deal" />)
              )}
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
