"use client";

import { CardFace } from "@/components/casino/CardFace";
import { cx } from "@/components/ui/cx";
import type { TxCard, TxRecap } from "@/lib/texasholdem/types";

const signed = (n: number): string => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `-${Math.abs(n).toLocaleString()}` : "0");

function Cards({ cards, size }: { cards: readonly (TxCard | null)[]; size: number }) {
  return (
    <span className="flex gap-0.5">
      {cards.map((c, i) => (
        <CardFace key={i} card={c} size={size} />
      ))}
    </span>
  );
}

// The last few hands: board, every hand the table saw, and who won what. Hidden cards arrive redacted.
export function Recap({ history, you }: { history: readonly TxRecap[]; you: string }) {
  if (history.length === 0) return <p className="text-sm text-muted">Finished hands show up here.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {history.map((h) => (
        <li key={h.round} className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
          <p className="flex items-center justify-between text-xs font-bold tracking-[0.12em] text-muted uppercase">
            <span>Hand {h.round}</span>
            <span className="tabular-nums">Pot {h.pot.toLocaleString()}</span>
          </p>
          {h.board.length > 0 && (
            <div className="flex flex-col gap-1" aria-label={h.second ? "Boards" : "Board"}>
              <Cards cards={h.board} size={28} />
              {h.second && <Cards cards={h.second} size={28} />}
            </div>
          )}
          <ul className="flex flex-col gap-1.5">
            {h.players.map((p) => (
              <li key={p.id} className="flex min-h-9 items-center gap-2">
                <Cards cards={p.cards} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm">
                    {p.name}
                    {p.id === you && <span className="text-muted"> (you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{p.hand ?? (p.folded ? "Folded" : p.shown ? "Shown" : "Not shown")}</span>
                </span>
                <span className={cx("font-display text-sm tabular-nums", p.net > 0 ? "text-accent" : p.net < 0 ? "text-danger" : "text-muted")}>
                  {p.won > 0 ? `Won ${p.won.toLocaleString()}` : signed(p.net)}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
