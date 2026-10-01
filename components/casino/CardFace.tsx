import type { CSSProperties, Ref } from "react";
import "./casino.css";
import { cx } from "@/components/ui/cx";
import type { Rank, Suit } from "@/lib/blackjack/types";

export const SUIT = { s: "♠︎", h: "♥︎", d: "♦︎", c: "♣︎" } as const;

function Index({ card, flip = false }: { card: { rank: Rank; suit: Suit }; flip?: boolean }) {
  return (
    <span aria-hidden className="cc-idx" data-flip={flip || undefined}>
      <span className="cc-r" data-wide={card.rank === "10" || undefined}>
        {card.rank}
      </span>
      <span className="cc-s">{SUIT[card.suit]}</span>
    </span>
  );
}

// Two-faced card; width = `size` (any CSS length, default 1em), insides scale in em. `faceDown` turns it over in place via a
// transition, so a card with a known face can be flipped later. Deal/sweep animations are the caller's (WAAPI on `ref`; the
// flip target is the first child).
export function CardFace({
  card,
  faceDown = false,
  size,
  className,
  style,
  ref,
}: {
  card: { rank: Rank; suit: Suit } | null;
  faceDown?: boolean;
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLSpanElement>;
}) {
  const down = faceDown || card === null;
  const red = card?.suit === "h" || card?.suit === "d";
  return (
    <span
      ref={ref}
      role="img"
      aria-label={down || !card ? "Face-down card" : `${card.rank}${SUIT[card.suit]}`}
      data-down={down || undefined}
      className={cx("cc-card", className)}
      style={size === undefined ? style : { fontSize: size, ...style }}
    >
      <span className="cc-inner">
        <span className="cc-face cc-front" data-red={red || undefined}>
          {card && (
            <>
              <Index card={card} />
              {card.rank === "J" || card.rank === "Q" || card.rank === "K" ? (
                <span className="cc-court">
                  <span>{card.rank}</span>
                </span>
              ) : (
                <span className="cc-pip">{SUIT[card.suit]}</span>
              )}
              <Index card={card} flip />
            </>
          )}
        </span>
        <span className="cc-face cc-back" />
      </span>
    </span>
  );
}
