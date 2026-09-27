"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, GameEvent, GameState } from "@/lib/engine/types";
import { describe, type Line } from "./moments/Spotlight";

export interface Reveal {
  key: string;
  playerId: string;
  card: Card;
  outcome: "ok" | "bust" | "saved";
}

// One beat of the show: a card hitting the stage, a narration line, or both at once.
interface Step {
  reveal: Reveal | null; // null keeps the current card on stage
  line: Line | null;
  beat: Beat;
  status: string | null; // player whose status (stayed / frozen / flip 7) this beat announces
}

// Who the table is watching during this beat, as opposed to whose turn it is live.
export interface Beat {
  actor: string | null;
  dealing: boolean;
  card: boolean; // the beat puts a card on stage (vs. a narration-only beat like a stay)
}

function actorOf(e: GameEvent): string | null {
  switch (e.type) {
    case "deal":
    case "draw":
    case "bust":
    case "secondChanceUsed":
    case "stay":
    case "flip7":
    case "discarded":
      return e.playerId;
    case "freeze":
    case "flipThree":
      return e.sourceId;
    case "secondChancePassed":
      return e.fromId;
    default:
      return null;
  }
}

function statusOf(e: GameEvent): string | null {
  if (e.type === "stay" || e.type === "flip7") return e.playerId;
  if (e.type === "freeze") return e.targetId;
  return null;
}

const CARD_MS = 455;
const FAST_CARD_MS = 235; // catch up when a burst (deal, Flip Three) piles up
const LINE_MS = 1040; // a new sentence needs longer than a card to read
const FAST_LINE_MS = 545;
const HOLD_MS = 1430;

function toSteps(events: GameEvent[], game: GameState, you: string, batch: number): Step[] {
  const lines = describe(events, game, you, batch);
  const steps: Step[] = [];
  events.forEach((e, i) => {
    const line = lines.find((l) => l.at === i) ?? null;
    if (e.type === "deal" || e.type === "draw") {
      steps.push({
        reveal: { key: `${batch}-${i}`, playerId: e.playerId, card: e.card, outcome: "ok" },
        line,
        beat: { actor: e.playerId, dealing: e.type === "deal", card: true },
        status: null,
      });
      return;
    }
    if (e.type === "bust" || e.type === "secondChanceUsed") {
      const drawn = steps.findLast((s) => s.reveal?.card.id === e.card.id);
      if (drawn?.reveal) {
        drawn.reveal.outcome = e.type === "bust" ? "bust" : "saved";
        drawn.line = line ?? drawn.line;
        return;
      }
    }
    const status = statusOf(e);
    if (line || status) steps.push({ reveal: null, line, beat: { actor: actorOf(e), dealing: false, card: false }, status });
  });
  return steps;
}

// Server/engine events land in bursts; play them one beat at a time so people can follow.
// Stage card and Spotlight line come from the same queue, so they can't disagree.
// `hidden` holds ids of cards still waiting in the queue, so hands don't spoil them early.
export function useReveal(events: GameEvent[], game: GameState, you: string) {
  // null, not `events`: the batch that mounts the table (the opening deal) should play too.
  const [seen, setSeen] = useState<GameEvent[] | null>(null);
  const [batch, setBatch] = useState(0);
  const [queue, setQueue] = useState<Step[]>([]);
  const [current, setCurrent] = useState<Reveal | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [beat, setBeat] = useState<Beat>({ actor: null, dealing: false, card: false });
  const [settled, setSettled] = useState(true);
  const lastBeat = useRef({ at: 0, line: false });

  // `queued` includes a batch that arrived this render, so callers never see caughtUp for a snapshot whose cards are still to come.
  let queued = queue;
  if (events !== seen) {
    setSeen(events);
    setBatch(batch + 1);
    const add = toSteps(events, game, you, batch + 1);
    if (add.length > 0) {
      queued = [...queue, ...add];
      setQueue(queued);
    }
  }

  useEffect(() => {
    const next = queue[0];
    if (next) {
      const busy = queue.length > 3;
      const dwell = lastBeat.current.line ? (busy ? FAST_LINE_MS : LINE_MS) : busy ? FAST_CARD_MS : CARD_MS;
      const t = setTimeout(() => {
        lastBeat.current = { at: Date.now(), line: next.line !== null };
        setSettled(false);
        if (next.reveal) {
          setCurrent(next.reveal);
          setLeaving(false);
        } else if (current && next.beat.actor && next.beat.actor !== current.playerId) {
          setLeaving(true); // someone else's beat: don't leave their stale card on stage
        }
        if (next.beat.actor) setBeat(next.beat);
        if (next.line) setLine(next.line);
        setQueue((q) => q.slice(1));
      }, Math.max(0, lastBeat.current.at + dwell - Date.now()));
      return () => clearTimeout(t);
    }
    // A Freeze / Flip Three waiting on its target stays on stage: it explains why the table is paused.
    const choosing = game.pending?.type === "chooseTarget" && game.pending.card.id === current?.card.id;
    if (current && !leaving && !choosing) {
      const t = setTimeout(() => setLeaving(true), HOLD_MS);
      return () => clearTimeout(t);
    }
  }, [queue, current, leaving, game.pending]);

  // The last beat has had its full dwell. A batch landing inside that dwell joins the queue without the
  // table flashing live state (e.g. "Pip is flipping three") between two beats that describe it.
  useEffect(() => {
    if (queue.length > 0 || settled) return;
    const dwell = lastBeat.current.line ? LINE_MS : CARD_MS;
    const t = setTimeout(() => setSettled(true), Math.max(0, lastBeat.current.at + dwell - Date.now()));
    return () => clearTimeout(t);
  }, [queue, settled]);

  const hidden = useMemo(() => new Set(queued.flatMap((s) => (s.reveal ? [s.reveal.card.id] : []))), [queued]);
  // Stays / freezes / Flip 7s still queued: their status lands with their line, not before it.
  const pendingStatus = useMemo(() => new Set(queued.flatMap((s) => (s.status ? [s.status] : []))), [queued]);
  const caughtUp = queued.length === 0;
  return { current, leaving, hidden, pendingStatus, line, beat, caughtUp, settled: caughtUp && settled };
}
