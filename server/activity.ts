import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActivityEvent, ActivityKind, AdminEvents, AdminStats, DayStats, LiveTable, ModeStats, PlayerStats } from "../lib/admin.ts";
import { ACTIVITY_KINDS } from "../lib/admin.ts";
import { isRoomMode, type RoomMode } from "../lib/protocol.ts";

const KEEP_MS = 180 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const VISIT_ENDS = "('leave','drop','kicked')";

export interface LogInput {
  kind: ActivityKind;
  player?: string;
  name?: string;
  code?: string;
  mode?: RoomMode | null;
  device?: string;
  ms?: number | null;
  detail?: unknown;
  at?: number;
}

export interface EventQuery {
  before?: number;
  player?: string;
  mode?: string;
  kind?: string;
  limit?: number;
}

type Row = Record<string, string | number | null | bigint | Uint8Array>;
const num = (v: Row[string] | undefined) => (typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : 0);
const str = (v: Row[string] | undefined) => (typeof v === "string" ? v : "");
const modeOf = (v: Row[string] | undefined): RoomMode | null => (isRoomMode(v) ? v : null);
const kindOf = (v: Row[string] | undefined): ActivityKind => ACTIVITY_KINDS.find((k) => k === v) ?? "action";

// Everything players do, kept in SQLite so it outlives the in-memory rooms. On Railway the file
// belongs on a volume (RAILWAY_VOLUME_MOUNT_PATH); without one it is lost on every deploy.
export class Activity {
  readonly persistent: boolean;
  private db: DatabaseSync;

