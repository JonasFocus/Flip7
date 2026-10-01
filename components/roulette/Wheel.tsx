"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { LAND_MS, POCKETS, SETTLE_MS, SPIN_MS, colorOf } from "@/lib/roulette";
import type { RlPhase } from "@/lib/roulette/types";

const STEP = 360 / POCKETS.length;
const ROTOR_DEG_PER_MS = 0.026;
const BALL_DEG_PER_MS = -0.4; // against the rotor
const BALL_UNITS = 9; // ball diameter in wheel units (the viewBox is 200 wide)
const TRACK_R = 87;
const REST_R = 64;
const BOUNCES = 4;
const BOUNCE_DECAY = 0.5; // each hop lasts this much of the one before, and rises its square as high
const BOUNCE_SPAN = Array.from({ length: BOUNCES }, (_, k) => BOUNCE_DECAY ** k);
const BOUNCE_TOTAL = BOUNCE_SPAN.reduce((a, b) => a + b, 0);

const mod = (a: number, b: number) => ((a % b) + b) % b;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => clamp01(v) ** 2 * (3 - 2 * clamp01(v));
const round = (v: number) => Math.round(v * 1e3) / 1e3; // server and client must print identical SVG coordinates
const polar = (r: number, deg: number): [number, number] => [round(r * Math.sin((deg * Math.PI) / 180)), round(-r * Math.cos((deg * Math.PI) / 180))];
const pocketDeg = (n: number) => POCKETS.indexOf(n) * STEP;

function wedge(i: number): string {
  const [a0, a1] = [i * STEP - STEP / 2, i * STEP + STEP / 2];
  const [x0, y0] = polar(77, a0);
  const [x1, y1] = polar(77, a1);
  const [x2, y2] = polar(51, a1);
  const [x3, y3] = polar(51, a0);
  return `M${x0} ${y0}A77 77 0 0 1 ${x1} ${y1}L${x2} ${y2}A51 51 0 0 0 ${x3} ${y3}Z`;
}

const WEDGES = POCKETS.map((n, i) => ({ n, d: wedge(i), at: polar(64, i * STEP), deg: i * STEP, color: colorOf(n) }));
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
  hop: number; // 0..1: how far the ball is off the wood, drives its scale
  opacity: number;
}

// Height of the hops at u in 0..1 over the whole bounce run: parabolas that shrink geometrically, like a ball losing energy.
function hopAt(u: number): number {
  let t = clamp01(u) * BOUNCE_TOTAL;
  for (let k = 0; k < BOUNCES; k++) {
    const span = BOUNCE_SPAN[k] ?? 0;
    if (t <= span) {
      const x = t / span;
      return 4 * x * (1 - x) * BOUNCE_DECAY ** (2 * k);
    }
    t -= span;
  }
  return 0;
}

