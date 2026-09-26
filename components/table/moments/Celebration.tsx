"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { SnowflakeIcon } from "@/components/cards/icons";
import { fail, success } from "@/lib/client/haptics";
import type { TableConnection } from "@/lib/client/types";
import type { GameEvent, GameState } from "@/lib/engine/types";
import { nameOf } from "./util";
import "./moments.css";

type Kind = "flip7" | "bust" | "freeze" | "bank";

interface Burst {
  key: number;
  kind: Kind;
  mine: boolean;
  points: number;
  who: string;
  delay: number;
}

const REVEAL_STAGGER_MS = 350; // matches the table's card reveal pacing
const DURATION_MS = 1500;
const BIG_BANK = 40;
const BIT_COLORS = [1, 3, 5, 7, 8, 9, 10, 12].map((v) => `var(--color-card-${v})`);

// Most dramatic event in the batch wins; delayed until its card has been revealed.
function pick(events: GameEvent[], game: GameState, you: string): Burst | null {
  let best: Burst | null = null;
  const rank: Record<Kind, number> = { flip7: 4, bust: 3, freeze: 2, bank: 1 };
  let reveals = 0;
  for (const e of events) {
    if (e.type === "deal" || e.type === "draw") reveals++;
    let b: Omit<Burst, "key" | "delay" | "who"> | null = null;
    let whoId = "";
    if (e.type === "flip7") {
      b = { kind: "flip7", mine: e.playerId === you, points: 15 };
      whoId = e.playerId;
    }
    else if (e.type === "bust") b = { kind: "bust", mine: e.playerId === you, points: 0 };
    else if (e.type === "freeze") b = { kind: "freeze", mine: e.targetId === you, points: e.points };
    else if (e.type === "stay" && e.playerId === you && e.points >= BIG_BANK) b = { kind: "bank", mine: true, points: e.points };
    if (b && (!best || rank[b.kind] > rank[best.kind])) {
      best = { ...b, who: nameOf(game, you, whoId), key: game.seq, delay: Math.min(2000, Math.max(0, reveals - 1) * REVEAL_STAGGER_MS) };
    }
  }
  return best;
}

export function Celebration({ conn }: { conn: TableConnection }) {
  const { events, game, you } = conn;
  const [seenSeq, setSeenSeq] = useState<number | null>(null);
  const [queued, setQueued] = useState<Burst | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);

  // A later batch without a moment must not cancel one still waiting on its reveal.
  if (events.length > 0 && seenSeq !== game.seq) {
    setSeenSeq(game.seq);
    const b = pick(events, game, you);
    if (b) setQueued(b);
  }

  useEffect(() => {
    if (!queued) return;
    const show = setTimeout(() => {
      setBurst(queued);
      if (queued.mine) (queued.kind === "bust" ? fail : success)();
    }, queued.delay);
    const hide = setTimeout(() => setBurst(null), queued.delay + DURATION_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [queued]);

  if (!burst) return null;
  return (
    <div key={burst.key} aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {burst.kind === "flip7" && <Flip7 mine={burst.mine} who={burst.who} />}
      {burst.kind === "bust" && <Bust mine={burst.mine} />}
      {burst.kind === "freeze" && <Frost mine={burst.mine} points={burst.points} />}
      {burst.kind === "bank" && <Stamp className="text-accent">+{burst.points}</Stamp>}
    </div>
  );
}

function Stamp({ children, className, sub }: { children: ReactNode; className?: string; sub?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="m-flash absolute inset-0 bg-bg/60" style={{ animationDuration: "1300ms" }} />
      <div className="m-stamp relative text-center">
        {sub && <p className="mb-1 font-display text-lg uppercase tracking-widest text-fg [paint-order:stroke] [-webkit-text-stroke:6px_var(--color-bg)]">{sub}</p>}
        <p className={`font-display text-6xl uppercase tracking-wide [paint-order:stroke] [-webkit-text-stroke:10px_var(--color-bg)] ${className ?? ""}`}>
          {children}
        </p>
      </div>
    </div>
  );
}

function Flip7({ mine, who }: { mine: boolean; who: string }) {
  const bits = Array.from({ length: mine ? 36 : 20 }, (_, i): CSSProperties & Record<`--${string}`, string> => ({
    "--a": `${(i * 360) / (mine ? 36 : 20) + (i % 3) * 7}deg`,
    "--d": `${140 + ((i * 37) % 5) * 45}px`,
    "--spin": `${(i % 2 ? 1 : -1) * (180 + i * 20)}deg`,
    "--c": BIT_COLORS[i % BIT_COLORS.length] ?? "var(--color-accent)",
    animationDelay: `${(i % 4) * 30}ms`,
  }));
  return (
    <>
      <div className="m-flash m-vignette-gold absolute inset-0" />
      <div className="absolute top-[45%] left-1/2">
        {bits.map((style, i) => (
          <span key={i} className="m-bit" style={style} />
        ))}
      </div>
      <Stamp className="text-accent" sub={mine ? undefined : who}>
        Flip 7!
      </Stamp>
    </>
  );
}

function Bust({ mine }: { mine: boolean }) {
  return (
    <>
      <div className={`m-flash m-vignette-danger absolute inset-0 ${mine ? "bg-busted/15" : ""}`} />
      {mine && (
        <div className="m-shake absolute inset-0">
          <Stamp className="text-busted">Bust</Stamp>
        </div>
      )}
    </>
  );
}

function Frost({ mine, points }: { mine: boolean; points: number }) {
  return (
    <>
      <div className="m-flash m-vignette-frost absolute inset-0" />
      {Array.from({ length: mine ? 10 : 5 }, (_, i) => (
        <SnowflakeIcon
          key={i}
          className="m-flake size-6"
          style={{ left: `${8 + ((i * 53) % 84)}%`, animationDelay: `${(i % 5) * 90}ms` }}
        />
      ))}
      {mine && <Stamp className="text-frozen">Frozen {points}</Stamp>}
    </>
  );
}
