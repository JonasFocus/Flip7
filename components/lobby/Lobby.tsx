"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { success, tap } from "@/lib/client/haptics";
import type { TableConnection } from "@/lib/client/types";
import type { Player } from "@/lib/engine/types";
import { MAX_PLAYERS } from "@/lib/protocol";
import { MicroLabel } from "./Screens";

const noopSubscribe = () => () => {};

export function Lobby({ conn }: { conn: TableConnection }) {
  const { game, you, isHost } = conn;
  const [toast, setToast] = useState<string | null>(null);
  const me = game.players.find((p) => p.id === you);
  const host = game.players.find((p) => p.id === conn.hostId);
  const full = game.players.length >= MAX_PLAYERS;

  const [armedId, setArmedId] = useState<string | null>(null);
  const wasHost = useRef(isHost);

  useEffect(() => {
    if (isHost && !wasHost.current) setToast("You're the host now");
    wasHost.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(t);
  }, [armedId]);

  const others = game.players.filter((p) => !p.isBot && p.id !== you);
  const offline = others.filter((p) => !p.connected);
  const waitingOn = others.filter((p) => !p.ready);
  // Mirrors the engine: offline humans block start, unready ones don't (the host can say "go").
  const blocker =
    game.players.length < 2
      ? "Add a bot or invite someone to start"
      : offline.length > 0
        ? `${names(offline)} ${offline.length === 1 ? "is" : "are"} offline. Remove them to start`
        : null;
  const hostStatus = blocker ?? (waitingOn.length > 0 ? `${names(waitingOn)} not ready yet. You can still start` : "Everyone's in. Let's flip!");

  function remove(id: string) {
    tap();
    if (armedId !== id) return setArmedId(id);
    setArmedId(null);
    conn.removePlayer(id);
  }

  function start() {
    success();
    if (me && !me.ready) conn.send({ type: "ready", ready: true });
    conn.send({ type: "start" });
  }

  function toggleReady() {
    tap();
    conn.send({ type: "ready", ready: !me?.ready });
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md grid-rows-[auto_auto_1fr_auto] gap-x-8 px-4 pt-safe-2 select-none [@media(max-height:500px)]:h-dvh [@media(max-height:500px)]:max-w-3xl [@media(max-height:500px)]:grid-cols-2 [@media(max-height:500px)]:grid-rows-[auto_1fr_auto]">
      <h1 className="sr-only">{conn.code ? `Table ${conn.code} lobby` : "Lobby"}</h1>
      <Toast message={toast ?? conn.error} tone={toast ? "accent" : "danger"} onDismiss={() => setToast(null)} />

      <header className="flex items-center justify-between py-2 [@media(max-height:500px)]:col-span-2">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={conn.leave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <p className="rounded-full border border-line px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
          First to <span className="font-display text-fg tabular-nums">{game.goal}</span>
        </p>
      </header>

      <section className="flex flex-col items-center gap-4 pt-4 pb-8 [@media(max-height:500px)]:col-start-1 [@media(max-height:500px)]:gap-2 [@media(max-height:500px)]:pt-0 [@media(max-height:500px)]:justify-center [@media(max-height:500px)]:pb-4">
        {conn.code && <InviteHero code={conn.code} onToast={setToast} />}
      </section>

      <section aria-labelledby="seats" className="min-h-0 [@media(max-height:500px)]:col-start-2 [@media(max-height:500px)]:row-span-2 [@media(max-height:500px)]:row-start-2 [@media(max-height:500px)]:overflow-y-auto [@media(max-height:500px)]:pb-safe-4">
        <div className="mb-2 flex items-center justify-between">
          <MicroLabel>
            <span id="seats">Players</span> <span className="tabular-nums">{game.players.length}/{MAX_PLAYERS}</span>
          </MicroLabel>
          {isHost && (
            <Button variant="ghost" size="sm" className="-mr-3" disabled={full} onClick={() => (tap(), conn.addBot())}>
              {full ? "Full" : "+ Bot"}
            </Button>
          )}
        </div>
        <ol className="flex flex-col gap-2">
          {game.players.map((p, i) => (
            <Seat
              key={p.id}
              player={p}
              seat={i + 1}
              isYou={p.id === you}
              isHost={i === hostIndex(conn)}
              canRemove={isHost && p.id !== you}
              armed={armedId === p.id}
              onRemove={() => remove(p.id)}
            />
          ))}
        </ol>
      </section>

      <footer className="sticky bottom-0 -mx-4 mt-6 flex flex-col gap-3 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4 [@media(max-height:500px)]:static [@media(max-height:500px)]:col-start-1 [@media(max-height:500px)]:row-start-3 [@media(max-height:500px)]:mx-0 [@media(max-height:500px)]:mt-0 [@media(max-height:500px)]:px-0 [@media(max-height:500px)]:pt-0">
        {isHost ? (
          <>
            <p aria-live="polite" className="min-h-5 text-center text-sm text-muted">
              {hostStatus}
            </p>
            <Button size="lg" block disabled={blocker !== null} onClick={start}>
              Start game
            </Button>
          </>
        ) : (
          <>
            <p aria-live="polite" className="min-h-5 text-center text-sm text-muted">
              {me?.ready ? `Waiting for ${host?.name ?? "the host"} to start…` : "Tap ready when you're set"}
            </p>
            <Button size="lg" block variant={me?.ready ? "secondary" : "primary"} aria-pressed={me?.ready ?? false} onClick={toggleReady}>
              {me?.ready ? "Ready ✓" : "I'm ready"}
            </Button>
          </>
        )}
      </footer>
    </main>
  );
}

function hostIndex(conn: TableConnection): number {
  return conn.game.players.findIndex((p) => p.id === conn.hostId);
}

function names(players: Player[]): string {
  const list = players.map((p) => p.name);
  return list.length <= 2 ? list.join(" & ") : `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

// Native share sheet, falling back to copying the link. Returns a message to show, or null.
export async function shareInvite(code: string): Promise<string | null> {
  const url = `${location.origin}/room/${code}`;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Flip 7", text: `Join my table on Flip 7: code ${code}`, url });
      return null;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "Invite link copied";
  } catch {
    return `Share code ${code}`;
  }
}

export function InviteHero({ code, onToast }: { code: string; onToast: (m: string) => void }) {
  const host = useSyncExternalStore(noopSubscribe, () => location.host, () => "");

  async function share() {
    tap();
    const msg = await shareInvite(code);
    if (msg) onToast(msg);
  }

  return (
    <>
      <MicroLabel className="[@media(max-height:500px)]:hidden">Room code</MicroLabel>
      <p aria-label={`Room code ${code.split("").join(" ")}`} className="flex gap-1.5 max-[359px]:gap-1">
        {code.split("").map((d, i) => (
          <span
            key={i}
            aria-hidden
            className={cx(
              "grid h-16 w-12 place-items-center rounded-xl border-2 border-line bg-surface font-display text-4xl tabular-nums text-accent shadow-hard animate-pop max-[359px]:h-14 max-[359px]:w-10 max-[359px]:text-3xl [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-10 [@media(max-height:500px)]:text-3xl",
              i === 3 && "ml-2",
            )}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            {d}
          </span>
        ))}
      </p>
      <Button variant="secondary" onClick={share} className="mt-2">
        Share invite
      </Button>
      {host && (
        <p className="max-w-full truncate text-xs text-muted select-text [@media(max-height:500px)]:hidden">
          {host}/room/{code}
        </p>
      )}
    </>
  );
}

function Seat({
  player,
  seat,
  isYou,
  isHost,
  canRemove,
  armed,
  onRemove,
}: {
  player: Player;
  seat: number;
  isYou: boolean;
  isHost: boolean;
  canRemove: boolean;
  armed: boolean;
  onRemove: () => void;
}) {
  const offline = !player.isBot && !player.connected;
  return (
    <li
      className={cx(
        "flex min-h-16 items-center gap-3 rounded-2xl border bg-surface px-3 animate-pop",
        isYou ? "border-accent/60" : "border-line",
      )}
    >
      <span className="w-6 text-center font-display text-xs text-muted tabular-nums">P{seat}</span>
      <span className="relative">
        <Avatar id={player.id} seat={seat - 1} name={player.name} isBot={player.isBot} />
        {!player.isBot && (
          <span
            aria-hidden
            className={cx("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface", offline ? "bg-muted/60" : "bg-active")}
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{player.name}</span>
          {isHost && <CrownIcon />}
        </span>
        <span className="block text-xs text-muted">
          {isYou ? "You" : player.isBot ? "Bot" : offline ? "Offline" : isHost ? "Host" : "Player"}
          {isHost && isYou && " · Host"}
        </span>
      </span>
      <ReadyPill player={player} isHost={isHost} />
      {canRemove && (
        <button
          type="button"
          aria-label={armed ? `Confirm remove ${player.name}` : `Remove ${player.name}`}
          onClick={onRemove}
          className={cx(
            "-mr-1 grid h-11 min-w-11 place-items-center rounded-xl transition-colors",
            armed
              ? "bg-danger px-3 text-xs font-bold uppercase tracking-[0.14em] text-ink"
              : "text-xl text-muted active:bg-surface-2 active:text-danger",
          )}
        >
          {armed ? "Remove?" : "×"}
        </button>
      )}
    </li>
  );
}

function ReadyPill({ player, isHost }: { player: Player; isHost: boolean }) {
  if (isHost || player.isBot) return null;
  return player.ready ? (
    <span className="rounded-full bg-active/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-active">Ready</span>
  ) : (
    <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Not ready</span>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 flex-none text-accent" fill="currentColor" role="img" aria-label="Host">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
    </svg>
  );
}
