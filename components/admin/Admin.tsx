"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import type { ActivityEvent, AdminEvents, AdminStats } from "@/lib/admin";
import { ACTIVITY_KINDS } from "@/lib/admin";
import { ROOM_MODES, type RoomMode } from "@/lib/protocol";
import { httpUrl } from "@/lib/client/rooms";
import { MODE_LABEL } from "@/components/home/OpenTables";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

const CODE_KEY = "flip7:adminCode";
const REFRESH_MS = 15_000;
const WINDOWS = [
  { label: "Today", days: "1" },
  { label: "7 days", days: "7" },
  { label: "30 days", days: "30" },
  { label: "All time", days: "all" },
] as const;
type Window = (typeof WINDOWS)[number]["days"];

class AdminError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// The code is only forwarded; the game server checks it (and rate-limits wrong guesses).
async function adminGet<T>(path: string, code: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${httpUrl()}${path}`, { headers: { Authorization: `Bearer ${code}` }, cache: "no-store", signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new AdminError("Can't reach the game server", 0);
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const msg = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Error ${res.status}`;
    throw new AdminError(msg, res.status);
  }
  return (await res.json()) as T;
}

function readCode(): string {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return memoryCode;
  }
}

const codeListeners = new Set<() => void>();
let memoryCode = "";

function subscribeCode(listener: () => void) {
  codeListeners.add(listener);
  return () => void codeListeners.delete(listener);
}

function writeCode(code: string | null) {
  memoryCode = code ?? "";
  try {
    if (code === null) sessionStorage.removeItem(CODE_KEY);
    else sessionStorage.setItem(CODE_KEY, code);
  } catch {
    // storage blocked: the code lasts for this page load only
  }
  for (const l of codeListeners) l();
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

function ago(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return "just now";
  if (ms < 24 * 3600_000) return `${duration(ms)} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const clock = (ts: number) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const modeName = (m: RoomMode | null) => (m ? MODE_LABEL[m] : "?");
const shortId = (id: string) => id.slice(0, 6);

function humanize(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// "hit", "bet amount 5", ... from a logged intent; everything but the type is shown compactly.
function intentText(detail: unknown): string {
  if (typeof detail !== "object" || detail === null) return "did something";
  const { type, ...rest } = detail as Record<string, unknown>;
  const extra = Object.entries(rest)
    .map(([k, v]) => `${humanize(k)} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
  return `${typeof type === "string" ? humanize(type) : "action"}${extra ? ` (${extra})` : ""}`;
}

function describe(e: ActivityEvent): string {
  const stay = e.ms !== null ? ` after ${duration(e.ms)}` : "";
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "create":
      {
      const name = modeName(e.mode);
      return `opened ${/^[AEIOU]/.test(name) ? "an" : "a"} ${name} table`;
    }
    case "join":
      return `joined ${modeName(e.mode)}`;
    case "rejoin":
      return `came back to ${modeName(e.mode)}`;
    case "start":
      return `${modeName(e.mode)} game started with ${String(d.players ?? "?")} players`;
    case "action":
      return intentText(e.detail);
    case "addBot":
      return `added bot ${String(d.bot ?? "")}`;
    case "leave":
      return `left${stay}`;
    case "drop":
      return `disconnected${stay}`;
    case "kicked":
      return `was removed by the host${stay}`;
  }
}

export function Admin() {
  // null on the server render, "" when logged out.
  const code = useSyncExternalStore(subscribeCode, readCode, () => null);
  const logout = useCallback(() => writeCode(null), []);

  if (code === null) return null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      {code ? (
        <Dashboard code={code} onLogout={logout} />
      ) : (
        <Login
          onIn={(c) => writeCode(c)}
        />
      )}
    </main>
  );
}

