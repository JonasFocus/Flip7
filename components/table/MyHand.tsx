import { uniqueNumbers } from "@/lib/engine";
import type { Player } from "@/lib/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { StatusBadge } from "@/components/ui/Badge";
import { cx } from "@/components/ui/cx";
import { isDuplicate, roundScore, shownPlayer, splitHand } from "./hand";

function oddsColor(p: number): string {
  if (p < 0.2) return "var(--color-active)";
  if (p < 0.4) return "var(--color-accent)";
  return "var(--color-busted)";
}

export function MyHand({
  me: live,
  bust,
  hidden,
  pendingStatus,
}: {
  me: Player;
  bust: number;
  hidden: Set<string>;
  pendingStatus: Set<string>;
}) {
  const me = shownPlayer(live, hidden, pendingStatus);
  const visible = me.hand;
  const { numbers, specials } = splitHand(visible);
  const score = roundScore(me);
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
            <span aria-hidden className="size-1 flex-none rounded-full bg-line" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted tabular-nums">Total {me.total}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              key={score.total}
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

      {/* Font size = card width (em). Cards sit 6px apart and overlap only as much as the row needs. */}
      <div
        className={cx(
          "flex min-h-[78px] items-end justify-center text-[56px] [container-type:inline-size] [@media(min-height:880px)]:min-h-[101px] [@media(min-height:880px)]:text-[72px]",
          busted && "animate-shake",
        )}
      >
        {numbers.length === 0 ? (
          <span className="card border-dashed !bg-transparent !shadow-none [--c:var(--color-line)]" aria-hidden />
        ) : (
          numbers.map((c, i) => {
            const dup = busted && isDuplicate(visible, c);
            const n = numbers.length;
            return (
              <span key={c.id} className="flex-none" style={i === 0 ? undefined : { marginLeft: `min(6px, calc((100cqw - ${n}em) / ${n - 1}))` }}>
                <PlayingCard
                  card={c}
                  size="md"
                  dim={busted && !dup}
                  className={cx("animate-deal [@media(min-height:880px)]:text-[72px]!", dup && "ring-2 ring-busted ring-offset-2 ring-offset-surface")}
                />
              </span>
            );
          })
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
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
            <span className="flex-none font-display text-xs tabular-nums" style={{ color: hasChance ? "var(--color-card-chance)" : color }}>
              {hasChance ? "Safe" : `Bust ${pct}%`}
            </span>
          </div>
        ) : busted || me.status === "waiting" ? null : (
          // The header badge and the red 0 already say "bust".
          <span className="flex-1 text-right text-xs font-semibold text-muted">{`${score.total} banked`}</span>
        )}
      </div>
    </section>
  );
}
