"use client";

import { useEffect, useId, useRef } from "react";
import { LAND_MS, POCKETS, SETTLE_MS, SPIN_MS, colorOf } from "@/lib/roulette";
import type { RlPhase } from "@/lib/roulette/types";

const STEP = 360 / POCKETS.length;
const ROTOR_DEG_PER_MS = 0.018;
const BALL_DEG_PER_MS = -0.42; // against the rotor
const TRACK_R = 86;
const REST_R = 71;
const BOUNCES = 5;
const BOUNCE_DECAY = 0.55; // each hop lasts this much of the one before, and rises its square as high
const BOUNCE_SPAN = Array.from({ length: BOUNCES }, (_, k) => BOUNCE_DECAY ** k);
const BOUNCE_TOTAL = BOUNCE_SPAN.reduce((a, b) => a + b, 0);

const mod = (a: number, b: number) => ((a % b) + b) % b;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => clamp01(v) ** 2 * (3 - 2 * clamp01(v));
const polar = (r: number, deg: number): [number, number] => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];
const pocketDeg = (n: number) => POCKETS.indexOf(n) * STEP;

function wedge(i: number): string {
  const [a0, a1] = [i * STEP - STEP / 2, i * STEP + STEP / 2];
  const [x0, y0] = polar(78, a0);
  const [x1, y1] = polar(78, a1);
  const [x2, y2] = polar(52, a1);
  const [x3, y3] = polar(52, a0);
  return `M${x0} ${y0}A78 78 0 0 1 ${x1} ${y1}L${x2} ${y2}A52 52 0 0 0 ${x3} ${y3}Z`;
}

const WEDGES = POCKETS.map((n, i) => ({ n, d: wedge(i), at: polar(66, i * STEP), deg: i * STEP, color: colorOf(n) }));
const DEFLECTORS = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);

interface Drive {
  phase: RlPhase;
  result: number | null;
  last: number | null;
  deadlineAt: number | undefined;
  still: boolean;
}

interface BallPose {
  deg: number;
  r: number;
  lift: number; // how high the ball is off the wood: drives its shadow and size
  opacity: number;
}

// Height of the n-th hop at u in 0..1 over the whole bounce run: parabolas that shrink geometrically, like a ball losing energy.
function hopAt(u: number): number {
  let t = clamp01(u) * BOUNCE_TOTAL;
  for (let k = 0; k < BOUNCES; k++) {
    const span = BOUNCE_SPAN[k] ?? 0;
    if (t <= span) {
      const x = t / span;
      return 4 * x * (1 - x) * 7 * BOUNCE_DECAY ** (2 * k);
    }
    t -= span;
  }
  return 0;
}

// Wheel and ball are pure functions of the clock, so a reload mid-spin lands in the right place.
// The server only reveals the pocket when the ball must drop, so the ball circulates until then and then
// decelerates (matching its pre-reveal speed, so there is no kink), falls off the track, and bounces into the pocket.
function ballAt(now: number, d: Drive): BallPose {
  const rotor = d.still ? 0 : mod(now * ROTOR_DEG_PER_MS, 360);
  const rest = (n: number | null): BallPose => ({ deg: rotor + (n === null ? 0 : pocketDeg(n)), r: REST_R, lift: 0, opacity: n === null ? 0 : 1 });

  if (d.phase === "betting") return rest(d.last);
  if (d.phase === "spinning") {
    const t = d.deadlineAt === undefined ? Infinity : now - (d.deadlineAt - SPIN_MS);
    return { deg: d.still ? 0 : now * BALL_DEG_PER_MS, r: TRACK_R, lift: 0, opacity: clamp01(t / 400) };
  }
  const n = d.result ?? d.last;
  if (n === null || d.deadlineAt === undefined || d.still) return rest(n);

  const start = d.deadlineAt - SETTLE_MS;
  const p = (now - start) / LAND_MS;
  if (p >= 1) return rest(n);

  const from = start * BALL_DEG_PER_MS;
  const end = mod((start + LAND_MS) * ROTOR_DEG_PER_MS, 360) + pocketDeg(n);
  const sweep = 360 + mod(from - end, 360); // 360..720 degrees backwards, ending exactly on the pocket
  const launch = (-BALL_DEG_PER_MS * LAND_MS) / sweep; // initial slope that keeps the ball's speed continuous; always <= 3 so the curve stays monotone
  const x = clamp01(p);
  const travel = launch * (x ** 3 - 2 * x ** 2 + x) + (3 * x ** 2 - 2 * x ** 3); // cubic Hermite: starts at launch speed, ends at rest

  const u = clamp01((p - 0.6) / 0.4); // bouncing in the pockets
  const hop = hopAt(u);
  const nudge = 5.5 * (1 - u) ** 2 * Math.sin(u * Math.PI * 2 * 2.3) * (p > 0.6 ? 1 : 0); // skips across a neighbour or two before settling
  const knock = [0.4, 0.49].reduce((s, c) => s + 2.4 * Math.exp(-(((p - c) / 0.018) ** 2)), 0); // hits on the deflectors
  const drop = smooth((p - 0.3) / 0.38);
  return {
    deg: from - sweep * travel + nudge,
    r: TRACK_R - (TRACK_R - REST_R) * drop + hop - knock,
    lift: hop + knock,
    opacity: 1,
  };
}