// Wheel and ball are pure functions of the clock, so every phone and a reload mid-spin land in the same place.
// The server reveals the pocket only when the ball must drop: until then the ball circulates at a constant speed.
// Then, over LAND_MS, it slows in the rotor's frame (an ease-out power curve whose start slope equals the circulation
// speed, so there is no kink), drops off the track past the deflectors, and hops across pockets into the winning one.
function ballAt(now: number, d: Drive): BallPose {
  const rotor = d.still ? 0 : mod(now * ROTOR_DEG_PER_MS, 360);
  const rest = (n: number | null): BallPose => ({ deg: rotor + (n === null ? 0 : pocketDeg(n)), r: REST_R, hop: 0, opacity: n === null ? 0 : 1 });

  if (d.phase === "betting") return rest(d.last);
  if (d.phase === "spinning") {
    const t = d.deadlineAt === undefined ? Infinity : now - (d.deadlineAt - SPIN_MS);
    return { deg: d.still ? 0 : now * BALL_DEG_PER_MS, r: REST_R + (TRACK_R - REST_R) * smooth(t / 500), hop: 0, opacity: clamp01(t / 250) };
  }
  const n = d.result ?? d.last;
  if (n === null || d.deadlineAt === undefined || d.still) return rest(n);

  const start = d.deadlineAt - SETTLE_MS;
  const p = (now - start) / LAND_MS;
  if (p >= 1) return rest(n);

  const from = mod(start * (BALL_DEG_PER_MS - ROTOR_DEG_PER_MS), 360); // ball angle relative to the rotor at p = 0
  const sweep = 360 + mod(from - pocketDeg(n), 360); // 360..720 degrees backwards, ending exactly on the pocket
  const power = ((ROTOR_DEG_PER_MS - BALL_DEG_PER_MS) * LAND_MS) / sweep; // 1 - (1 - x)^power starts at the circulation speed
  const travel = 1 - (1 - clamp01(p)) ** power;

  const u = clamp01((p - 0.5) / 0.5); // hopping between pockets
  const hop = hopAt(u);
  const nudge = STEP * 1.4 * (1 - u) ** 2 * Math.sin(u * Math.PI * 5);
  const knock = [0.34, 0.43].reduce((s, c) => s + 2.2 * Math.exp(-(((p - c) / 0.016) ** 2)), 0); // hits on the deflectors
  const drop = smooth((p - 0.3) / 0.28);
  return {
    deg: rotor + from - sweep * travel + nudge,
    r: TRACK_R - (TRACK_R - REST_R) * drop + hop * 2 - knock,
    hop: hop + knock * 0.2,
    opacity: 1,
  };
}

// Flat top-down wheel: a still bezel and track, a rotor that only ever rotates, and a ball moved by one transform per
// frame (rotate, then travel along the radius in percent of its own size), so nothing depends on pixel measurements.
export function Wheel({
  phase,
  result,
  last,
  lit,
  deadlineAt,
  className,
  style,
}: {
  phase: RlPhase;
  result: number | null; // settle: the winning pocket (the ball needs it at once, even before it has dropped)
  last: number | null; // the previous result, where the ball rests between spins
  lit: number | null; // pocket to light up once the ball has landed
  deadlineAt: number | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  const rotorRef = useRef<SVGGElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
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
      const d = drive.current;
      const now = Date.now();
      const ball = ballAt(now, d);
      if (rotorRef.current) rotorRef.current.style.transform = `rotate(${d.still ? 0 : mod(now * ROTOR_DEG_PER_MS, 360)}deg)`;
      if (ballRef.current) {
        ballRef.current.style.transform = `rotate(${ball.deg}deg) translateY(${(-ball.r / BALL_UNITS) * 100}%) scale(${1 + ball.hop * 0.3})`;
        ballRef.current.style.opacity = `${ball.opacity}`;
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      reduce.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div role="img" aria-label="Roulette wheel" className={cx("rl-wheel", className)} style={style}>
      <svg aria-hidden viewBox="-100 -100 200 200" className="rl-layer">
        <circle r="99.5" className="rl-bezel" />
        <circle r="94" className="rl-track" />
        <circle r="80" className="rl-lip" />
        {DEFLECTORS.map((a) => {
          const [x, y] = polar(87, a);
          return <path key={a} d="M0 -3L1.3 0L0 3L-1.3 0Z" transform={`translate(${x} ${y}) rotate(${a})`} className="rl-deflector" />;
        })}
        <g ref={rotorRef} className="rl-rotor">
          {WEDGES.map((w) => (
            <path key={w.n} d={w.d} data-c={w.color} data-lit={w.n === lit || undefined} className="rl-pocket" />
          ))}
          <g className="rl-nums-ring">
            {WEDGES.map((w) => (
              <text key={w.n} x={w.at[0]} y={w.at[1]} transform={`rotate(${w.deg} ${w.at[0]} ${w.at[1]})`} textAnchor="middle" dominantBaseline="central">
                {w.n}
              </text>
            ))}
          </g>
          <circle r="49" className="rl-hub" />
          <circle r="36" className="rl-hub-ring" />
          <circle r="4" className="rl-hub-pin" />
        </g>
      </svg>
      <div ref={ballRef} aria-hidden className="rl-ball" style={{ opacity: 0 }} />
    </div>
  );
}
