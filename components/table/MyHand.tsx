import { uniqueNumbers } from "@/lib/engine";
import type { Player } from "@/lib/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { cx } from "@/components/ui/cx";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { isDuplicate, roundScore, shownPlayer, splitHand } from "./hand";

export function MyHand({
  me: live,
  hidden,
  pendingStatus,
  nextUp,
}: {
  me: Player;
  hidden: Set<string>;
  pendingStatus: Set<string>;
  nextUp: boolean;
}) {
  const me = shownPlayer(live, hidden, pendingStatus);
  const visible = me.hand;
  const { numbers, specials } = splitHand(visible);
  // One row, modifiers after the numbers at the same size, so your card count reads like everyone else's.
  const cards = [...numbers, ...specials];
  const score = roundScore(me);
  const unique = uniqueNumbers(visible);
  const busted = me.status === "busted";
  const hasChance = visible.some((c) => c.kind === "secondChance");

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
            {nextUp && me.status === "active" && <Badge>Next up</Badge>}
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
      </div>

      {/* Font size = card width (em). Cards sit 6px apart and overlap only as much as the row needs. */}
      <div
        className={cx(
          "flex min-h-[78px] items-end justify-center text-[56px] [container-type:inline-size] [@media(min-height:880px)]:min-h-[101px] [@media(min-height:880px)]:text-[72px]",
          busted && "animate-shake",
        )}
      >
        {cards.length === 0 ? (
          <span className="card border-dashed !bg-transparent !shadow-none [--c:var(--color-line)]" aria-hidden />
        ) : (
          cards.map((c, i) => {
            const dup = busted && isDuplicate(visible, c);
            const n = cards.length;
            // Labels are centred, so a long hand shrinks until each card shows ~0.8 of itself (11 vs 1, +10 vs +1).
            return (
              <span
                key={c.id}
                className="flex-none"
                style={{
                  fontSize: `min(1em, calc(100cqw / ${0.8 * (n - 1) + 1}))`,
                  marginLeft: i === 0 ? undefined : `min(6px, calc((100cqw - ${n}em) / ${n - 1}))`,
                }}
              >
                <PlayingCard
                  card={c}
                  size="md"
                  dim={busted && !dup}
                  className={cx("animate-deal text-[length:1em]!", dup && "ring-2 ring-busted ring-offset-2 ring-offset-surface")}
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

        {me.status === "active" && hasChance && <Badge tone="chance">Second Chance</Badge>}
        {me.status !== "active" && !busted && me.status !== "waiting" && (
          <span className="flex-1 text-right text-xs font-semibold text-muted">{`${score.total} banked`}</span>
        )}
      </div>
    </section>
  );
}
