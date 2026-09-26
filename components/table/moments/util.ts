"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { scoreHand } from "@/lib/engine/index";
import type { GameEvent, GameState, Player } from "@/lib/engine/types";

export function nameOf(game: GameState, you: string, id: string): string {
  if (id === you) return "You";
  return game.players.find((p) => p.id === id)?.name ?? "Someone";
}

export function roundPoints(p: Player): number {
  return p.status === "busted" ? 0 : scoreHand(p.hand, { flip7: p.status === "flip7" }).total;
}

// Competition ranking: ties share a place (1, 1, 3).
export function rankOf(sorted: Player[], score: (p: Player) => number): number[] {
  return sorted.map((p) => sorted.findIndex((q) => score(q) === score(p)) + 1);
}

const REDUCED = "(prefers-reduced-motion: reduce)";
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(REDUCED);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

// Ticks a number from `from` to `to` after `delay` ms, like an arcade score counter.
export function useCountUp(to: number, from: number, delay = 0, ms = 700): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(from);
  const instant = reduced || from === to;
  useEffect(() => {
    if (instant) return;
    let raf = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setValue(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, from, delay, ms, instant]);
  return instant ? to : value;
}

// Round/game end arrives with the final draws; wait for the table to reveal them first.
export function useAfterReveals(active: boolean, events: GameEvent[], seq: number): boolean {
  const reveals = events.filter((e) => e.type === "draw" || e.type === "deal").length;
  const delay = events.some((e) => e.type === "roundEnd") ? Math.min(4000, reveals * 350 + 1500) : 0;
  const [shownSeq, setShownSeq] = useState<number | null>(null);
  useEffect(() => {
    if (!active || delay === 0) return;
    const t = setTimeout(() => setShownSeq(seq), delay);
    return () => clearTimeout(t);
  }, [active, delay, seq]);
  return active && (delay === 0 || shownSeq === seq);
}
