import type { ReactNode } from "react";
import type { Card } from "@/lib/engine/types";
import { cx } from "@/components/ui/cx";
import { FlipThreeIcon, SecondChanceIcon, SnowflakeIcon } from "./icons";

export type CardSize = "xs" | "sm" | "md" | "lg" | "xl";

// Card width in px; the card is laid out in em so this is its font-size.
const WIDTH: Record<CardSize, string> = {
  xs: "text-[28px]",
  sm: "text-[40px]",
  md: "text-[56px]",
  lg: "text-[84px]",
  xl: "text-[132px]",
};

const ACTION_NAME = { freeze: "Freeze", flipThree: "Flip 3", secondChance: "2nd Chance" } as const;

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case "number":
      return String(card.value);
    case "plus":
      return `Plus ${card.value}`;
    case "x2":
      return "Times 2";
    case "freeze":
      return "Freeze";
    case "flipThree":
      return "Flip Three";
    case "secondChance":
      return "Second Chance";
  }
}


export function PlayingCard({
  card,
  size = "md",
  faceDown,
  highlight,
  dim,
  className,
}: {
  card: Card;
  size?: CardSize;
  faceDown?: boolean;
  highlight?: boolean;
  dim?: boolean;
  className?: string;
}) {
  if (faceDown) return <CardBack size={size} className={className} />;
  const big = size === "lg" || size === "xl";
  const dark = card.kind !== "number";
  let face: ReactNode;

  if (card.kind === "number") {
    const v = card.value;
    face = (
      <>
        <span className="card-num" data-wide={v >= 10 || undefined} data-underline={((v === 6 || v === 9) && size !== "xs") || undefined}>
          {v}
        </span>
        {big && <span className="card-corner">{v}</span>}
      </>
    );
  } else if (card.kind === "plus" || card.kind === "x2") {
    face = <span className="card-mod">{card.kind === "plus" ? `+${card.value}` : "×2"}</span>;
  } else {
    const Icon = card.kind === "freeze" ? SnowflakeIcon : card.kind === "flipThree" ? FlipThreeIcon : SecondChanceIcon;
    face = (
      <>
        <Icon className="card-icon" strokeWidth={size === "xs" ? 3 : 2.4} />
        {big && <span className="card-label font-sans font-bold">{ACTION_NAME[card.kind]}</span>}
      </>
    );
  }

  return (
    <div
      role="img"
      aria-label={cardLabel(card)}
      className={cx("card", WIDTH[size], className)}
      data-kind={card.kind}
      data-v={card.kind === "number" ? card.value : undefined}
      data-dark={dark || undefined}
      data-highlight={highlight || undefined}
      data-dim={dim || undefined}
    >
      {face}
    </div>
  );
}

export function CardBack({ size = "md", className }: { size?: CardSize; className?: string }) {
  return (
    <div role="img" aria-label="Face-down card" className={cx("card card-back", WIDTH[size], className)}>
      <span className="card-back-mark">7</span>
    </div>
  );
}

export function Deck({
  count,
  size = "md",
  onClick,
  className,
}: {
  count: number;
  size?: CardSize;
  onClick?: () => void;
  className?: string;
}) {
  const layers = Math.min(count, 3);
  const body = (
    <>
      <span className="relative mb-[0.12em] block" style={{ width: "1em", aspectRatio: "5 / 7" }}>
        {count === 0 ? (
          <span className="absolute inset-0 rounded-[var(--radius-card)] border-2 border-dashed border-line" />
        ) : (
          Array.from({ length: layers }, (_, i) => {
            const offset = (layers - 1 - i) * 0.045;
            return (
              <span key={i} className="absolute inset-0 text-[1em]" style={{ transform: `translateY(${offset}em)` }}>
                <CardBack size={size} />
              </span>
            );
          })
        )}
      </span>
      <span className="block text-center font-display tabular-nums text-muted" style={{ fontSize: "max(12px, 0.16em)" }}>
        {count}
      </span>
    </>
  );
  const label = `Deck, ${count} cards left`;
  const cls = cx("inline-flex flex-col items-center", WIDTH[size], className);
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={label} className={cx(cls, "rounded-xl active:scale-[0.97] transition-transform")}>
      {body}
    </button>
  ) : (
    <div role="img" aria-label={label} className={cls}>
      {body}
    </div>
  );
}
