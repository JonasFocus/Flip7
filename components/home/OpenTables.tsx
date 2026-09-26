"use client";

import { useEffect, useState } from "react";
import type { RoomSummary } from "@/lib/protocol";
import { fetchOpenRooms } from "@/lib/client/rooms";
import { Badge } from "@/components/ui/Badge";

const POLL_MS = 5000;

type Load = { rooms: RoomSummary[] | null; error: string | null };

function ago(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

export function OpenTables({ onJoin }: { onJoin: (code: string) => void }) {
  const [load, setLoad] = useState<Load>({ rooms: null, error: null });

  useEffect(() => {
    let ctrl: AbortController | null = null;
    async function load() {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const rooms = await fetchOpenRooms(ctrl.signal);
        setLoad({ rooms: rooms.filter((r) => r.joinable), error: null });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        const error = navigator.onLine ? "Can't reach the game server" : "You're offline";
        setLoad((prev) => ({ rooms: prev.rooms, error }));
      }
    }
    const poll = () => {
      if (!document.hidden) load();
    };
    load();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", poll);
      ctrl?.abort();
    };
  }, []);

  const { rooms, error } = load;

  return (
    <section aria-labelledby="tables-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="tables-title" className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
          Open tables
        </h2>
        {!error && rooms && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-active">
            <span className="size-1.5 rounded-full bg-active" aria-hidden />
            Live
          </span>
        )}
      </div>

      {error && (
        <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          {error}. Retrying…
        </p>
      )}

      {rooms === null && !error && (
        <ul aria-label="Loading tables" className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <li key={i} className="h-16 animate-pulse rounded-2xl bg-surface motion-reduce:animate-none" />
          ))}
        </ul>
      )}

      {rooms?.length === 0 && !error && (
        <p className="rounded-2xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted">
          No open tables right now. Start one and share the code.
        </p>
      )}

      {rooms && rooms.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rooms.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => onJoin(r.code)}
                className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.hostName}&rsquo;s table</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <Badge tone={r.mode === "virtual" ? "accent" : "neutral"}>
                      {r.mode === "virtual" ? "Online" : "Scorekeeper"}
                    </Badge>
                    <span className="tabular-nums">
                      {r.playerCount} {r.playerCount === 1 ? "player" : "players"} · {ago(r.lastActive)}
                    </span>
                  </span>
                </span>
                <span className="font-display text-sm tracking-wider text-accent">Join</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
