"use client";

import { useState, type ReactNode } from "react";
import { PlayingCard, cardLabel } from "@/components/cards/PlayingCard";
import { FlipThreeIcon, SecondChanceIcon, SnowflakeIcon } from "@/components/cards/icons";
import { cx } from "@/components/ui/cx";
import type { TableConnection } from "@/lib/client/types";
import type { GameEvent, GameState } from "@/lib/engine/types";
import { nameOf } from "./util";
import "./moments.css";

type Tone = "neutral" | "accent" | "danger" | "frost" | "flip3" | "chance";

// A screen-wide burst (see Celebration) that fires when its line reaches the Spotlight.
export interface Moment {
  kind: "flip7" | "bust" | "freeze" | "bank";
  mine: boolean;
  points: number;
  who: string;
}

export interface Line {
  id: string;
  text: string;
  tone: Tone;
  icon: ReactNode;
  moment?: Moment;
}

const BIG_BANK = 40;

const TONE: Record<Tone, string> = {
  neutral: "text-fg",
  accent: "text-accent",
  danger: "text-busted",
  frost: "text-frozen",
  flip3: "text-card-flip3",
  chance: "text-card-chance",
};

const a = (label: string) => (/^(8|11)$/.test(label) ? "an" : "a");

const CHOOSING = { freeze: "Freeze", flipThree: "Flip Three", secondChance: "Second Chance" } as const;

// One line per event at most, tagged with the index of the event it narrates (`at`).
export function describe(events: GameEvent[], game: GameState, you: string, seq: number): (Line & { at: number })[] {
  const n = (id: string) => nameOf(game, you, id);
  const lines: (Omit<Line, "id"> & { at: number })[] = [];
  const firstQuietDeal = events.findIndex((e) => e.type === "deal" && (e.card.kind === "number" || e.card.kind === "plus" || e.card.kind === "x2"));

  events.forEach((e, i) => {
    const next = events[i + 1];
    const push = (l: Omit<Line, "id">) => lines.push({ ...l, at: i });
    if (i === firstQuietDeal) push({ text: `Round ${game.round} · cards dealt`, tone: "neutral", icon: null });
    switch (e.type) {
      case "deal":
      case "draw": {
        const isAction = e.card.kind === "freeze" || e.card.kind === "flipThree" || e.card.kind === "secondChance";
        if (e.type === "deal" && !isAction) return;
        // The bust / save line already names the card.
        if (next && (next.type === "bust" || next.type === "secondChanceUsed") && next.card.id === e.card.id) return;
        const verb = e.type === "deal" ? (e.playerId === you ? "were dealt" : "was dealt") : "drew";
        const queued =
          (game.pending?.type === "flipThree" && game.pending.queued.some((c) => c.id === e.card.id)) ||
          game.actionQueue.some((q) => q.card.id === e.card.id);
        push({
          text: `${n(e.playerId)} ${verb} ${cardLabel(e.card)}${queued ? "! Plays after the flips" : isAction ? "!" : ""}`,
          tone: "neutral",
          icon: null, // the stage already shows this card large
        });
        return;
      }
      case "bust":
        push({
          text: `${n(e.playerId)} busted on ${a(cardLabel(e.card))} ${cardLabel(e.card)}`,
          tone: "danger",
          icon: null,
          moment: { kind: "bust", mine: e.playerId === you, points: 0, who: n(e.playerId) },
        });
        return;
      case "secondChanceUsed":
        push({
          text: `Second Chance saved ${e.playerId === you ? "you" : n(e.playerId)} from ${a(cardLabel(e.card))} ${cardLabel(e.card)}`,
          tone: "chance",
          icon: <SecondChanceIcon className="size-5" />,
        });
        return;
      case "secondChancePassed":
        push({
          text: `${n(e.fromId)} gave a Second Chance to ${e.toId === you ? "you" : n(e.toId)}`,
          tone: "chance",
          icon: <SecondChanceIcon className="size-5" />,
        });
        return;
      case "discarded": {
        // Follows the "drew" line: a spare Second Chance with no receiver, or a queued action whose holder is out.
        push({
          text:
            e.card.kind === "secondChance" && game.players.some((p) => p.id === e.playerId && p.status === "active")
              ? "Nobody can take it · Second Chance discarded"
              : `${e.playerId === you ? "Your" : `${n(e.playerId)}'s`} ${cardLabel(e.card)} is discarded · ${e.playerId === you ? "you're" : `${n(e.playerId)} is`} out`,
          tone: e.card.kind === "secondChance" ? "chance" : "neutral",
          icon: <PlayingCard card={e.card} size="xs" />,
        });
        return;
      }
      case "stay":
        push({
          text: !e.auto
            ? `${n(e.playerId)} stayed with ${e.points}`
            : e.playerId === you
              ? `You were away, so we banked your ${e.points}`
              : `${n(e.playerId)} is away · banked ${e.points}`,
          tone: "neutral",
          icon: null,
          moment: e.playerId === you && e.points >= BIG_BANK ? { kind: "bank", mine: true, points: e.points, who: "You" } : undefined,
        });
        return;
      case "freeze":
        push({
          text:
            e.sourceId === e.targetId
              ? `${n(e.sourceId)} froze and banked ${e.points}`
              : `${n(e.sourceId)} froze ${e.targetId === you ? "you" : n(e.targetId)} · ${e.points} ${e.points === 1 ? "pt" : "pts"}`,
          tone: "frost",
          icon: <SnowflakeIcon className="size-5" />,
          moment: { kind: "freeze", mine: e.targetId === you, points: e.points, who: n(e.targetId) },
        });
        return;
      case "flipThree":
        push({
          text:
            e.sourceId === e.targetId
              ? `${n(e.sourceId)} took the Flip Three`
              : `${n(e.sourceId)} hit ${e.targetId === you ? "you" : n(e.targetId)} with Flip Three`,
          tone: "flip3",
          icon: <FlipThreeIcon className="size-5" />,
        });
        return;
      case "flip7":
        push({
          text: `${n(e.playerId)} hit FLIP 7! +15`,
          tone: "accent",
          icon: null,
          moment: { kind: "flip7", mine: e.playerId === you, points: 15, who: n(e.playerId) },
        });
        return;
      case "reshuffle":
        push({ text: "Deck reshuffled", tone: "neutral", icon: null });
        return;
      case "roundEnd":
        push({ text: `Round ${e.round} over`, tone: "neutral", icon: null });
        return;
      case "gameOver": {
        const who = e.winnerIds.map(n).join(" & ");
        push({ text: e.winnerIds.length === 1 && e.winnerIds[0] === you ? "You win!" : `${who} ${e.winnerIds.length > 1 ? "win" : "wins"}!`, tone: "accent", icon: null });
        return;
      }
    }
  });
  return lines.map((l, i) => ({ ...l, id: `${seq}-${i}` }));
}

