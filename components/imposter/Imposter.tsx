"use client";

import { useEffect, useState, type ReactNode } from "react";
import { InviteHero } from "@/components/lobby/Lobby";
import { MicroLabel } from "@/components/lobby/Screens";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { success, tap } from "@/lib/client/haptics";
import type { ImposterConnection } from "@/lib/client/types";
import { CATEGORIES, MAX_IMPOSTER_PLAYERS, MIN_IMPOSTER_PLAYERS } from "@/lib/imposter";
import type { ImposterPlayer, ImposterTimer } from "@/lib/imposter/types";
import { Clues, Voting } from "./Round";
import { GameOver, Reveal } from "./Result";

const TIMERS: { sec: ImposterTimer; label: string }[] = [
  { sec: 90, label: "90s" },
  { sec: 120, label: "2 min" },
  { sec: 300, label: "5 min" },
];

export function Imposter({ conn }: { conn: ImposterConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const { phase } = conn.game;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-safe-2 select-none">
      <Toast message={toast ?? conn.error} tone={toast ? "accent" : "danger"} onDismiss={() => setToast(null)} />
      <header className="flex items-center justify-between py-2">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={conn.leave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <p className="rounded-full border border-line px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
          Imposter
        </p>
      </header>
      {phase === "lobby" && <ImposterLobby conn={conn} onToast={setToast} />}
      {phase === "clues" && <Clues conn={conn} />}
      {phase === "voting" && <Voting conn={conn} />}
      {phase === "reveal" && <Reveal conn={conn} />}
      {phase === "gameOver" && <GameOver conn={conn} />}
    </main>
  );
}

export function hostName(conn: ImposterConnection): string {
  return conn.game.players.find((p) => p.id === conn.hostId)?.name ?? "the host";
}

export function nameOf(conn: ImposterConnection, id: string | null): string {
  if (id === conn.you) return "You";
  return conn.game.players.find((p) => p.id === id)?.name ?? "Someone";
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4">
      {children}
    </footer>
  );
}

export function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="min-h-5 text-center text-sm text-muted">
      {children}
    </p>
  );
}

export function PlayerRow({
  conn,
  player,
  children,
  className,
}: {
  conn: ImposterConnection;
  player: ImposterPlayer;
  children?: ReactNode;
  className?: string;
}) {
  const seat = conn.game.players.findIndex((p) => p.id === player.id);
  return (
    <span className={cx("flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-surface px-3", player.eliminated && "opacity-40 grayscale", className)}>
      <span className="relative">
        <Avatar id={player.id} seat={seat} name={player.name} />
        <span
          aria-hidden
          className={cx("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface", player.connected ? "bg-active" : "bg-muted/60")}
        />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{player.name}</span>
          {player.id === conn.hostId && <CrownIcon />}
        </span>
        <span className="block text-xs text-muted">
          {[player.id === conn.you && "You", player.id === conn.hostId && "Host", !player.connected && "Offline", player.eliminated && "Out"]
            .filter(Boolean)
            .join(" · ") || "Player"}
        </span>
      </span>
      {children}
    </span>
  );
}

function ImposterLobby({ conn, onToast }: { conn: ImposterConnection; onToast: (m: string) => void }) {
  const { game, isHost } = conn;
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(t);
  }, [armedId]);

  const categoryName = game.categoryId === "random" ? "Random" : (CATEGORIES.find((c) => c.id === game.categoryId)?.name ?? "Random");
  const timerLabel = TIMERS.find((t) => t.sec === game.timerSec)?.label ?? `${game.timerSec}s`;
  const missing = MIN_IMPOSTER_PLAYERS - game.players.length;

  function remove(id: string) {
    tap();
    if (armedId !== id) return setArmedId(id);
    setArmedId(null);
    conn.removePlayer(id);
  }

  return (
    <>
      <section className="flex flex-col items-center gap-4 pt-4 pb-6">
        <InviteHero code={conn.code} onToast={onToast} />
      </section>

      <p className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
        Everyone gets the secret word, except one <span className="font-semibold text-fg">imposter</span> who only sees the category. Take turns
        saying 1–2 words about it, then vote out the faker.
      </p>

      <section aria-label="Settings" className="mt-6 flex flex-col gap-4">
        <div>
          <MicroLabel className="mb-2">Category</MicroLabel>
          {isHost ? (
            <div className="flex flex-wrap gap-2">
              {[{ id: "random", name: "Random" }, ...CATEGORIES].map((c) => (
                <Chip key={c.id} selected={game.categoryId === c.id} onClick={() => conn.send({ type: "setCategory", categoryId: c.id })}>
                  {c.name}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="font-display text-lg tracking-wide">{categoryName}</p>
          )}
        </div>
        <div>
          <MicroLabel className="mb-2">Discussion timer</MicroLabel>
          {isHost ? (
            <div className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface p-1">
              {TIMERS.map((t) => (
                <button
                  key={t.sec}
                  type="button"
                  aria-pressed={game.timerSec === t.sec}
                  onClick={() => (tap(), conn.send({ type: "setTimer", sec: t.sec }))}
                  className={cx(
                    "min-h-11 rounded-xl font-display text-sm tracking-wide transition-colors duration-150",
                    game.timerSec === t.sec ? "bg-accent text-ink" : "text-muted active:bg-surface-2",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="font-display text-lg tracking-wide">{timerLabel}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="imp-players" className="mt-6">
        <MicroLabel className="mb-2">
          <span id="imp-players">Players</span> <span className="tabular-nums">{game.players.length}/{MAX_IMPOSTER_PLAYERS}</span>
        </MicroLabel>
        <ol className="flex flex-col gap-2">
          {game.players.map((p) => (
            <li key={p.id} className="animate-pop">
              <PlayerRow conn={conn} player={p} className={p.id === conn.you ? "border-accent/60" : "border-line"}>
                {isHost && p.id !== conn.you && (
                  <button
                    type="button"
                    aria-label={armedId === p.id ? `Confirm remove ${p.name}` : `Remove ${p.name}`}
                    onClick={() => remove(p.id)}
                    className={cx(
                      "-mr-1 grid h-11 min-w-11 place-items-center rounded-xl transition-colors",
                      armedId === p.id
                        ? "bg-danger px-3 text-xs font-bold uppercase tracking-[0.14em] text-ink"
                        : "text-xl text-muted active:bg-surface-2 active:text-danger",
                    )}
                  >
                    {armedId === p.id ? "Remove?" : "×"}
                  </button>
                )}
              </PlayerRow>
            </li>
          ))}
        </ol>
      </section>

      <Footer>
        {isHost ? (
          <>
            <Status>{missing > 0 ? `Need ${missing} more ${missing === 1 ? "player" : "players"} to start` : "Everyone in? Let's find the faker!"}</Status>
            <Button size="lg" block disabled={missing > 0} onClick={() => (success(), conn.send({ type: "start" }))}>
              Start game
            </Button>
          </>
        ) : (
          <Status>Waiting for {hostName(conn)} to start…</Status>
        )}
      </Footer>
    </>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => (tap(), onClick())}
      className={cx(
        "min-h-11 rounded-full border-2 px-4 text-sm font-semibold transition-colors duration-150",
        selected ? "border-accent bg-accent text-ink" : "border-line bg-surface text-fg active:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 flex-none text-accent" fill="currentColor" role="img" aria-label="Host">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
    </svg>
  );
}
