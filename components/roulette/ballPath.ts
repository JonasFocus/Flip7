import { LAND_MS, POCKETS, SPIN_MS } from "../../lib/roulette/rules.ts";

// The roulette ball as a small, seeded physics model in wheel units (the wheel's viewBox is 200 wide, angles are
// clockwise degrees from the top, time is local ms). The server picks the pocket; this only decides how the ball gets
// there. Every spin draws its own launch speed, slowdown, wobble on the track, drop, deflector hit and bounces from a
// seed the whole table shares, and the landing always ends exactly on the server's pocket.

export const STEP = 360 / POCKETS.length;
export const ROTOR_DEG_PER_MS = 0.06; // the rotor turns clockwise; the ball runs against it
export const WALL_R = 89.3; // ball centre riding against the outer wall of the track
export const RIM_R = 76.5; // where the ball reaches the rotor's frets
export const REST_R = 57.5; // ball centre at rest in a pocket, inside the printed number
export const DEFLECTOR_R = 84;
export const DEFLECTORS = Array.from({ length: 8 }, (_, i) => i * 45 + 22.5);

const LIFT_MS = 450; // the croupier lifts the ball out of the last pocket before launching it
const FADE_MS = 250; // first spin of a table: the ball fades in on the track instead
const TRACK_Z = 1.8; // the track sits above the rotor, so the ball looks a touch closer up there
const G = 0.0012; // gravity in wheel units per ms², slowed a little so hops read on a phone
const DT = 2; // sample step for the stretch before the ball reaches the rotor
const CANDIDATES = 200;

export interface BallPose {
  deg: number;
  r: number;
  z: number; // height above the pocket floor in wheel units, drives scale and shadow
  opacity: number;
}

export const mod = (a: number, b: number) => ((a % b) + b) % b;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const smooth = (v: number) => clamp01(v) ** 2 * (3 - 2 * clamp01(v));
const wrap180 = (a: number) => mod(a + 180, 360) - 180;
export const rotorAt = (now: number) => mod(now * ROTOR_DEG_PER_MS, 360);
export const pocketDeg = (n: number) => POCKETS.indexOf(n) * STEP;
const trackZ = (r: number) => TRACK_Z * smooth((r - RIM_R) / (82 - RIM_R));