// Renders the narration line the table's reveal queue is on (see useReveal), so words and stage never drift apart.
export function Spotlight({ conn, line: queued, caughtUp, className }: { conn: TableConnection; line: Line | null; caughtUp: boolean; className?: string }) {
  const { game, you } = conn;
  const pending = game.pending;
  const choosing: Line | null =
    caughtUp && pending?.type === "chooseTarget" && pending.playerId !== you
      ? {
          id: `choose-${pending.card.id}`,
          text: `${nameOf(game, you, pending.playerId)} picks a ${CHOOSING[pending.card.kind]} target…`,
          tone: "neutral",
          icon: null, // the stage already shows this card large
        }
      : null;
  // Once the choice lands, the queue still holds the stale "drew" line for a beat; keep "is choosing" until it moves on.
  const [held, setHeld] = useState<{ over: string | undefined; line: Line } | null>(null);
  if (choosing && held?.line.id !== choosing.id) setHeld({ over: queued?.id, line: choosing });
  const line = choosing ?? (held && !caughtUp && queued?.id === held.over ? held.line : queued);

  return (
    <div className={cx("flex min-h-10 items-center justify-center", className)}>
      <p aria-live="polite" aria-atomic className="sr-only">
        {line?.text}
      </p>
      {line && (
        <div
          key={line.id}
          aria-hidden
          className={cx(
            "m-rise flex max-w-full items-center gap-2 rounded-2xl bg-surface/80 py-1.5 pr-4 pl-2 text-sm font-semibold ring-1 ring-line",
            !line.icon && "pl-4",
            TONE[line.tone],
          )}
        >
          {line.icon && <span className="grid flex-none place-items-center">{line.icon}</span>}
          <span className="line-clamp-2 text-center text-balance">{line.text}</span>
        </div>
      )}
    </div>
  );
}
