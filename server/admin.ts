import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LiveTable } from "../lib/admin.ts";
import type { Activity } from "./activity.ts";

export const DEFAULT_ADMIN_CODE = "0001";
const FAILS_PER_IP = 5;
const FAILS_PER_IP_WINDOW_MS = 15 * 60_000;
// A 4-digit code is guessable from many IPs, so all wrong guesses together are capped too. The cost: someone
// spamming wrong codes can lock the real admin out for up to an hour.
const FAILS_GLOBAL = 50;
const FAILS_GLOBAL_WINDOW_MS = 60 * 60_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

export interface AdminDeps {
  code: string;
  activity: Activity;
  live: () => LiveTable[];
}

// GET /admin/stats and /admin/events, authorized by `Authorization: Bearer <code>`. The code check lives
// here on the server only; the page just forwards what was typed.
export function adminRoutes(deps: AdminDeps) {
  const want = digest(deps.code);
  const failsByIp = new Map<string, { count: number; windowStart: number }>();
  let global = { count: 0, windowStart: 0 };

  function locked(ip: string, now: number): boolean {
    if (now - global.windowStart >= FAILS_GLOBAL_WINDOW_MS) global = { count: 0, windowStart: now };
    const w = failsByIp.get(ip);
    if (w && now - w.windowStart >= FAILS_PER_IP_WINDOW_MS) failsByIp.delete(ip);
    return global.count >= FAILS_GLOBAL || (failsByIp.get(ip)?.count ?? 0) >= FAILS_PER_IP;
  }

  function failed(ip: string, now: number) {
    global.count++;
    const w = failsByIp.get(ip);
    if (w) w.count++;
    else failsByIp.set(ip, { count: 1, windowStart: now });
  }

  function prune(now = Date.now()) {
    for (const [ip, w] of failsByIp) if (now - w.windowStart >= FAILS_PER_IP_WINDOW_MS) failsByIp.delete(ip);
  }

  // Returns false when the path isn't an admin route, so the caller can 404 it.
  function handle(req: IncomingMessage, res: ServerResponse, path: string, ip: string): boolean {
    if (path !== "/admin/stats" && path !== "/admin/events") return false;
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(body));
    if (req.method !== "GET") {
      json(405, { error: "Method not allowed" });
      return true;
    }
    const now = Date.now();
    if (locked(ip, now)) {
      json(429, { error: "Too many wrong codes, try again later" });
      return true;
    }
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!timingSafeEqual(digest(given), want)) {
      failed(ip, now);
      json(401, { error: "Wrong code" });
      return true;
    }
    const q = new URL(req.url ?? "/", "http://x").searchParams;
    if (path === "/admin/stats") {
      const raw = q.get("days");
      const days = raw === null || raw === "all" ? null : Math.max(1, Math.min(3650, Number(raw) || 7));
      json(200, deps.activity.stats(days, deps.live(), now));
    } else {
      const before = Number(q.get("before"));
      json(200, deps.activity.events({
        before: Number.isFinite(before) && before > 0 ? before : undefined,
        player: q.get("player") ?? undefined,
        mode: q.get("mode") ?? undefined,
        kind: q.get("kind") ?? undefined,
        limit: Number(q.get("limit")) || undefined,
      }));
    }
    return true;
  }

  return { handle, prune };
}
