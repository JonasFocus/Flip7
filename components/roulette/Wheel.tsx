"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cx } from "@/components/ui/cx";
import { LAND_MS, POCKETS, SETTLE_MS, SPIN_MS, colorOf } from "@/lib/roulette";
import type { RlPhase } from "@/lib/roulette/types";
import {
  DEFLECTORS,
  DEFLECTOR_R,
  REST_R,
  STEP,
  WALL_R,
  landingPose,
  makeSpin,
  planLanding,
  pocketDeg,
  rotorAt,
  spinPose,
  type BallPose,
  type Landing,
  type Spin,
} from "./ballPath";

const BALL_UNITS = 9; // ball diameter in wheel units (the viewBox is 200 wide)

const round = (v: number) => Math.round(v * 1e3) / 1e3; // server and client must print identical SVG coordinates
const polar = (r: number, deg: number): [number, number] => [round(r * Math.sin((deg * Math.PI) / 180)), round(-r * Math.cos((deg * Math.PI) / 180))];

function wedge(i: number): string {
  const [a0, a1] = [i * STEP - STEP / 2, i * STEP + STEP / 2];
  const [x0, y0] = polar(77, a0);
  const [x1, y1] = polar(77, a1);
  const [x2, y2] = polar(51, a1);
  const [x3, y3] = polar(51, a0);
  return `M${x0} ${y0}A77 77 0 0 1 ${x1} ${y1}L${x2} ${y2}A51 51 0 0 0 ${x3} ${y3}Z`;
}

const WEDGES = POCKETS.map((n, i) => ({ n, d: wedge(i), at: polar(64, i * STEP), deg: i * STEP, color: colorOf(n) }));

interface Drive {
  phase: RlPhase;
  result: number | null;
  last: number | null;
  deadlineAt: number | undefined;
  seed: string;
  still: boolean;
}

interface Throw {
  spin: { seed: string; spin: Spin } | null;
  landing: { seed: string; landing: Landing } | null;
}

// The ball is a pure function of the clock and the spin's seed (ballPath.ts), so every phone and a reload mid-spin
// follow the same throw. A spin and its landing are fixed the first time this phone sees them: later snapshots
// re-derive the deadline from their own arrival time, and a few ms of jitter must not reshuffle a throw in flight.
function ballAt(now: number, d: Drive, cache: Throw): BallPose {
  const rest = (n: number | null): BallPose => ({ deg: (d.still ? 0 : rotorAt(now)) + (n === null ? 0 : pocketDeg(n)), r: REST_R, z: 0, opacity: n === null ? 0 : 1 });
  if (d.phase === "betting") return rest(d.last);
  if (d.phase === "spinning") {
    if (d.still) return { deg: 0, r: WALL_R, z: 0, opacity: 1 };
    if (cache.spin?.seed !== d.seed) cache.spin = { seed: d.seed, spin: makeSpin(d.seed, (d.deadlineAt ?? now + SPIN_MS) - SPIN_MS, d.last) };
    return spinPose(cache.spin.spin, now - cache.spin.spin.start);
  }
  const n = d.result ?? d.last;
  if (n === null || d.deadlineAt === undefined || d.still) return rest(n);
  const start = d.deadlineAt - SETTLE_MS;
  if (cache.landing?.seed !== d.seed) {
    if (now - start >= LAND_MS) return rest(n);
    // Arrived after the reveal (a reload, a late join): replay the throw as if it had been watched from the start.
    const thrown = cache.spin?.seed === d.seed ? cache.spin.spin : makeSpin(d.seed, start - SPIN_MS, null);
    cache.landing = { seed: d.seed, landing: planLanding(thrown, start, n, d.seed) };
  }
  const l = cache.landing.landing;
  return now - l.t0 >= LAND_MS ? rest(n) : landingPose(l, now);
}

// Flat top-down wheel: a still bezel and track, a rotor that only ever rotates, and a ball and its shadow moved by one
// transform each per frame, in percent of their own size, so nothing depends on pixel measurements.
export function Wheel({
  phase,
  result,
  last,
  lit,
  deadlineAt,
  seed,
  className,
  style,
}: {
  phase: RlPhase;
  result: number | null; // settle: the winning pocket (the ball needs it at once, even before it has dropped)
  last: number | null; // the previous result, where the ball rests between spins
  lit: number | null; // pocket to light up once the ball has landed
  deadlineAt: number | undefined;
  seed: string; // the same for every phone at the table and new for every spin
  className?: string;
  style?: CSSProperties;
}) {
  const rotorRef = useRef<SVGGElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const drive = useRef<Drive>({ phase, result, last, deadlineAt, seed, still: false });
  const cache = useRef<Throw>({ spin: null, landing: null });

  useEffect(() => {
    drive.current = { ...drive.current, phase, result, last, deadlineAt, seed };
  }, [phase, result, last, deadlineAt, seed]);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => (drive.current.still = reduce.matches);
    sync();
    reduce.addEventListener("change", sync);
    let raf = 0;
    const frame = () => {
      const d = drive.current;
      const now = Date.now();
      const ball = ballAt(now, d, cache.current);
      if (rotorRef.current) rotorRef.current.style.transform = `rotate(${d.still ? 0 : rotorAt(now)}deg)`;
      // Placed by translation, not rotation, so its highlight stays put as on a lit ball. Height brings it toward the
      // viewer and casts its shadow further down and to the right.
      const rad = (ball.deg * Math.PI) / 180;
      const x = ((ball.r * Math.sin(rad)) / BALL_UNITS) * 100;
      const y = ((-ball.r * Math.cos(rad)) / BALL_UNITS) * 100;
      if (ballRef.current) {
        ballRef.current.style.transform = `translate(${x}%, ${y}%) scale(${1 + ball.z * 0.035})`;
        ballRef.current.style.opacity = `${ball.opacity}`;
      }
      if (shadowRef.current) {
        const dx = ((0.5 + ball.z * 0.45) / BALL_UNITS) * 100;
        const dy = ((0.8 + ball.z * 0.6) / BALL_UNITS) * 100;
        shadowRef.current.style.transform = `translate(${x + dx}%, ${y + dy}%) scale(${1 + ball.z * 0.04})`;
        shadowRef.current.style.opacity = `${ball.opacity * Math.max(0.2, 0.75 - ball.z * 0.06)}`;
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
          const [x, y] = polar(DEFLECTOR_R, a);
          return <path key={a} d="M0 -2.6L1.2 0L0 2.6L-1.2 0Z" transform={`translate(${x} ${y}) rotate(${a})`} className="rl-deflector" />;
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
      <div ref={shadowRef} aria-hidden className="rl-ball-shadow" style={{ opacity: 0 }} />
      <div ref={ballRef} aria-hidden className="rl-ball" style={{ opacity: 0 }} />
    </div>
  );
}