function Login({ onIn }: { onIn: (code: string) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminGet<AdminStats>("/admin/stats?days=1", value);
      onIn(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-[18dvh] flex w-full max-w-xs flex-col gap-4">
      <h1 className="text-center font-display text-3xl tracking-wide">Admin</h1>
      <label className="flex flex-col gap-2 text-sm text-muted">
        Code
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          className="min-h-14 rounded-2xl border border-line bg-surface px-4 text-center font-display text-2xl tracking-[0.4em] text-fg outline-none focus:border-accent"
        />
      </label>
      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={busy} disabled={!value}>
        Log in
      </Button>
    </form>
  );
}

function Dashboard({ code, onLogout }: { code: string; onLogout: () => void }) {
  const [win, setWin] = useState<Window>("7");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ player?: { id: string; name: string }; mode?: string; kind?: string }>({});

  useEffect(() => {
    let ctrl: AbortController | null = null;
    async function load() {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        setStats(await adminGet<AdminStats>(`/admin/stats?days=${win}`, code, ctrl.signal));
        setError(null);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof AdminError && e.status === 401) return onLogout();
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    }
    const poll = () => {
      if (!document.hidden) load();
    };
    load();
    const id = setInterval(poll, REFRESH_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
      ctrl?.abort();
    };
  }, [code, win, onLogout]);

  return (
    <>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl tracking-wide">Admin</h1>
        <div role="tablist" aria-label="Time window" className="flex rounded-xl border border-line bg-surface p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              role="tab"
              aria-selected={win === w.days}
              onClick={() => setWin(w.days)}
              className={cx("min-h-9 rounded-lg px-3 text-sm font-semibold", win === w.days ? "bg-accent text-ink" : "text-muted")}
            >
              {w.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={onLogout}>
          Log out
        </Button>
      </header>

      {error && (
        <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          {error}. Retrying…
        </p>
      )}
      {stats && !stats.persistent && (
        <p role="status" className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm">
          The log is only kept in the game server&rsquo;s memory, so it resets on every deploy. Attach a Railway volume to keep it.
        </p>
      )}

      {stats === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <>
          <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label="Players" value={stats.players.toLocaleString()} />
            <Tile label="Avg play time" value={duration(stats.avgMs)} hint="per visit to a table" />
            <Tile label="Total play time" value={duration(stats.totalMs)} />
            <Tile label="Visits" value={stats.visits.toLocaleString()} />
            <Tile label="Tables opened" value={stats.tables.toLocaleString()} hint={`${stats.starts} ${stats.starts === 1 ? "game" : "games"} started`} />
            <Tile label="Moves" value={stats.actions.toLocaleString()} />
          </section>
          <Daily stats={stats} />
          <Live stats={stats} />
          <Games stats={stats} onPick={(mode) => setFilter((f) => ({ ...f, mode }))} />
          <Players stats={stats} onPick={(id, name) => setFilter((f) => ({ ...f, player: { id, name } }))} />
        </>
      )}

      {/* Remounted per filter, so a new filter starts from an empty list. */}
      <Log key={JSON.stringify(filter)} code={code} filter={filter} setFilter={setFilter} onLogout={onLogout} />
    </>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-display text-2xl tabular-nums tracking-wide">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function Daily({ stats }: { stats: AdminStats }) {
  const max = Math.max(1, ...stats.daily.map((d) => d.players));
  const fmt = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return (
    <Section title="Players per day">
      <div className="rounded-2xl border border-line bg-surface px-4 pb-3 pt-4">
        <ul className="flex h-32 items-end gap-[2px]" aria-label="Players per day">
          {stats.daily.map((d) => (
            <li
              key={d.day}
              className="group relative flex h-full flex-1 flex-col justify-end"
              title={`${fmt(d.day)}: ${d.players} players, ${d.visits} visits, ${duration(d.totalMs)} played`}
            >
              <span className="sr-only">{`${fmt(d.day)}: ${d.players} players, ${duration(d.totalMs)} played`}</span>
              <span
                aria-hidden
                className="block rounded-t-[4px] bg-accent/80 transition-colors group-hover:bg-accent"
                style={{ height: d.players ? `${Math.max(4, (d.players / max) * 100)}%` : "2px", opacity: d.players ? 1 : 0.3 }}
              />
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-muted">
          <span>{stats.daily[0] ? fmt(stats.daily[0].day) : ""}</span>
          <span>peak {max}</span>
          <span>{stats.daily.at(-1) ? fmt(stats.daily.at(-1)!.day) : ""}</span>
        </div>
      </div>
    </Section>
  );
}

function Live({ stats }: { stats: AdminStats }) {
  return (
    <Section
      title="Live tables"
      aside={
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-active">
          <span className="size-1.5 rounded-full bg-active" aria-hidden />
          {stats.live.reduce((n, t) => n + t.players.filter((p) => p.online).length, 0)} online
        </span>
      }
    >
      {stats.live.length === 0 ? (
        <p className="rounded-2xl bg-surface/60 px-4 py-5 text-center text-sm text-muted">Nobody is at a table right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stats.live.map((t) => (
            <li key={t.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
              <span className="font-semibold">{MODE_LABEL[t.mode]}</span>
              <span className="tabular-nums text-muted">
                {t.code} · {humanize(t.phase)} · idle {duration(t.idleMs)}
              </span>
              <span className="basis-full text-muted">
                {t.players.map((p, i) => (
                  <span key={i} className={cx(p.online && "text-fg")}>
                    {i > 0 && ", "}
                    {p.name}
                    {!p.online && " (away)"}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Games({ stats, onPick }: { stats: AdminStats; onPick: (mode: string) => void }) {
  if (stats.modes.length === 0) return null;
  return (
    <Section title="By game">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-left text-sm tabular-nums">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Game</th>
              <th className="px-2 py-2 text-right font-medium">Players</th>
              <th className="px-2 py-2 text-right font-medium">Tables</th>
              <th className="px-2 py-2 text-right font-medium">Avg time</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {stats.modes.map((m) => (
              <tr key={m.mode} className="border-t border-line">
                <td className="px-4 py-2">
                  <button type="button" onClick={() => onPick(m.mode)} className="font-semibold underline-offset-2 hover:underline">
                    {MODE_LABEL[m.mode]}
                  </button>
                </td>
                <td className="px-2 py-2 text-right">{m.players}</td>
                <td className="px-2 py-2 text-right">{m.tables}</td>
                <td className="px-2 py-2 text-right">{duration(m.avgMs)}</td>
                <td className="px-4 py-2 text-right">{duration(m.totalMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Players({ stats, onPick }: { stats: AdminStats; onPick: (id: string, name: string) => void }) {
  const [all, setAll] = useState(false);
  if (stats.topPlayers.length === 0) return null;
  const shown = all ? stats.topPlayers : stats.topPlayers.slice(0, 10);
  return (
    <Section title={`Players (${stats.topPlayers.length})`}>
      <ul className="flex flex-col gap-2">
        {shown.map((p) => (
          <li key={p.player}>
            <button
              type="button"
              onClick={() => onPick(p.player, p.name)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm"
            >
              <span className="font-semibold">{p.name || "?"}</span>
              <span className="text-xs text-muted">
                #{shortId(p.player)}
                {p.device && ` · ${p.device}`}
              </span>
              <span className="ml-auto text-xs tabular-nums text-muted">seen {ago(p.lastSeen)}</span>
              <span className="basis-full text-xs tabular-nums text-muted">
                {duration(p.totalMs)} total · {duration(p.avgMs)} avg · {p.visits} visits · {p.actions} moves
                {p.favorite && ` · mostly ${MODE_LABEL[p.favorite]}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {stats.topPlayers.length > 10 && (
        <Button variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${stats.topPlayers.length}`}
        </Button>
      )}
    </Section>
  );
}

type Filter = { player?: { id: string; name: string }; mode?: string; kind?: string };

function Log({ code, filter, setFilter, onLogout }: { code: string; filter: Filter; setFilter: (f: Filter) => void; onLogout: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (before?: number) => {
      const q = new URLSearchParams({ limit: "100" });
      if (before) q.set("before", String(before));
      if (filter.player) q.set("player", filter.player.id);
      if (filter.mode) q.set("mode", filter.mode);
      if (filter.kind) q.set("kind", filter.kind);
      return `/admin/events?${q}`;
    },
    [filter],
  );

  // Newest page, refreshed while the page is open; older pages are appended by "Load more".
  useEffect(() => {
    let ctrl: AbortController | null = null;
    async function load() {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await adminGet<AdminEvents>(query(), code, ctrl.signal);
        setEvents((prev) => {
          if (!prev) return res.events;
          const newest = prev[0]?.id ?? 0;
          return [...res.events.filter((e) => e.id > newest), ...prev];
        });
        setMore((m) => m || res.more);
        setError(null);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof AdminError && e.status === 401) return onLogout();
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    }
    load();
    const id = setInterval(() => !document.hidden && load(), REFRESH_MS);
    return () => {
      clearInterval(id);
      ctrl?.abort();
    };
  }, [code, query, onLogout]);

  async function loadMore() {
    const last = events?.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      const res = await adminGet<AdminEvents>(query(last.id), code);
      setEvents((prev) => [...(prev ?? []), ...res.events]);
      setMore(res.more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const select = "min-h-9 rounded-lg border border-line bg-surface px-2 text-sm text-fg";
  return (
    <Section title="Activity log">
      <div className="flex flex-wrap items-center gap-2">
        {filter.player && (
          <button type="button" onClick={() => setFilter({ ...filter, player: undefined })} className="min-h-9 rounded-lg bg-accent px-3 text-sm font-semibold text-ink">
            {filter.player.name || "?"} #{shortId(filter.player.id)} ✕
          </button>
        )}
        <select aria-label="Game" value={filter.mode ?? ""} onChange={(e) => setFilter({ ...filter, mode: e.target.value || undefined })} className={select}>
          <option value="">All games</option>
          {ROOM_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <select aria-label="Kind" value={filter.kind ?? ""} onChange={(e) => setFilter({ ...filter, kind: e.target.value || undefined })} className={select}>
          <option value="">Everything</option>
          {ACTIVITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === "action" ? "moves" : humanize(k)}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {events === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-surface motion-reduce:animate-none" />
      ) : events.length === 0 ? (
        <p className="rounded-2xl bg-surface/60 px-4 py-5 text-center text-sm text-muted">Nothing logged yet.</p>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 px-4 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3">
              <time className="shrink-0 text-xs tabular-nums text-muted sm:w-32" dateTime={new Date(e.at).toISOString()}>
                {clock(e.at)}
              </time>
              <span className="min-w-0 flex-1 break-words">
                {e.player ? (
                  <button type="button" onClick={() => setFilter({ ...filter, player: { id: e.player, name: e.name } })} className="font-semibold hover:underline">
                    {e.name || "?"}
                  </button>
                ) : null}{" "}
                <span className={cx(e.kind === "action" ? "text-muted" : "text-fg")}>{describe(e)}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {e.mode && MODE_LABEL[e.mode]} {e.code}
              </span>
            </li>
          ))}
        </ol>
      )}
      {more && (
        <Button variant="secondary" onClick={loadMore} loading={busy}>
          Load more
        </Button>
      )}
    </Section>
  );
}
