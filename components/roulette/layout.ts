import { cornerSpot, lineSpot, splitSpot, straightSpot, streetSpot } from "../../lib/roulette/rules.ts";
import type { RlSpot } from "../../lib/roulette/types.ts";

// The number block is 3 columns by 13 rows: the zero row on top, then 12 rows of three (1 2 3 / 4 5 6 / ...).
export const COLS = 3;
export const ROWS = 13;
const EDGE_PX = 11; // a tap this close to a cell edge hits the split/street/corner on that edge

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Which spot a tap at (x, y) inside the w by h number block means.
export function spotAt(x: number, y: number, w: number, h: number): RlSpot {
  const cw = w / COLS;
  const ch = h / ROWS;
  const ci = clamp(Math.floor(x / cw), 0, COLS - 1);
  const ri = clamp(Math.floor(y / ch), 0, ROWS - 1);
  const fx = x - ci * cw;
  const fy = y - ri * ch;
  const edge = Math.min(EDGE_PX, cw * 0.3, ch * 0.3);

  if (ri === 0) return fy > ch - edge ? splitSpot(0, ci + 1) : straightSpot(0);

  const r = ri - 1;
  const n = 3 * r + ci + 1;
  let dx = fx < edge ? -1 : fx > cw - edge ? 1 : 0;
  const dy = fy < edge ? -1 : fy > ch - edge ? 1 : 0;
  if (ci + dx > COLS - 1) dx = 0; // right edge borders the dozens, not another number
  const c2 = ci + dx;
  const r2 = r + dy;
  const aboveFirst = r2 < 0;
  const belowLast = r2 > ROWS - 2;

  if (dx === 0 && dy === 0) return straightSpot(n);
  if (dx === 0) return aboveFirst ? splitSpot(0, n) : belowLast ? straightSpot(n) : splitSpot(n, n + 3 * dy);
  if (c2 < 0) return dy === 0 || aboveFirst || belowLast ? streetSpot(3 * r + 1) : lineSpot(3 * Math.min(r, r2) + 1);
  if (dy === 0) return splitSpot(n, 3 * r + c2 + 1);
  if (aboveFirst) return splitSpot(0, n); // 0/1/2 and 0/2/3 trios aren't on this table
  if (belowLast) return splitSpot(n, 3 * r + c2 + 1);
  return cornerSpot(3 * Math.min(r, r2) + Math.min(ci, c2) + 1);
}

// Where an inside spot's chips sit, in cell units from the number block's top-left (x 0..3, y 0..13).
export function spotCenter(spot: RlSpot): { x: number; y: number } | null {
  const [kind = "", arg = ""] = spot.split(":");
  const cell = (k: number) => ({ x: ((k - 1) % 3) + 0.5, y: Math.floor((k - 1) / 3) + 1.5 });
  switch (kind) {
    case "n": {
      const k = Number(arg);
      return k === 0 ? { x: 1.5, y: 0.5 } : cell(k);
    }
    case "s": {
      const [a = 0, b = 0] = arg.split("-").map(Number);
      if (a === 0) return { x: cell(b).x, y: 1 };
      return { x: (cell(a).x + cell(b).x) / 2, y: (cell(a).y + cell(b).y) / 2 };
    }
    case "t":
      return { x: 0, y: cell(Number(arg)).y };
    case "l":
      return { x: 0, y: cell(Number(arg)).y + 0.5 };
    case "c": {
      const c = cell(Number(arg));
      return { x: c.x + 0.5, y: c.y + 0.5 };
    }
    default:
      return null;
  }
}

export const EVEN_MONEY: readonly { spot: RlSpot; label: string; tone?: "red" | "black" }[] = [
  { spot: "low", label: "1-18" },
  { spot: "even", label: "EVEN" },
  { spot: "red", label: "RED", tone: "red" },
  { spot: "black", label: "BLACK", tone: "black" },
  { spot: "odd", label: "ODD" },
  { spot: "high", label: "19-36" },
];
export const DOZENS: readonly { spot: RlSpot; label: string }[] = [
  { spot: "doz:1", label: "1st 12" },
  { spot: "doz:2", label: "2nd 12" },
  { spot: "doz:3", label: "3rd 12" },
];
export const COLUMNS: readonly RlSpot[] = ["col:1", "col:2", "col:3"];

const NAMES: Record<string, string> = Object.fromEntries([...EVEN_MONEY, ...DOZENS].map((o) => [o.spot, o.label]));

export function spotName(spot: RlSpot): string {
  const named = NAMES[spot];
  if (named) return named;
  const [kind = "", arg = ""] = spot.split(":");
  switch (kind) {
    case "n":
      return `Straight ${arg}`;
    case "s":
      return `Split ${arg.replace("-", " and ")}`;
    case "t":
      return `Street ${arg} to ${Number(arg) + 2}`;
    case "l":
      return `Six line ${arg} to ${Number(arg) + 5}`;
    case "c":
      return `Corner ${arg}`;
    case "col":
      return `Column ${arg}`;
    default:
      return spot;
  }
}
