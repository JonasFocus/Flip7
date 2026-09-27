"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
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

// Round/game end: `active` should include the table's reveal queue having caught up (useReveal),
// so the last card (e.g. a Flip 7) plays on stage first; then hold briefly for its burst.
const END_HOLD_MS = 1200;
export function useAfterReveals(active: boolean, events: GameEvent[], seq: number): boolean {
  return useHeld(active, seq, events.some((e) => e.type === "roundEnd") ? END_HOLD_MS : 0);
}

// True once `active` has held for `ms` under the same `key` (a new key restarts the wait).
export function useHeld(active: boolean, key: number, ms: number): boolean {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!active || ms === 0) return;
    const t = setTimeout(() => setShown(key), ms);
    return () => clearTimeout(t);
  }, [active, key, ms]);
  return active && (ms === 0 || shown === key);
}

// Moves focus to an overlay's heading when it appears, so screen readers announce it.
export function useFocusOnShow<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}
