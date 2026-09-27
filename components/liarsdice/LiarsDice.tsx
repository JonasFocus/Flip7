"use client";

import { useEffect, useState } from "react";
import { Footer, Status } from "@/components/imposter/Imposter";
import { InviteHero } from "@/components/lobby/Lobby";
import { MicroLabel } from "@/components/lobby/Screens";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { success, tap } from "@/lib/client/haptics";
import { MAX_DICE_PLAYERS, MIN_DICE_PLAYERS } from "@/lib/liarsdice";
import type { DiceConnection, DiceCount } from "@/lib/liarsdice/types";
import { Bidding, Die, GameOver, Reveal, hostName } from "./Play";

const DICE_COUNTS: DiceCount[] = [3, 4, 5];

export function LiarsDice({ conn }: { conn: DiceConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const { phase } = conn.game;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-safe-2 select-none">
      <Toast message={toast ?? conn.error} tone={toast ? "accent" : "danger"} onDismiss={() => setToast(null)} />
      <header className="flex items-center justify-between py-2">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={conn.leave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <p className="rounded-full border border-line px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Liar&apos;s Dice</p>
      </header>
      {phase === "lobby" && <DiceLobby conn={conn} onToast={setToast} />}
      {phase === "bidding" && <Bidding conn={conn} />}
      {phase === "reveal" && <Reveal conn={conn} />}
      {phase === "gameOver" && <GameOver conn={conn} />}
    </main>
  );
}

function DiceLobby({ conn, onToast }: { conn: DiceConnection; onToast: (m: string) => void }) {
  const { game, isHost } = conn;
  const [armedId, setArmedId] = useState<string | null>(null);
  const missing = MIN_DICE_PLAYERS - game.players.length;

  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(t);
  }, [armedId]);

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

      <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
        <Die face={1} size="md" tone="wild" className="mt-1" />
        <p>
          Everyone rolls in secret. Take turns raising the bid on how many of a face are on the <span className="font-semibold text-fg">whole table</span>{" "}
          (1s are wild), or call <span className="font-semibold text-fg">Liar!</span> Whoever&apos;s wrong loses a die. Last one rolling wins.
        </p>
      </div>

      <section aria-label="Settings" className="mt-6">
        <MicroLabel className="mb-2">Dice each</MicroLabel>
        {isHost ? (
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface p-1">
            {DICE_COUNTS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={game.startDice === n}
                onClick={() => (tap(), conn.send({ type: "setDice", count: n }))}
                className={cx(
                  "min-h-11 rounded-xl font-display text-sm tracking-wide transition-colors duration-150",
                  game.startDice === n ? "bg-accent text-ink" : "text-muted active:bg-surface-2",
                )}
              >
                {n} dice
              </button>
            ))}
          </div>
        ) : (
          <p className="font-display text-lg tracking-wide">{game.startDice} dice</p>
        )}
      </section>

      <section aria-labelledby="dice-players" className="mt-6">
        <MicroLabel className="mb-2">
          <span id="dice-players">Players</span>{" "}
          <span className="tabular-nums">
            {game.players.length}/{MAX_DICE_PLAYERS}
          </span>
        </MicroLabel>
        <ol className="flex flex-col gap-2">
          {game.players.map((p, seat) => (
            <li
              key={p.id}
              className={cx("flex min-h-16 animate-pop items-center gap-3 rounded-2xl border bg-surface px-3", p.id === conn.you ? "border-accent/60" : "border-line")}
            >
              <span className="relative">
                <Avatar id={p.id} seat={seat} name={p.name} />
                <span aria-hidden className={cx("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface", p.connected ? "bg-active" : "bg-muted/60")} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{p.name}</span>
                  {p.id === conn.hostId && <CrownIcon />}
                </span>
                <span className="block text-xs text-muted">
                  {[p.id === conn.you && "You", p.id === conn.hostId && "Host", !p.connected && "Offline"].filter(Boolean).join(" · ") || "Player"}
                </span>
              </span>
              {isHost && p.id !== conn.you && (
                <button
                  type="button"
                  aria-label={armedId === p.id ? `Confirm remove ${p.name}` : `Remove ${p.name}`}
                  onClick={() => remove(p.id)}
                  className={cx(
                    "-mr-1 grid h-11 min-w-11 place-items-center rounded-xl transition-colors",
                    armedId === p.id ? "bg-danger px-3 text-xs font-bold uppercase tracking-[0.14em] text-ink" : "text-xl text-muted active:bg-surface-2 active:text-danger",
                  )}
                >
                  {armedId === p.id ? "Remove?" : "×"}
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>

      <Footer>
        {isHost ? (
          <>
            <Status>{missing > 0 ? `Need ${missing} more ${missing === 1 ? "player" : "players"} to start` : "Cups up. Time to bluff!"}</Status>
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

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 flex-none text-accent" fill="currentColor" role="img" aria-label="Host">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
    </svg>
  );
}
