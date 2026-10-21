"use client";

import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import { standings } from "@/lib/texasholdem";
import { Recap } from "./Recap";
import type { TxState } from "@/lib/texasholdem/types";

const signed = (n: number): string => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `-${Math.abs(n).toLocaleString()}` : "0");

// Who is up tonight: every player's holdings minus their buy-ins, rebuys included. Below it, a recap of the last few hands.
export function Standings({ game, you, open, onClose }: { game: TxState; you: string; open: boolean; onClose: () => void }) {
  const rows = standings(game);
  return (
    <Sheet open={open} onClose={onClose} title="Tonight">
      <ol className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.id} className="flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-surface px-4">
            <span className="w-5 text-sm text-muted tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-sm">
                {r.name}
                {r.id === you && <span className="text-muted"> (you)</span>}
              </span>
              <span className="block text-xs text-muted tabular-nums">Bought in {r.buyIn.toLocaleString()}</span>
            </span>
            <span className={cx("font-display text-base tabular-nums", r.net > 0 ? "text-accent" : r.net < 0 ? "text-danger" : "text-muted")}>{signed(r.net)}</span>
          </li>
        ))}
      </ol>
      <h3 className="mt-5 mb-2 text-xs font-bold tracking-[0.12em] text-muted uppercase">Last hands</h3>
      <Recap history={game.history} you={you} />
    </Sheet>
  );
}