  constructor(path: string) {
    let db: DatabaseSync;
    let persistent = path !== ":memory:";
    try {
      if (persistent) mkdirSync(dirname(path), { recursive: true });
      db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode = WAL");
    } catch (err) {
      // Never take the game server down over the log: keep it in memory and say so on /admin.
      console.error(`activity log at ${path} unavailable, keeping it in memory`, err);
      db = new DatabaseSync(":memory:");
      persistent = false;
    }
    db.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      player TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL DEFAULT '',
      mode TEXT,
      device TEXT NOT NULL DEFAULT '',
      ms INTEGER,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS events_at ON events(at);
    CREATE INDEX IF NOT EXISTS events_player ON events(player, id);`);
    this.db = db;
    this.persistent = persistent;
    this.prune();
  }

  log(e: LogInput): void {
    if (!this.db.isOpen) return; // a socket closing while the server shuts down
    try {
      this.db
        .prepare("INSERT INTO events (at, kind, player, name, code, mode, device, ms, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          e.at ?? Date.now(),
          e.kind,
          e.player ?? "",
          e.name ?? "",
          e.code ?? "",
          e.mode ?? null,
          e.device ?? "",
          e.ms === undefined || e.ms === null ? null : Math.max(0, Math.round(e.ms)),
          e.detail === undefined ? null : JSON.stringify(e.detail),
        );
    } catch (err) {
      console.error("activity log write failed", err);
    }
  }

  prune(now = Date.now()): void {
    this.db.prepare("DELETE FROM events WHERE at < ?").run(now - KEEP_MS);
  }

  events(q: EventQuery = {}): AdminEvents {
    const limit = Math.min(Math.max(1, q.limit ?? 100), 500);
    const where: string[] = [];
    const args: (string | number)[] = [];
    const filter = (sql: string, v: string | number | undefined) => {
      if (v === undefined || v === "") return;
      where.push(sql);
      args.push(v);
    };
    filter("id < ?", q.before);
    filter("player = ?", q.player);
    filter("mode = ?", q.mode);
    filter("kind = ?", q.kind);
    const sql = `SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, limit + 1) as Row[];
    return { events: rows.slice(0, limit).map(toEvent), more: rows.length > limit };
  }

  stats(days: number | null, live: LiveTable[], now = Date.now()): AdminStats {
    const from = days === null ? 0 : now - days * DAY_MS;
    const one = (sql: string) => (this.db.prepare(sql).get(from) ?? {}) as Row;
    const all = (sql: string) => this.db.prepare(sql).all(from) as Row[];

    const totals = one(`SELECT
        COUNT(DISTINCT CASE WHEN player <> '' THEN player END) AS players,
        SUM(kind IN ${VISIT_ENDS}) AS visits,
        AVG(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS avgMs,
        SUM(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS totalMs,
        SUM(kind = 'create') AS tables,
        SUM(kind = 'start') AS starts,
        SUM(kind = 'action') AS actions
      FROM events WHERE at >= ?`);

    const modes: ModeStats[] = all(`SELECT mode,
        SUM(kind = 'create') AS tables,
        SUM(kind = 'start') AS starts,
        COUNT(DISTINCT CASE WHEN player <> '' THEN player END) AS players,
        SUM(kind IN ${VISIT_ENDS}) AS visits,
        AVG(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS avgMs,
        SUM(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS totalMs
      FROM events WHERE at >= ? AND mode IS NOT NULL GROUP BY mode ORDER BY totalMs DESC, players DESC`).flatMap((r) => {
      const mode = modeOf(r.mode);
      return mode ? [{ mode, tables: num(r.tables), starts: num(r.starts), players: num(r.players), visits: num(r.visits), avgMs: num(r.avgMs), totalMs: num(r.totalMs) }] : [];
    });

    const topPlayers: PlayerStats[] = all(`SELECT player,
        (SELECT name FROM events n WHERE n.player = e.player AND n.name <> '' ORDER BY id DESC LIMIT 1) AS name,
        (SELECT device FROM events d WHERE d.player = e.player AND d.device <> '' ORDER BY id DESC LIMIT 1) AS device,
        (SELECT mode FROM events f WHERE f.player = e.player AND f.kind IN ${VISIT_ENDS} AND f.at >= ?1
          GROUP BY mode ORDER BY SUM(ms) DESC LIMIT 1) AS favorite,
        SUM(kind IN ${VISIT_ENDS}) AS visits,
        SUM(kind = 'action') AS actions,
        AVG(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS avgMs,
        SUM(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS totalMs,
        MIN(at) AS firstSeen,
        MAX(at) AS lastSeen
      FROM events e WHERE at >= ?1 AND player <> '' GROUP BY player ORDER BY lastSeen DESC LIMIT 200`).map((r) => ({
      player: str(r.player),
      name: str(r.name),
      device: str(r.device),
      visits: num(r.visits),
      actions: num(r.actions),
      avgMs: num(r.avgMs),
      totalMs: num(r.totalMs),
      firstSeen: num(r.firstSeen),
      lastSeen: num(r.lastSeen),
      favorite: modeOf(r.favorite),
    }));

    // The last 14 days (or the window, if shorter), oldest first, with empty days filled in.
    const span = Math.min(days ?? 14, 14);
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS - (span - 1) * DAY_MS;
    const byDay = new Map(
      (this.db.prepare(`SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day,
          COUNT(DISTINCT CASE WHEN player <> '' THEN player END) AS players,
          SUM(kind IN ${VISIT_ENDS}) AS visits,
          SUM(CASE WHEN kind IN ${VISIT_ENDS} THEN ms END) AS totalMs
        FROM events WHERE at >= ? GROUP BY day`).all(dayStart) as Row[]).map((r) => [str(r.day), r]),
    );
    const daily: DayStats[] = Array.from({ length: span }, (_, i) => {
      const day = new Date(dayStart + i * DAY_MS).toISOString().slice(0, 10);
      const r = byDay.get(day);
      return { day, players: num(r?.players), visits: num(r?.visits), totalMs: num(r?.totalMs) };
    });

    const oldest = this.db.prepare("SELECT MIN(at) AS at FROM events").get() as Row | undefined;
    return {
      days,
      players: num(totals.players),
      visits: num(totals.visits),
      avgMs: num(totals.avgMs),
      totalMs: num(totals.totalMs),
      tables: num(totals.tables),
      starts: num(totals.starts),
      actions: num(totals.actions),
      modes,
      topPlayers,
      daily,
      live,
      persistent: this.persistent,
      since: oldest?.at === null || oldest?.at === undefined ? null : num(oldest.at),
    };
  }

  close(): void {
    this.db.close();
  }
}

function toEvent(r: Row): ActivityEvent {
  let detail: unknown = null;
  if (typeof r.detail === "string") {
    try {
      detail = JSON.parse(r.detail);
    } catch {
      detail = r.detail;
    }
  }
  return {
    id: num(r.id),
    at: num(r.at),
    kind: kindOf(r.kind),
    player: str(r.player),
    name: str(r.name),
    code: str(r.code),
    mode: modeOf(r.mode),
    device: str(r.device),
    ms: r.ms === null ? null : num(r.ms),
    detail,
  };
}

// A coarse label from the User-Agent, enough to tell phones from laptops.
export function deviceOf(ua: string | undefined): string {
  if (!ua) return "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}
