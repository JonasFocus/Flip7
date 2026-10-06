import type { CSSProperties, Ref } from "react";
import "./casino.css";
import { cx } from "@/components/ui/cx";

export const CHIPS = [
  { value: 1, color: "var(--color-card-0)" },
  { value: 5, color: "var(--color-card-1)" },
  { value: 10, color: "var(--color-card-5)" },
  { value: 25, color: "var(--color-card-7)" },
  { value: 100, color: "var(--color-card-12)" },
  { value: 500, color: "var(--color-card-2)" },
  { value: 1000, color: "var(--color-card-9)" },
] as const;

const denomination = (amount: number) => [...CHIPS].reverse().find((c) => amount >= c.value) ?? CHIPS[0];

export const chipColor = (amount: number) => denomination(amount).color;

export const shortAmount = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`);

const SIZE = {
  xs: "size-3.5 text-[9px]",
  sm: "size-[clamp(24px,7vw,30px)] text-[9px]",
  md: "size-[clamp(34px,10vw,42px)] text-[11px]",
  lg: "size-[clamp(52px,16vw,62px)] text-sm",
} as const;

const STACK_MAX = 5;

// Greedy denominations for an amount, largest first, capped so a big pot stays a short stack (the cap keeps the largest).
export function stackOf(amount: number): number[] {
  const out: number[] = [];
  let rest = amount;
  for (const { value } of [...CHIPS].reverse()) {
    while (rest >= value && out.length < STACK_MAX) {
      out.push(value);
      rest -= value;
    }
  }
  return out;
}

// One chip labelled with `label` (default: the amount), coloured by denomination unless `color` overrides.
// Denomination chips carry `data-v` so a table can restyle its own chip set in CSS.
// `stack` draws the amount as a short pile of denomination chips with the total on top; `ref` is for WAAPI fly animations.
export function Chip({
  amount,
  size = "md",
  stack = false,
  label,
  color,
  className,
  style,
  ref,
}: {
  amount: number;
  size?: keyof typeof SIZE;
  stack?: boolean;
  label?: string;
  color?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLSpanElement>;
}) {
  if (!stack) {
    return (
      <span
        ref={ref}
        data-v={color ? undefined : denomination(amount).value}
        className={cx("cc-chip grid place-items-center font-display tabular-nums", SIZE[size], className)}
        style={{ "--chip": color ?? chipColor(amount), ...style } as CSSProperties}
      >
        {label ?? shortAmount(amount)}
      </span>
    );
  }

  const pile = stackOf(amount);
  return (
    <span ref={ref} role="img" aria-label={`${amount} chips`} className={cx("relative inline-grid", className)} style={style}>
      {pile.map((v, i) => (
        <span
          key={i}
          data-v={color ? undefined : v}
          className={cx("cc-chip col-start-1 row-start-1 grid place-items-center font-display tabular-nums", SIZE[size])}
          style={{ "--chip": color ?? chipColor(v), transform: `translateY(${(pile.length - 1 - i) * 12}%)` } as CSSProperties}
        >
          {i === pile.length - 1 ? (label ?? shortAmount(amount)) : null}
        </span>
      ))}
    </span>
  );
}
