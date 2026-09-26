import { uniqueNumbers } from "@/lib/engine";
import type { Player } from "@/lib/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { StatusBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { roundScore, splitHand } from "./hand";

function oddsColor(p: number): string {
  if (p < 0.2) return "var(--color-active)";
  if (p < 0.4) return "var(--color-accent)";
  return "var(--color-busted)";
}

export function MyHand({ me, bust, hidden }: { me: Player; bust: number; hidden: Set<string> }) {
  const visible = me.hand.filter((c) => !hidden.has(c.id));
  const { numbers, specials } = splitHand(visible);
  const score = roundScore({ ...me, hand: visible });
  const unique = uniqueNumbers(visible);
  const busted = me.status === "busted";
  const hasChance = visible.some((c) => c.kind === "secondChance");
  const pct = Math.round(bust * 100);
  const color = oddsColor(bust);

  const parts: string[] = [];
  if (score.numberSum > 0 || numbers.length > 0) parts.push(String(score.numberSum));
  if (score.doubled) parts.push("×2");
  if (score.plus > 0) parts.push(`+${score.plus}`);
  if (score.flip7Bonus > 0) parts.push("+15");

  return (
    <section aria-label="Your hand" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">This round</span>
            {me.status !== "active" && me.status !== "waiting" && <StatusBadge status={me.status} />}
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted tabular-nums">· Total {me.total}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              key={score.total}
              aria-live="polite"
              className={cx("animate-pop font-display text-4xl leading-none tabular-nums", busted ? "text-busted" : "text-fg")}
            >
              {score.total}
            </span>
            {!busted && parts.length > 1 && (
              <span className="truncate text-sm font-semibold text-muted tabular-nums">{parts.join(" ")}</span>
            )}
          </div>
        </div>
        {specials.length > 0 && (
          <div className="flex flex-none gap-1 text-[40px]">
            {specials.map((c) => (
              <PlayingCard key={c.id} card={c} size="sm" className="animate-deal" />
            ))}
          </div>
        )}
      </div>

      <div
        className={cx(
          "flex min-h-[78px] items-end justify-center text-[56px]",
          numbers.length >= 6 ? "-space-x-3" : "gap-1.5",
          busted && "animate-shake",
        )}
      >
        {numbers.length === 0 ? (
          <span className="card border-dashed !bg-transparent !shadow-none [--c:var(--color-line)]" aria-hidden />
        ) : (
          numbers.map((c) => <PlayingCard key={c.id} card={c} size="md" dim={busted} className="animate-deal" />)
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex flex-none items-center gap-1" role="img" aria-label={`${unique} of 7 unique numbers`}>
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={i}
              className={cx(
                "size-2.5 rounded-[3px] transition-colors duration-200",
                i < unique ? (unique === 7 ? "bg-flip7" : "bg-active") : "bg-surface-2",
              )}
            />
          ))}
          <span className="ml-1.5 font-display text-xs tabular-nums text-muted">{unique}/7</span>
        </div>

        {me.status === "active" ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"
              role="meter"
              aria-label="Bust chance on next card"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-300 ease-[var(--ease-out)]"
                style={{ width: `${Math.max(pct, hasChance ? 0 : 3)}%`, backgroundColor: color }}
              />
            </div>
            <span className="flex-none font-display text-xs tabular-nums" style={{ color: hasChance ? "var(--color-card-chance)" : color }}>
              {hasChance ? "Safe" : `Bust ${pct}%`}
            </span>
          </div>
        ) : (
          <span className="flex-1 text-right text-xs font-semibold text-muted">
            {busted ? "Busted — 0 this round" : me.status === "waiting" ? "" : `${score.total} banked`}
          </span>
        )}
      </div>
    </section>
  );
}