export function Wheel({
  phase,
  result,
  last,
  lit,
  deadlineAt,
  className,
}: {
  phase: RlPhase;
  result: number | null; // settle: the winning pocket (the ball needs it at once, even before it has dropped)
  last: number | null; // the previous result, where the ball rests between spins
  lit: number | null; // pocket to light up once the ball has landed
  deadlineAt: number | undefined;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}${uid}`;
  const ref = (name: string) => `url(#${id(name)})`;
  const rotorRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);
  const shadowRef = useRef<SVGCircleElement>(null);
  const bodyRef = useRef<SVGGElement>(null);
  const drive = useRef<Drive>({ phase, result, last, deadlineAt, still: false });

  useEffect(() => {
    drive.current = { ...drive.current, phase, result, last, deadlineAt };
  }, [phase, result, last, deadlineAt]);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => (drive.current.still = reduce.matches);
    sync();
    reduce.addEventListener("change", sync);
    let raf = 0;
    const frame = () => {
      const now = Date.now();
      const rotor = drive.current.still ? 0 : mod(now * ROTOR_DEG_PER_MS, 360);
      const ball = ballAt(now, drive.current);
      const [x, y] = polar(ball.r, ball.deg);
      rotorRef.current?.setAttribute("transform", `rotate(${rotor})`);
      ballRef.current?.setAttribute("transform", `translate(${x} ${y})`);
      ballRef.current?.setAttribute("opacity", `${ball.opacity}`);
      bodyRef.current?.setAttribute("transform", `translate(${-ball.lift * 0.12} ${-ball.lift * 0.3}) scale(${1 + ball.lift * 0.03})`);
      shadowRef.current?.setAttribute("cx", `${0.9 + ball.lift * 0.22}`);
      shadowRef.current?.setAttribute("cy", `${1.2 + ball.lift * 0.5}`);
      shadowRef.current?.setAttribute("opacity", `${0.5 - ball.lift * 0.03}`);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      reduce.removeEventListener("change", sync);
    };
  }, []);

  return (
    <svg role="img" aria-label="Roulette wheel" viewBox="-100 -100 200 200" className={className}>
      <defs>
        <radialGradient id={id("bowl")} r="1">
          <stop offset="0.9" stopColor="oklch(0.36 0.07 52)" />
          <stop offset="0.96" stopColor="oklch(0.27 0.06 48)" />
          <stop offset="1" stopColor="oklch(0.14 0.03 45)" />
        </radialGradient>
        <linearGradient id={id("brass")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.93 0.09 92)" />
          <stop offset="0.38" stopColor="oklch(0.74 0.11 80)" />
          <stop offset="0.62" stopColor="oklch(0.54 0.09 72)" />
          <stop offset="1" stopColor="oklch(0.84 0.1 88)" />
        </linearGradient>
        <radialGradient id={id("track")} r="1">
          <stop offset="0.82" stopColor="oklch(0.17 0.03 45)" />
          <stop offset="0.9" stopColor="oklch(0.27 0.055 50)" />
          <stop offset="1" stopColor="oklch(0.37 0.07 55)" />
        </radialGradient>
        {(["red", "black", "green"] as const).map((c) => (
          <radialGradient key={c} id={id(c)} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="78">
            <stop offset="0.66" stopColor={ENAMEL[c][0]} />
            <stop offset="0.9" stopColor={ENAMEL[c][1]} />
            <stop offset="1" stopColor={ENAMEL[c][0]} />
          </radialGradient>
        ))}
        <radialGradient id={id("cone")} r="1">
          <stop offset="0" stopColor="oklch(0.42 0.06 55)" />
          <stop offset="0.7" stopColor="oklch(0.25 0.045 50)" />
          <stop offset="1" stopColor="oklch(0.17 0.03 45)" />
        </radialGradient>
        <radialGradient id={id("knob")} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="oklch(0.98 0.05 95)" />
          <stop offset="0.45" stopColor="oklch(0.78 0.11 82)" />
          <stop offset="1" stopColor="oklch(0.42 0.08 70)" />
        </radialGradient>
        <radialGradient id={id("ball")} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor="oklch(1 0 0)" />
          <stop offset="0.5" stopColor="oklch(0.93 0.01 90)" />
          <stop offset="1" stopColor="oklch(0.62 0.015 80)" />
        </radialGradient>
        <linearGradient id={id("gloss")} x1="0.15" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="oklch(1 0 0 / 0.3)" />
          <stop offset="0.45" stopColor="oklch(1 0 0 / 0)" />
        </linearGradient>
        <filter id={id("grain")} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04 0.55" numOctaves="2" seed="4" />
          <feColorMatrix values="0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 0 0  0 0 0 0.9 -0.28" />
        </filter>
        <clipPath id={id("ring")}>
          <path clipRule="evenodd" d="M-98 0a98 98 0 1 0 196 0a98 98 0 1 0 -196 0M-80 0a80 80 0 1 0 160 0a80 80 0 1 0 -160 0Z" />
        </clipPath>
      </defs>

      <circle r="99.5" fill="oklch(0.1 0.01 260)" />
      <circle r="98" fill={ref("bowl")} />
      <rect x="-100" y="-100" width="200" height="200" filter={ref("grain")} clipPath={ref("ring")} opacity="0.7" />
      <circle r="93.2" fill="none" stroke={ref("brass")} strokeWidth="1.5" />
      <circle r="92" fill={ref("track")} />
      <circle r="91.2" fill="none" stroke="oklch(0 0 0 / 0.35)" strokeWidth="0.6" />
      <circle r="80.5" fill="none" stroke="oklch(0 0 0 / 0.5)" strokeWidth="1.6" />
      {DEFLECTORS.map((a) => {
        const [x, y] = polar(85, a);
        return <path key={a} d="M0 -3.4L1.6 0L0 3.4L-1.6 0Z" transform={`translate(${x} ${y}) rotate(${a})`} fill={ref("brass")} stroke="oklch(0.2 0.03 60)" strokeWidth="0.3" />;
      })}
      <circle r="79" fill="none" stroke={ref("brass")} strokeWidth="1.4" />

      <g ref={rotorRef}>
        {WEDGES.map((w) => (
          <path key={w.n} d={w.d} fill={ref(w.color)} className="rl-pocket" data-lit={w.n === lit || undefined} />
        ))}
        {WEDGES.map((w) => (
          <text
            key={w.n}
            x={w.at[0]}
            y={w.at[1]}
            transform={`rotate(${w.deg} ${w.at[0]} ${w.at[1]})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="6.6"
            fontWeight="600"
            fill="oklch(0.97 0.012 90)"
            fontFamily="var(--font-sans)"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {w.n}
          </text>
        ))}
        {lit !== null && <path d={WEDGES[POCKETS.indexOf(lit)]?.d} className="rl-pocket-glow" />}
        <circle r="51.5" fill={ref("cone")} stroke={ref("brass")} strokeWidth="1.3" />
        <circle r="44" fill="none" stroke="oklch(1 0 0 / 0.07)" strokeWidth="0.5" />
        <circle r="30" fill="none" stroke="oklch(1 0 0 / 0.05)" strokeWidth="0.5" />
        <path d="M0 -40V40M-40 0H40" stroke="oklch(0 0 0 / 0.45)" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M0 -40V40M-40 0H40" stroke={ref("brass")} strokeWidth="2.2" strokeLinecap="round" />
        {[0, 90, 180, 270].map((a) => {
          const [x, y] = polar(40, a);
          return <circle key={a} cx={x} cy={y} r="2.6" fill={ref("knob")} />;
        })}
        <circle r="9.5" fill={ref("knob")} stroke="oklch(0.3 0.05 60)" strokeWidth="0.6" />
        <circle r="3.4" fill="oklch(0.2 0.02 60)" />
      </g>

      <g ref={ballRef} opacity="0">
        <circle ref={shadowRef} r="3.1" cx="0.9" cy="1.2" fill="oklch(0 0 0)" opacity="0.5" />
        <g ref={bodyRef}>
          <circle r="3.2" fill={ref("ball")} />
          <circle cx="-1" cy="-1.1" r="0.8" fill="oklch(1 0 0 / 0.9)" />
        </g>
      </g>

      <circle r="98" fill={ref("gloss")} pointerEvents="none" />
      <circle r="98.4" fill="none" stroke="oklch(1 0 0 / 0.14)" strokeWidth="0.6" />
    </svg>
  );
}

const ENAMEL = {
  red: ["oklch(0.4 0.15 25)", "oklch(0.52 0.18 27)"],
  black: ["oklch(0.15 0.008 260)", "oklch(0.26 0.01 260)"],
  green: ["oklch(0.4 0.1 160)", "oklch(0.52 0.12 160)"],
} as const;
