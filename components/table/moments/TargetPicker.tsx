"use client";

import { useState } from "react";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import { tap } from "@/lib/client/haptics";
import type { TableConnection } from "@/lib/client/types";
import { bustInThree, pickTarget } from "@/lib/engine/index";
import type { ActionCard, GameState } from "@/lib/engine/types";
import { roundPoints, useHeld } from "./util";

const DRAW_BEAT_MS = 800;
import "./moments.css";

type Kind = ActionCard["kind"];

const COPY: Record<Kind, { title: string; effect: string; verb: string }> = {
  freeze: {
    title: "Freeze",
    effect: "They bank their points now and sit out the rest of the round.",
    verb: "Freeze",
  },
  flipThree: {
    title: "Flip Three",
    effect: "They must flip the next 3 cards, one at a time.",
    verb: "Flip 3 on",
  },
  secondChance: {
    title: "Second Chance",
    effect: "You already hold one, so give this one to another player.",
    verb: "Give to",
  },
};

// `ready`: the table's reveal queue has caught up, so the drawn card lands on stage before the sheet covers it.
export function TargetPicker({ conn, ready }: { conn: TableConnection; ready: boolean }) {
  const { game, you } = conn;
  const pending = game.pending;
  // Everyone else sees "Mom is choosing…" in the Spotlight.
  const choosing = pending?.type === "chooseTarget" && pending.playerId === you;
  // Let the drawn action card finish its flip on stage (and its "You drew…" line) before the sheet covers it.
  const shown = useHeld(ready && choosing, game.seq, conn.events.length > 0 ? DRAW_BEAT_MS : 0);
  if (!shown || pending?.type !== "chooseTarget") return null;

  // Keyed by card so a follow-up choice (queued action) starts fresh.
  return <Picker key={pending.card.id} conn={conn} card={pending.card} optionIds={pending.options} game={game} />;
}

function Picker({ conn, card, optionIds, game }: { conn: TableConnection; card: ActionCard; optionIds: string[]; game: GameState }) {
  const { you } = conn;
  const copy = COPY[card.kind];
  const options = optionIds.flatMap((id) => game.players.filter((p) => p.id === id));
  const suggested = pickTarget(game, you, card, optionIds);
  const me = options.find((p) => p.id === you);
  const badge =
    card.kind === "secondChance"
      ? "Trailing"
      : suggested === you && me
        ? me.total + roundPoints(me) >= game.goal
          ? "Wins the game"
          : "Bank it"
        : "Best pick";
  const [selected, setSelected] = useState<string | null>(suggested ?? options[0]?.id ?? null);
  const [sent, setSent] = useState(false);
  if (sent && conn.error) setSent(false);
  const leaderTotal = Math.max(...game.players.map((p) => p.total));

  function confirm() {
    if (!selected) return;
    tap();
    setSent(true);
    conn.send({ type: "chooseTarget", targetId: selected });
  }

  const target = options.find((p) => p.id === selected);

  return (
    // Not dismissable: the game can't continue until a target is chosen.
    <Sheet open dismissible={false} onClose={() => {}} title={<span className="sr-only">{copy.title}: choose a player</span>}>
      <div className="flex items-center gap-4 pb-4 landscape:pb-3">
        <PlayingCard card={card} size="lg" bare className="animate-deal landscape:text-[40px]" />
        <div className="min-w-0">
          <p className="font-display text-2xl uppercase leading-tight landscape:text-xl">{copy.title}</p>
          <p className="mt-1 text-sm text-muted text-pretty">{copy.effect}</p>
        </div>
      </div>

      <ul className="flex flex-col gap-2 landscape:grid landscape:grid-cols-2" aria-label="Players">
        {options.map((p, i) => {
          const isSel = p.id === selected;
          const pts = roundPoints(p);
          const odds = card.kind === "flipThree" ? Math.round(bustInThree(game, p.id) * 100) : null;
          const shielded = p.hand.some((c) => c.kind === "secondChance");
          return (
            <li key={p.id} className="m-rise" style={{ animationDelay: `${60 + i * 40}ms` }}>
              <button
                type="button"
                aria-pressed={isSel}
                onClick={() => {
                  tap();
                  setSelected(p.id);
                }}
                className={cx(
                  "flex min-h-16 w-full items-center landscape:min-h-12 landscape:py-1.5 gap-3 rounded-2xl border-2 px-3 py-2.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]",
                  isSel
                    ? "border-accent bg-surface-2 shadow-[0_0_0_1px_var(--color-accent),0_0_20px_-6px_oklch(0.89_0.18_98/0.5)]"
                    : "border-line bg-surface",
                )}
              >
                <Avatar id={p.id} seat={game.players.findIndex((x) => x.id === p.id)} name={p.name} isBot={p.isBot} className="landscape:hidden" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{p.id === you ? "You" : p.name}</span>
                    {p.id === suggested && <Badge tone="accent">{badge}</Badge>}
                    {p.id !== suggested && p.total === leaderTotal && leaderTotal > 0 && <Badge>Top score</Badge>}
                    {shielded && card.kind === "flipThree" && <Badge tone="chance">2nd chance</Badge>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted tabular-nums">
                    <span className="font-semibold text-fg">{pts}</span> this round · {p.total} total
                  </span>
                </span>
                {odds !== null && (
                  <span className="text-right text-xs text-muted tabular-nums">
                    <span className={cx("block font-display text-base", odds >= 40 ? "text-busted" : "text-fg")}>{odds}%</span>
                    bust in 3
                  </span>
                )}
                <span
                  aria-hidden
                  className={cx(
                    "grid size-6 flex-none place-items-center rounded-full border-2 landscape:hidden transition-colors duration-150",
                    isSel ? "border-accent bg-accent" : "border-line",
                  )}
                >
                  {isSel && <span className="size-2 rounded-full bg-ink" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="sticky -bottom-px mt-3 bg-surface pt-3 pb-1">
        <Button size="lg" block disabled={!target} loading={sent} onClick={confirm}>
          {target ? `${copy.verb} ${target.id === you ? "yourself" : target.name}` : "Pick a player"}
        </Button>
      </div>
    </Sheet>
  );
}
