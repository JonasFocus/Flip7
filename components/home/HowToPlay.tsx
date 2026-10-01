import type { ReactNode } from "react";
import type { Card } from "@/lib/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";

const n = (value: number, i = 0): Card => ({ id: `htp-${value}-${i}`, kind: "number", value });

const BUST_EXAMPLE: { card: Card; bust?: boolean }[] = [{ card: n(3) }, { card: n(11) }, { card: n(7), bust: true }, { card: n(7, 1), bust: true }];
const ACTION_EXAMPLE: Card[] = [
  { id: "htp-freeze", kind: "freeze" },
  { id: "htp-flip3", kind: "flipThree" },
  { id: "htp-2nd", kind: "secondChance" },
];

const MODIFIER_EXAMPLE: Card[] = [
  { id: "htp-p4", kind: "plus", value: 4 },
  { id: "htp-x2", kind: "x2" },
];

const RULES: { title: string; body: string; cards?: ReactNode }[] = [
  { title: "Hit or stay", body: "Draw cards one at a time. Stay to bank the sum of your numbers." },
  {
    title: "Don't double up",
    body: "Draw a number you already have and you bust: zero this round.",
    cards: BUST_EXAMPLE.map(({ card, bust }) => (
      <PlayingCard key={card.id} card={card} size="xs" className={bust ? "ring-2 ring-busted" : undefined} />
    )),
  },
  { title: "Flip 7", body: "Seven different numbers ends the round instantly, plus 15 bonus." },
  {
    title: "Action cards",
    body: "Freeze banks someone out. Flip Three forces three draws. Second Chance saves one bust.",
    cards: ACTION_EXAMPLE.map((card) => <PlayingCard key={card.id} card={card} size="xs" />),
  },
  {
    title: "Modifiers",
    body: "+2 to +10 add on top; ×2 doubles your numbers. They never bust you.",
    cards: MODIFIER_EXAMPLE.map((card) => <PlayingCard key={card.id} card={card} size="xs" />),
  },
  { title: "Win", body: "First to 200 points at the end of a round takes the game." },
];

const CASINO: { title: string; body: string }[] = [
  { title: "Blackjack", body: "Get closer to 21 than the dealer without going over. Blackjack pays 3:2." },
  { title: "Baccarat", body: "Bet on Player, Banker (5% commission) or Tie (8:1). Closest to 9 wins; cards are dealt for you." },
  { title: "Roulette", body: "Drop chips on the layout before the spin. Straight-up pays 35:1; red/black, odd/even and high/low pay 1:1." },
  { title: "Texas Hold'em", body: "Two hole cards, five shared. Bet, raise or fold each round; the best five-card hand takes the pot." },
];

export function HowToPlay() {
  return (
    <div className="flex flex-col gap-3">
    <details className="group rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 font-display tracking-wide select-none [&::-webkit-details-marker]:hidden">
        How to play
        <span aria-hidden className="inline-block text-xl text-muted transition-[rotate] duration-200 ease-[var(--ease-out)] group-open:rotate-45">
          +
        </span>
      </summary>
      <ol className="flex flex-col gap-3 px-4 pb-4">
        {RULES.map(({ title, body, cards }, i) => (
          <li key={title} className="flex gap-3">
            <span className="font-display text-sm tabular-nums text-accent">{i + 1}</span>
            <div>
              <p className="text-sm leading-snug text-muted">
                <strong className="font-semibold text-fg">{title}.</strong> {body}
              </p>
              {cards && <div className="mt-1.5 flex gap-1">{cards}</div>}
            </div>
          </li>
        ))}
      </ol>
    </details>
    <details className="group rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 font-display tracking-wide select-none [&::-webkit-details-marker]:hidden">
        Casino tables
        <span aria-hidden className="inline-block text-xl text-muted transition-[rotate] duration-200 ease-[var(--ease-out)] group-open:rotate-45">
          +
        </span>
      </summary>
      <ul className="flex flex-col gap-3 px-4 pb-4">
        {CASINO.map(({ title, body }) => (
          <li key={title} className="text-sm leading-snug text-muted">
            <strong className="font-semibold text-fg">{title}.</strong> {body}
          </li>
        ))}
      </ul>
    </details>
    </div>
  );
}
