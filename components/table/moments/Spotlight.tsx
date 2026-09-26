"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlayingCard, cardLabel } from "@/components/cards/PlayingCard";
import { FlipThreeIcon, SecondChanceIcon, SnowflakeIcon } from "@/components/cards/icons";
import { cx } from "@/components/ui/cx";
import type { TableConnection } from "@/lib/client/types";
import type { GameEvent, GameState } from "@/lib/engine/types";
import { nameOf } from "./util";
import "./moments.css";

type Tone = "neutral" | "accent" | "danger" | "frost" | "flip3" | "chance";

interface Line {
  id: string;
  text: string;
  tone: Tone;
  icon: ReactNode;
}

const TONE: Record<Tone, string> = {
  neutral: "text-fg",
  accent: "text-accent",
  danger: "text-busted",
  frost: "text-frozen",
  flip3: "text-card-flip3",
  chance: "text-card-chance",
};

const DWELL_MS = 800;
const FAST_DWELL_MS = 400;

const CHOOSING = { freeze: "Freeze", flipThree: "hit with Flip Three", secondChance: "give a Second Chance" } as const;

export function describe(events: GameEvent[], game: GameState, you: string, seq: number): Line[] {
  const n = (id: string) => nameOf(game, you, id);
  const lines: Omit<Line, "id">[] = [];
  const quietDeals = events.filter((e) => e.type === "deal" && (e.card.kind === "number" || e.card.kind === "plus" || e.card.kind === "x2"));
  if (quietDeals.length > 0) lines.push({ text: `Round ${game.round} · cards dealt`, tone: "neutral", icon: null });

  events.forEach((e, i) => {
    const next = events[i + 1];
    switch (e.type) {
      case "deal":
      case "draw": {
        const isAction = e.card.kind === "freeze" || e.card.kind === "flipThree" || e.card.kind === "secondChance";
        if (e.type === "deal" && !isAction) return;
        // The bust / save line already names the card.
        if (next && (next.type === "bust" || next.type === "secondChanceUsed") && next.card.id === e.card.id) return;
        const verb = e.type === "deal" ? (e.playerId === you ? "were dealt" : "was dealt") : "drew";
        lines.push({
          text: `${n(e.playerId)} ${verb} ${cardLabel(e.card)}${isAction ? "!" : ""}`,
          tone: "neutral",
          icon: <PlayingCard card={e.card} size="xs" />,
        });
        return;
      }
      case "bust":
        lines.push({ text: `${n(e.playerId)} busted on ${/^(8|11)$/.test(cardLabel(e.card)) ? "an" : "a"} ${cardLabel(e.card)}`, tone: "danger", icon: <PlayingCard card={e.card} size="xs" /> });
        return;
      case "secondChanceUsed":
        lines.push({
          text: `Second Chance saved ${e.playerId === you ? "you" : n(e.playerId)} from a ${cardLabel(e.card)}`,
          tone: "chance",
          icon: <SecondChanceIcon className="size-5" />,
        });
        return;
      case "secondChancePassed":
        lines.push({
          text: `${n(e.fromId)} gave a Second Chance to ${e.toId === you ? "you" : n(e.toId)}`,
          tone: "chance",
          icon: <SecondChanceIcon className="size-5" />,
        });
        return;
      case "stay":
        lines.push({ text: `${n(e.playerId)} stayed with ${e.points}`, tone: "neutral", icon: null });
        return;
      case "freeze":
        lines.push({
          text:
            e.sourceId === e.targetId
              ? `${n(e.sourceId)} froze and banked ${e.points}`
              : `${n(e.sourceId)} froze ${e.targetId === you ? "you" : n(e.targetId)} · ${e.points} pts`,
          tone: "frost",
          icon: <SnowflakeIcon className="size-5" />,
        });
        return;
      case "flipThree":
        lines.push({
          text:
            e.sourceId === e.targetId
              ? `${n(e.sourceId)} took the Flip Three`
              : `${n(e.sourceId)} hit ${e.targetId === you ? "you" : n(e.targetId)} with Flip Three`,
          tone: "flip3",
          icon: <FlipThreeIcon className="size-5" />,
        });
        return;
      case "flip7":
        lines.push({ text: `${n(e.playerId)} hit FLIP 7! +15`, tone: "accent", icon: null });
        return;
      case "reshuffle":
        lines.push({ text: "Deck reshuffled", tone: "neutral", icon: null });
        return;
      case "roundEnd":
        lines.push({ text: `Round ${e.round} over`, tone: "neutral", icon: null });
        return;
      case "gameOver": {
        const who = e.winnerIds.map(n).join(" & ");
        lines.push({ text: e.winnerIds.length === 1 && e.winnerIds[0] === you ? "You win!" : `${who} ${e.winnerIds.length > 1 ? "win" : "wins"}!`, tone: "accent", icon: null });
        return;
      }
    }
  });
  return lines.map((l, i) => ({ ...l, id: `${seq}-${i}` }));
}

// Plays each event line in turn so a burst (deal, Flip Three) stays readable.
export function Spotlight({ conn, className }: { conn: TableConnection; className?: string }) {
  const { game, you, events } = conn;
  const [log, setLog] = useState<Line[]>([]);
  const [pos, setPos] = useState(-1);
  const [seenSeq, setSeenSeq] = useState<number | null>(null);
  const shownAt = useRef(0);

  // ponytail: log is unbounded; a whole game is a few hundred short lines.
  if (events.length > 0 && seenSeq !== game.seq) {
    setSeenSeq(game.seq);
    setLog([...log, ...describe(events, game, you, game.seq)]);
  }

  const shown = Math.min(pos, log.length - 1);
  useEffect(() => {
    if (shown >= log.length - 1) return;
    const backlog = log.length - 1 - shown;
    const dwell = backlog > 3 ? FAST_DWELL_MS : DWELL_MS;
    const wait = Math.max(0, shownAt.current + dwell - Date.now());
    const t = setTimeout(() => {
      shownAt.current = Date.now();
      setPos(shown + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [shown, log.length]);

  const pending = game.pending;
  const caughtUp = shown >= log.length - 1;
  const line: Line | undefined =
    caughtUp && pending?.type === "chooseTarget" && pending.playerId !== you
      ? {
          id: `choose-${pending.card.id}`,
          text: `${nameOf(game, you, pending.playerId)} is choosing who to ${CHOOSING[pending.card.kind]}…`,
          tone: "neutral",
          icon: <PlayingCard card={pending.card} size="xs" />,
        }
      : shown >= 0
        ? log[shown]
        : undefined;

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
            "m-rise flex max-w-full items-center gap-2 rounded-full bg-surface/80 py-1.5 pr-4 pl-2 text-sm font-semibold ring-1 ring-line",
            !line.icon && "pl-4",
            TONE[line.tone],
          )}
        >
          {line.icon && <span className="grid flex-none place-items-center">{line.icon}</span>}
          <span className="truncate">{line.text}</span>
        </div>
      )}
    </div>
  );
}
