"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { SnowflakeIcon } from "@/components/cards/icons";
import { fail, success } from "@/lib/client/haptics";
import type { Line, Moment } from "./Spotlight";
import "./moments.css";

type Burst = Moment & { key: string };

const DURATION_MS = 1500;
const BIT_COLORS = [1, 3, 5, 7, 8, 9, 10, 12].map((v) => `var(--color-card-${v})`);

// Driven by the reveal queue's narration line (useReveal), so a burst lands with its card, never ahead of it.
export function useBurst(line: Line | null): Burst | null {
  const [seen, setSeen] = useState<string | null>(null);
  const [burst, setBurst] = useState<Burst | null>(null);
  if (line && line.id !== seen) {
    setSeen(line.id);
    if (line.moment) setBurst({ ...line.moment, key: line.id });
  }

  useEffect(() => {
    if (!burst) return;
    if (burst.mine) (burst.kind === "bust" ? fail : success)();
    const t = setTimeout(() => setBurst(null), DURATION_MS);
    return () => clearTimeout(t);
  }, [burst]);

  return burst;
}

export function Celebration({ burst }: { burst: Burst | null }) {
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

// Big centred stamps that cover the stage prompt, which would otherwise read as their subject.
export function stampsOver(burst: Burst | null): boolean {
  return burst !== null && (burst.mine || burst.kind === "flip7");
}

function Stamp({ children, className, sub }: { children: ReactNode; className?: string; sub?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="m-flash absolute inset-0 bg-bg/60" style={{ animationDuration: "1000ms" }} />
      <div className="m-stamp relative text-center">
        {sub && <p className="mb-1 font-display text-lg uppercase tracking-widest text-fg [paint-order:stroke] [-webkit-text-stroke:6px_var(--color-bg)]">{sub}</p>}
        <p className={`font-display text-[clamp(2.75rem,16vw,3.75rem)] uppercase tracking-wide [paint-order:stroke] [-webkit-text-stroke:10px_var(--color-bg)] ${className ?? ""}`}>
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
      {mine && (
        <Stamp className="text-frozen" sub={`You · ${points} banked`}>
          Frozen
        </Stamp>
      )}
    </>
  );
}
