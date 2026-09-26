"use client";

import { useEffect, useMemo, useState } from "react";
import type { Card, GameEvent } from "@/lib/engine/types";

export interface Reveal {
  key: string;
  playerId: string;
  card: Card;
  outcome: "ok" | "bust" | "saved";
}

const STAGGER_MS = 350;
const FAST_STAGGER_MS = 180; // catch up when a burst (deal, Flip Three) piles up
const HOLD_MS = 1100;

function toReveals(events: GameEvent[], batch: number): Reveal[] {
  const out: Reveal[] = [];
  events.forEach((e, i) => {
    if (e.type === "deal" || e.type === "draw") {
      out.push({ key: `${batch}-${i}`, playerId: e.playerId, card: e.card, outcome: "ok" });
    } else if (e.type === "bust" || e.type === "secondChanceUsed") {
      const r = out.find((x) => x.card.id === e.card.id);
      if (r) r.outcome = e.type === "bust" ? "bust" : "saved";
    }
  });
  return out;
}

// Server/engine events land in bursts; play drawn cards one at a time so people can follow.
// `hidden` holds ids of cards still waiting in the queue, so hands don't spoil them early.
export function useReveal(events: GameEvent[]) {
  const [seen, setSeen] = useState(events);
  const [batch, setBatch] = useState(0);
  const [queue, setQueue] = useState<Reveal[]>([]);
  const [current, setCurrent] = useState<Reveal | null>(null);
  const [leaving, setLeaving] = useState(false);

  if (events !== seen) {
    setSeen(events);
    setBatch(batch + 1);
    const add = toReveals(events, batch + 1);
    if (add.length > 0) setQueue([...queue, ...add]);
  }

  useEffect(() => {
    const next = queue[0];
    if (next) {
      const delay = current && !leaving ? (queue.length > 3 ? FAST_STAGGER_MS : STAGGER_MS) : 0;
      const t = setTimeout(() => {
        setCurrent(next);
        setQueue((q) => q.slice(1));
        setLeaving(false);
      }, delay);
      return () => clearTimeout(t);
    }
    if (current && !leaving) {
      const t = setTimeout(() => setLeaving(true), HOLD_MS);
      return () => clearTimeout(t);
    }
  }, [queue, current, leaving]);

  const hidden = useMemo(() => new Set(queue.map((r) => r.card.id)), [queue]);
  return { current, leaving, hidden };
}
