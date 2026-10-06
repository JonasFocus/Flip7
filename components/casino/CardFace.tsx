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

// Standard pip layouts for 2-10 as [x, y] fractions of the card; pips below the middle print upside down, as on a real deck.
const L = 0.27;
const R = 0.73;
const C = 0.5;
const ROWS4 = [0.2, 0.4, 0.6, 0.8];
const PIPS: Partial<Record<Rank, [number, number][]>> = {
  "2": [[C, 0.2], [C, 0.8]],
  "3": [[C, 0.2], [C, 0.5], [C, 0.8]],
  "4": [[L, 0.2], [R, 0.2], [L, 0.8], [R, 0.8]],
  "5": [[L, 0.2], [R, 0.2], [C, 0.5], [L, 0.8], [R, 0.8]],
  "6": [[L, 0.2], [R, 0.2], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
  "7": [[L, 0.2], [R, 0.2], [C, 0.35], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
  "8": [[L, 0.2], [R, 0.2], [C, 0.35], [L, 0.5], [R, 0.5], [C, 0.65], [L, 0.8], [R, 0.8]],
  "9": [...ROWS4.flatMap((y): [number, number][] => [[L, y], [R, y]]), [C, 0.5]],
  "10": [...ROWS4.flatMap((y): [number, number][] => [[L, y], [R, y]]), [C, 0.3], [C, 0.7]],
};

function Pips({ card }: { card: { rank: Rank; suit: Suit } }) {
  const layout = PIPS[card.rank];
  if (!layout) return <span className="cc-pip">{SUIT[card.suit]}</span>;
  return (
    <span aria-hidden className="cc-pips">
      {layout.map(([x, y], i) => (
        <span key={i} data-flip={y > 0.5 || undefined} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>
          {SUIT[card.suit]}
        </span>
      ))}
    </span>
  );
}

// Two-faced card; width = `size` (any CSS length, default 1em), insides scale in em. `faceDown` turns it over in place via a
// transition, so a card with a known face can be flipped later. Deal/sweep animations are the caller's (WAAPI on `ref`; the
// flip target is the first child). `pips` lays number cards out like a real deck instead of one big centre suit.
export function CardFace({
  card,
  faceDown = false,
  pips = false,
  size,
  className,
  style,
  ref,
}: {
  card: { rank: Rank; suit: Suit } | null;
  faceDown?: boolean;
  pips?: boolean;
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
      data-pips={pips || undefined}
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
                  {pips && <span className="cc-court-suit">{SUIT[card.suit]}</span>}
                </span>
              ) : pips ? (
                <Pips card={card} />
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
