"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CardFace } from "./CardFace";
import type { BjCard } from "@/lib/blackjack/types";

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Distance from el's centre to the centre of a landmark inside the same [data-table] (e.g. [data-shoe], [data-discard]).
export function gapTo(el: Element, selector: string): { dx: number; dy: number } | null {
  const target = el.closest("[data-table]")?.querySelector(selector);
  if (!target) return null;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return { dx: b.left + b.width / 2 - (a.left + a.width / 2), dy: b.top + b.height / 2 - (a.top + a.height / 2) };
}

// Deals out of the shoe face down, spinning onto its spot, and turns over as it lands (a hidden hole card stays down).
// Later changes (the hole card revealed) turn it over in place via the .cc-inner transition.
export function DealtCard({
  card,
  slide = true,
  slideMs,
  sweepMs,
  delay = 0,
  sweep = false,
  className,
  style,
}: {
  card: BjCard | null;
  slide?: boolean;
  slideMs: number; // one card's trip from the shoe
  sweepMs: number; // the trip to the discard tray at the end of the hand
  delay?: number; // may be negative: a card already partway (or all the way) through its trip
  sweep?: boolean; // end of the hand: slide off to the discard tray
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [onMount] = useState(() => ({ slide, delay, faceUp: card !== null }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onMount.slide || reducedMotion() || onMount.delay <= -slideMs) return;
    const gap = gapTo(el, "[data-shoe]");
    if (!gap) return;
    const { dx, dy } = gap;
    const timing: KeyframeAnimationOptions = { duration: slideMs, delay: onMount.delay, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)", fill: "backwards" };
    const moves = [
      el.animate(
        [
          // Hidden until it leaves the shoe, so a card waiting its turn doesn't sit on top of the shoe.
          { transform: `translate(${dx}px, ${dy}px) rotate(-55deg) scale(0.75)`, opacity: 0 },
          { transform: `translate(${dx * 0.94}px, ${dy * 0.94}px) rotate(-50deg) scale(0.77)`, opacity: 1, offset: 0.06 },
          { transform: "translate(0, -6%) rotate(4deg) scale(1.06)", opacity: 1, offset: 0.75 },
          { transform: "none", opacity: 1 },
        ],
        timing,
      ),
    ];
    const inner = el.firstElementChild;
    if (onMount.faceUp && inner instanceof HTMLElement) {
      moves.push(inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(180deg)", offset: 0.55 }, { transform: "rotateY(0deg)" }], timing));
    }
    return () => moves.forEach((m) => m.cancel());
  }, [onMount, slideMs]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !sweep || reducedMotion()) return;
    const gap = gapTo(el, "[data-discard]");
    if (!gap) return;
    const away = el.animate(
      [{ transform: "none" }, { transform: `translate(${gap.dx}px, ${gap.dy}px) rotate(30deg) scale(0.6)`, opacity: 0 }],
      { duration: sweepMs - 100, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
    );
    return () => away.cancel();
  }, [sweep, sweepMs]);

  return <CardFace ref={ref} card={card} className={className} style={style} />;
}