type Rng = () => number;
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
// mulberry32: small, fast and identical on every device, which is all a visual path needs.
function rngFor(key: string): Rng {
  let a = hash(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

// ==== On the track, result still hidden ====
// Rolling friction plus air drag: dω/dt = -(a + bω²), so the ball sheds speed fast while it is quick and lingers as it
// slows. Its closed form keeps the pose a pure function of time: ω(u) = tan(α0 - ku) / s.
export interface Spin {
  start: number; // local ms the spin began
  lift: number; // ms spent lifting the ball out of the last pocket (0 on a table's first spin)
  from: number | null;
  launch: number; // fixed-frame angle where the ball leaves the croupier's hand
  s: number;
  k: number;
  alpha0: number;
  wHi: number; // above this speed the ball is pinned to the wall
  wDrop: number; // speed at the reveal, when it is about to leave the track
  drift: number; // how far it sinks down the track by then
  wobble: number;
  wobbleHz: number;
  wobblePhase: number;
}

export function makeSpin(seed: string, start: number, from: number | null): Spin {
  const rng = rngFor(`spin:${seed}`);
  const w0 = between(rng, 0.7, 1.0); // 1.9 to 2.8 laps a second at launch
  const wDrop = between(rng, 0.26, 0.34);
  const s = between(rng, 2.5, 7); // low: mostly friction, an even slowdown; high: drag, a fast start that fades
  const spot = rng() * 360;
  const drift = between(rng, 1.8, 3);
  const wobble = between(rng, 0.25, 0.75);
  const wobbleHz = between(rng, 0.9, 1.8);
  const wobblePhase = rng() * Math.PI * 2;
  const lift = from === null ? 0 : LIFT_MS;
  const alpha0 = Math.atan(s * w0);
  const k = (alpha0 - Math.atan(s * wDrop)) / (SPIN_MS - lift);
  const launch = from === null ? spot : rotorAt(start + lift) + pocketDeg(from);
  return { start, lift, from, launch, s, k, alpha0, wHi: Math.min(0.42, w0), wDrop, drift, wobble, wobbleHz, wobblePhase };
}

const rollAngle = (sp: Spin, u: number) => sp.alpha0 - sp.k * Math.min(u, (sp.alpha0 - 0.05) / sp.k);
export const spinSpeed = (sp: Spin, e: number) => (e < sp.lift ? 0 : Math.tan(rollAngle(sp, e - sp.lift)) / sp.s);

export function spinPose(sp: Spin, e: number): BallPose {
  e = Math.max(0, e);
  if (e < sp.lift && sp.from !== null) {
    const x = e / sp.lift;
    const r = REST_R + (WALL_R - REST_R) * smooth(x);
    return { deg: rotorAt(sp.start + e) + pocketDeg(sp.from), r, z: trackZ(r) + 5 * Math.sin(Math.PI * x), opacity: 1 };
  }
  const u = e - sp.lift;
  const travel = Math.log(Math.cos(rollAngle(sp, u)) / Math.cos(sp.alpha0)) / (sp.s * sp.k);
  const w = Math.tan(rollAngle(sp, u)) / sp.s;
  // On a banked track the ball rides higher the faster it goes: it hugs the wall, then sinks and wanders as it slows.
  const sink = clamp(((sp.wHi / w) ** 2 - 1) / ((sp.wHi / sp.wDrop) ** 2 - 1), 0, 1.4);
  const r = WALL_R - sp.drift * sink + sp.wobble * sink * Math.sin((u / 1000) * 2 * Math.PI * sp.wobbleHz + sp.wobblePhase);
  return { deg: sp.launch - travel, r, z: trackZ(r), opacity: sp.from === null ? clamp01(e / FADE_MS) : 1 };
}

// ==== Drop, bounce and settle, result known ====
interface Hop {
  t: number;
  T: number;
  phi: number; // angle relative to the rotor at take-off
  w: number; // deg/ms relative to the rotor while airborne
  r0: number;
  r1: number;
  vz: number;
}

export interface Landing {
  t0: number; // local ms the reveal arrived
  target: number;
  deg: Float64Array; // fixed-frame samples every DT ms until the ball meets the rotor
  r: Float64Array;
  z: Float64Array;
  contact: number; // ms after t0
  hops: Hop[];
  settle: { t: number; phi: number; w: number; r: number; vr: number; phiEnd: number };
  deflected: boolean;
  shift: number; // degrees nudged into the last stretch on the track to reach the pocket
}

interface Throw extends Landing {
  c: number;
  miss: number; // pockets between where this throw comes to rest and the winning one
  ok: boolean; // enough bounces, and a settle that is neither rushed nor dragging
}

function simulate(sp: Spin, t0: number, target: number, seed: string, c: number, shift: number): Throw {
  const rng = rngFor(`land:${seed}:${c}`);
  const roll = between(rng, 150, 1050); // how much longer it circles before it leaves the track
  const sink = between(rng, 0.6, 1.6);
  const slope = between(rng, 0.0002, 0.00032); // pull down the apron
  const glance = between(rng, 0.3, 0.6); // speed kept after a deflector
  const bounceOut = between(rng, 0.012, 0.03);
  const bounceUp = between(rng, 0.06, 0.1);
  const restitution = between(rng, 0.42, 0.62);
  const grip = between(rng, 0.12, 0.26); // how much forward speed a fret turns into a hop
  const impact = between(rng, 0.08, 0.12);
  const hopRng = rngFor(`hops:${seed}:${c}`);

  const e0 = t0 - sp.start;
  const ramp = roll + 100;
  const deg: number[] = [];
  const rad: number[] = [];
  const zz: number[] = [];
  let t = 0;
  let theta = 0; // physical angle; the drawn one adds the shift
  let r = 0;
  let vr = 0;
  let w = 0; // ball speed in the fixed frame, positive against the rotor
  let momentum = 0; // w·r, kept as it spirals down the bowl, so it speeds up on the way in
  let falling = false;
  let checked = false;
  let deflected = false;
  let hopAt = -1;
  for (; ; t += DT) {
    let z: number;
    if (t < roll) {
      const p = spinPose(sp, e0 + t);
      theta = p.deg;
      r = p.r - sink * (t / roll) ** 2;
      z = trackZ(r);
    } else {
      if (!falling) {
        // Leaves the track carrying the speed and inward drift it had, so the hand-off has no corner.
        const p = spinPose(sp, e0 + t);
        falling = true;
        theta = p.deg;
        r = p.r - sink * (t / roll) ** 2;
        w = spinSpeed(sp, e0 + t);
        vr = (-2 * sink * t) / roll ** 2;
        momentum = w * r;
      } else {
        vr -= slope * DT;
        r += vr * DT;
        w = momentum / r;
        theta -= w * DT;
      }
      const shown = theta + shift * smooth(t / ramp);
      if (!checked && r <= DEFLECTOR_R) {
        checked = true;
        const near = Math.min(...DEFLECTORS.map((d) => Math.abs(wrap180(shown - d))));
        if ((near * Math.PI * r) / 180 < 5) {
          deflected = true;
          w *= glance;
          momentum = w * r;
          vr = bounceOut;
          hopAt = t;
        }
      }
      const air = hopAt < 0 ? 0 : bounceUp * (t - hopAt) - (G / 2) * (t - hopAt) ** 2;
      if (air <= 0 && hopAt >= 0 && t > hopAt) hopAt = -1;
      r = Math.max(r, RIM_R);
      z = trackZ(r) + Math.max(0, air);
      if ((r <= RIM_R && hopAt < 0) || t > 3000) {
        deg.push(shown);
        rad.push(r);
        zz.push(0);
        break;
      }
    }
    deg.push(theta + shift * smooth(t / ramp));
    rad.push(r);
    zz.push(z);
  }

  // On the rotor. While it still has height the ball rebounds off the pocket floor; once the hops die down it skids to
  // the next fret, and each fret strike turns some of its forward speed into a fresh hop, now and then knocking it
  // back the way it came. It is caught when it no longer has the speed to reach the next fret.
  const contact = t;
  const thetaC = deg[deg.length - 1] ?? 0;
  let phi = thetaC - rotorAt(t0 + contact);
  let rel = -w - ROTOR_DEG_PER_MS;
  let rr = RIM_R;
  let vin = impact;
  let vrOut = 0;
  let strike = true; // the drop onto the frets counts as one
  const hops: Hop[] = [];
  const budget = LAND_MS - 300;
  for (let i = 0; i < 40; i++) {
    if (!strike) {
      // The next fret strictly ahead; after a strike the ball sits right on the one it just hit.
      const x = phi / STEP - 0.5; // frets sit halfway between pocket centres
      const fret = (rel > 0 ? Math.floor(x + 1e-6) + 1.5 : Math.ceil(x - 1e-6) - 0.5) * STEP;
      const T = Math.abs(fret - phi) / Math.max(Math.abs(rel), 1e-6);
      if (T > 220 || t + T > budget) break;
      const r1 = rr + (REST_R + 4 - rr) * (1 - Math.exp(-T / 200)); // rolling down toward the pocket's inner end
      hops.push({ t, T, phi, w: rel, r0: rr, r1, vz: 0 });
      vrOut = (r1 - rr) / T;
      phi = fret;
      rr = r1;
      t += T;
      rel *= between(hopRng, 0.86, 0.97);
      vin = 0;
    }
    const vt = (Math.abs(rel) * rr * Math.PI) / 180;
    const vz = restitution * vin * between(hopRng, 0.85, 1.1) + (strike || vin === 0 ? grip * vt * between(hopRng, 0.3, 1) : 0);
    const kick = vin === 0 && hopRng() < 0.18 ? -between(hopRng, 0.15, 0.5) : between(hopRng, vin === 0 ? 0.55 : 0.8, 0.92);
    const T = (2 * vz) / G;
    const reach = 0.05 * T; // sideways speed a hop can carry
    const r1 = clamp(rr + clamp(between(hopRng, -6, 6) + 0.3 * (REST_R + 5 - rr), -reach, reach), 55, 74);
    strike = false;
    if (vz < 0.012 || t + T > budget) continue;
    rel *= kick;
    hops.push({ t, T, phi, w: rel, r0: rr, r1, vz });
    phi += rel * T;
    vrOut = (r1 - rr) / T;
    rr = r1;
    vin = vz * restitution >= 0.035 ? vz : 0; // still lively: straight into another rebound
    strike = vin > 0;
    t += T;
  }
  const left = LAND_MS - t;

  const rests = phi + rel * 90; // where it would roll to a stop
  const at = mod(Math.round(mod(rests, 360) / STEP), POCKETS.length);
  const want = POCKETS.indexOf(target);
  const miss = mod(want - at + 18, POCKETS.length) - 18;
  const phiEnd = rests + wrap180(want * STEP - rests);
  return {
    t0,
    target,
    deg: Float64Array.from(deg),
    r: Float64Array.from(rad),
    z: Float64Array.from(zz),
    contact,
    hops,
    settle: { t, phi, w: rel, r: rr, vr: vrOut, phiEnd },
    deflected,
    shift,
    c,
    miss,
    ok: hops.filter((h) => h.vz > 0).length >= 3 && left >= 280 && left <= 900,
  };
}

// Tries a batch of seeded throws and keeps one that naturally comes to rest in the winning pocket. When none does,
// the closest one has the difference eased into its last stretch on the track, a few percent of its speed at most,
// and is checked again because a shifted ball can meet a deflector differently.
export function planLanding(sp: Spin, t0: number, target: number, seed: string): Landing {
  const tries: Throw[] = [];
  for (let c = 0; c < CANDIDATES; c++) {
    const a = simulate(sp, t0, target, seed, c, 0);
    if (!a.ok) continue;
    if (a.miss === 0) return a;
    tries.push(a);
  }
  tries.sort((a, b) => Math.abs(a.miss) - Math.abs(b.miss));
  for (const a of tries.slice(0, 12)) {
    const b = simulate(sp, t0, target, seed, a.c, a.miss * STEP);
    if (b.ok && b.miss === 0) return b;
  }
  // Practically unreachable; the settle still pulls the ball into the winning pocket.
  return tries[0] ?? simulate(sp, t0, target, seed, 0, 0);
}

export function landingPose(l: Landing, now: number): BallPose {
  const t = Math.max(0, now - l.t0);
  if (t < l.contact) {
    const x = t / DT;
    const i = Math.floor(x);
    const f = x - i;
    const at = (a: Float64Array) => (a[i] ?? 0) + ((a[i + 1] ?? a[i] ?? 0) - (a[i] ?? 0)) * f;
    return { deg: at(l.deg), r: at(l.r), z: at(l.z), opacity: 1 };
  }
  const rotor = rotorAt(now);
  for (const h of l.hops) {
    if (t >= h.t + h.T) continue;
    const u = t - h.t;
    return { deg: rotor + h.phi + h.w * u, r: h.r0 + ((h.r1 - h.r0) * u) / h.T, z: Math.max(0, h.vz * u - (G / 2) * u * u), opacity: 1 };
  }
  // In the pocket: it rocks against the frets and rolls down to the inner edge, a damped spring that is exactly still
  // by LAND_MS. The spring starts with the ball's own speed, so there is no snap when the last hop ends.
  const s = l.settle;
  const span = LAND_MS - s.t;
  const u = t - s.t;
  if (u >= span) return { deg: rotor + s.phiEnd, r: REST_R, z: 0, opacity: 1 };
  const fade = 1 - smooth(u / span);
  // Across the pocket it rocks between the two frets; along it, it simply rolls down to the inner end.
  const om = (2 * Math.PI) / 180;
  const a = s.phi - s.phiEnd;
  const rock = Math.exp(-u / 95) * (a * Math.cos(om * u) + ((s.w + a / 95) / om) * Math.sin(om * u));
  const b = s.r - REST_R;
  const roll = Math.exp(-u / 140) * (b + (s.vr + b / 140) * u);
  return { deg: rotor + s.phiEnd + rock * fade, r: REST_R + roll * fade, z: 0, opacity: 1 };
}
