import assert from "node:assert/strict";
import { test } from "node:test";
import { REST_R, WALL_R, landingPose, makeSpin, mod, planLanding, pocketDeg, rotorAt, spinPose } from "../components/roulette/ballPath.ts";
import { LAND_MS, POCKETS, SPIN_MS } from "../lib/roulette/rules.ts";

const gap = (a: number, b: number) => Math.abs(mod(a - b + 180, 360) - 180);

// Spins across tables and rounds, the first spin of a table (no pocket to lift from), and reveals that reach this
// phone a little early or late against its own spin clock.
const throws = Array.from({ length: 150 }, (_, i) => {
  const seed = `${100000 + i * 7}:${i % 9}`;
  const start = 1_760_000_000_000 + i * 104_729;
  const spin = makeSpin(seed, start, i % 6 === 0 ? null : (POCKETS[(i * 5) % 37] ?? 0));
  const t0 = start + SPIN_MS + ((i % 11) - 5) * 40;
  const target = POCKETS[(i * 13) % 37] ?? 0;
  return { seed, start, spin, t0, target, landing: planLanding(spin, t0, target, seed) };
});

test("the ball always comes to rest in the server's pocket, exactly when the result is shown", () => {
  for (const { t0, target, landing } of throws) {
    const end = t0 + LAND_MS;
    const at = landingPose(landing, end);
    assert.ok(gap(at.deg, rotorAt(end) + pocketDeg(target)) < 1e-6, `pocket ${target}`);
    assert.ok(Math.abs(at.r - REST_R) < 1e-6);
    assert.equal(at.z, 0);
    // Already inside the winning pocket's frets for the last stretch, not sliding in at the buzzer.
    const late = landingPose(landing, end - 120);
    assert.ok(gap(late.deg, rotorAt(end - 120) + pocketDeg(target)) < 360 / 37 / 2, `pocket ${target} before the reveal`);
  }
});

test("the drop picks up exactly where the spin left off and never jumps between frames", () => {
  for (const { start, spin, t0, landing } of throws) {
    const before = spinPose(spin, t0 - start);
    const after = landingPose(landing, t0);
    assert.ok(gap(before.deg, after.deg) < 1e-6 && Math.abs(before.r - after.r) < 1e-6 && Math.abs(before.z - after.z) < 1e-6);
    let prev = spinPose(spin, 0);
    for (let t = start + 8; t <= t0 + LAND_MS + 100; t += 8) {
      const p = t < t0 ? spinPose(spin, t - start) : landingPose(landing, t);
      assert.ok(gap(p.deg, prev.deg) < 9, `angle step ${gap(p.deg, prev.deg)} at ${t - start}`); // ~1.1 deg/ms tops
      assert.ok(Math.abs(p.r - prev.r) < 2.5, `radius step at ${t - start}: ${prev.r} -> ${p.r} (reveal ${t0 - start})`);
      assert.ok(Number.isFinite(p.deg + p.r + p.z) && p.r >= 50 && p.r <= WALL_R + 1 && p.z >= 0);
      prev = p;
    }
  }
});

test("every spin is its own throw, and every phone at the table sees the same one", () => {
  const speeds = new Set(throws.map(({ spin }) => spin.k.toPrecision(8)));
  assert.ok(speeds.size > throws.length * 0.9);
  const contacts = throws.map(({ landing }) => landing.contact);
  assert.ok(Math.max(...contacts) - Math.min(...contacts) > 500, "the drop comes sooner on some spins, later on others");
  assert.ok(throws.some(({ landing }) => landing.deflected) && throws.some(({ landing }) => !landing.deflected));
  const { seed, start, spin, t0, target, landing } = throws[3]!;
  const again = planLanding(makeSpin(seed, start, spin.from), t0, target, seed);
  assert.deepEqual(again.hops, landing.hops);
});
