"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ScoreConnection } from "@/lib/client/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { Board } from "./Board";
import { InviteHero, shareInvite } from "@/components/lobby/Lobby";
import { CountUp, HistoryTable, MicroLabel, canControl, standings } from "./shared";

export function Scorekeeper({ conn }: { conn: ScoreConnection }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { game } = conn;
  const canUndo = conn.isHost && (game.players[0]?.rounds.length ?? 0) > 0;

  function leave() {
    conn.leave();
    router.push("/");
  }
  async function share() {
    setNotice(await shareInvite(conn.code));
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 select-none">
      <Toast message={conn.error ?? notice} tone={conn.error ? "danger" : "neutral"} onDismiss={() => setNotice(null)} />

      {game.players.length === 0 && conn.status !== "open" ? (
        <p className="m-auto font-display text-muted">Connecting…</p>
      ) : game.phase === "lobby" ? (
        <ScoreLobby conn={conn} onToast={setNotice} onLeave={leave} />
      ) : game.phase === "playing" ? (
        <Board conn={conn} onMenu={() => setMenu(true)} />
      ) : (
        <Podium conn={conn} onHistory={() => setHistory(true)} onUndo={() => setConfirmUndo(true)} onLeave={leave} />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={`Room ${conn.code}`}>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" block onClick={() => { setMenu(false); setHistory(true); }}>
            Round history
          </Button>
          <Button variant="secondary" block onClick={share}>
            Invite
          </Button>
          {canUndo && (
            <Button variant="secondary" block onClick={() => { setMenu(false); setConfirmUndo(true); }}>
              Undo last round
            </Button>
          )}
          <Button variant="ghost" block className="text-busted" onClick={leave}>
            Leave table
          </Button>
        </div>
      </Sheet>

      <Sheet open={history} onClose={() => setHistory(false)} title="History">
        <HistoryTable game={game} />
      </Sheet>

      <Sheet open={confirmUndo} onClose={() => setConfirmUndo(false)} title="Undo last round?">
        <p className="text-muted">Round {game.players[0]?.rounds.length ?? 0} scores come off everyone&apos;s total and any hands entered for this round are cleared.</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="danger" size="lg" block onClick={() => { conn.send({ type: "undoRound" }); setConfirmUndo(false); }}>
            Undo round
          </Button>
          <Button variant="ghost" block onClick={() => setConfirmUndo(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </main>
  );
}

const GOAL_STEP = 50;

function ScoreLobby({ conn, onToast, onLeave }: { conn: ScoreConnection; onToast: (m: string) => void; onLeave: () => void }) {
  const { game } = conn;
  const [name, setName] = useState("");

  function addSeat(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    conn.send({ type: "addSeat", name: n });
    setName("");
  }
  function setGoal(goal: number) {
    conn.send({ type: "setGoal", goal: Math.min(1000, Math.max(50, goal)) });
  }

  return (
    <>
      <header className="flex items-center justify-between pt-safe-2 pb-2">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={onLeave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <p className="rounded-full border border-line px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Scorekeeper</p>
      </header>
      <section className="flex flex-col items-center gap-4 pt-4">
        <InviteHero code={conn.code} onToast={onToast} />
        <p className="max-w-xs text-center text-sm text-muted text-pretty">Play with real cards. After each round, everyone taps in their hand.</p>
      </section>

      <section className="mt-8">
        <MicroLabel className="mb-2">At the table · {game.players.length}</MicroLabel>
        <ul className="flex flex-col gap-2">
          {game.players.map((p) => (
            <li key={p.id} className="flex animate-pop items-center gap-3 rounded-2xl border border-line bg-surface py-2 pr-1 pl-3">
              <Avatar id={p.id} name={p.name} />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              {p.ownerId === conn.you && <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">This phone</span>}
              {canControl(conn, p) ? (
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => conn.send({ type: "removeSeat", seatId: p.id })}
                  className="grid size-11 place-items-center rounded-xl text-muted transition-transform active:scale-90"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              ) : (
                <span className="size-11" />
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addSeat} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor="seat-name">
            Add someone sharing this phone
          </label>
          <input
            id="seat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="Add someone on this phone"
            className="min-h-12 min-w-0 flex-1 rounded-2xl border border-dashed border-line bg-transparent px-4 text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <Button type="submit" variant="secondary" disabled={!name.trim()} className="flex-none">
            Add
          </Button>
        </form>
      </section>

      <section className="mt-8 mb-6">
        <MicroLabel className="mb-2">First to</MicroLabel>
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-2">
          {conn.isHost && (
            <StepButton label="Lower goal" disabled={game.goal <= 50} onClick={() => setGoal(game.goal - GOAL_STEP)}>
              −
            </StepButton>
          )}
          <p className="flex-1 text-center">
            <span className="font-display text-3xl tabular-nums">{game.goal}</span>
            <span className="ml-1.5 text-sm text-muted">pts</span>
          </p>
          {conn.isHost && (
            <StepButton label="Raise goal" disabled={game.goal >= 1000} onClick={() => setGoal(game.goal + GOAL_STEP)}>
              +
            </StepButton>
          )}
        </div>
      </section>

      <div className="sticky bottom-0 -mx-4 mt-auto bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4">
        {conn.isHost ? (
          <Button size="lg" block disabled={game.players.length === 0} onClick={() => conn.send({ type: "start" })}>
            Start game
          </Button>
        ) : (
          <p className="flex min-h-16 items-center justify-center rounded-2xl border border-line text-muted">Waiting for the host to start…</p>
        )}
      </div>
    </>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press grid size-12 place-items-center rounded-xl bg-surface-2 font-display text-2xl disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const PODIUM_HEIGHT = ["h-28", "h-20", "h-14"];

function Podium({
  conn,
  onHistory,
  onUndo,
  onLeave,
}: {
  conn: ScoreConnection;
  onHistory: () => void;
  onUndo: () => void;
  onLeave: () => void;
}) {
  const { game } = conn;
  const sorted = standings(game.players);
  const winners = game.players.filter((p) => game.winnerIds.includes(p.id));
  const top = sorted.slice(0, 3);
  // Visual order: 2nd, 1st, 3rd.
  const stage = [top[1], top[0], top[2]].flatMap((p) => (p ? [p] : []));

  return (
    <>
      <header className="pt-safe-8 text-center">
        <MicroLabel>Game over · {game.round} rounds</MicroLabel>
        <h1 className="mt-2 animate-pop font-display text-4xl leading-tight text-accent text-balance">
          {winners.length > 1 ? "It's a tie!" : `${winners[0]?.name ?? "Nobody"} wins!`}
        </h1>
        {winners.length > 1 && <p className="mt-1 text-muted">{winners.map((w) => w.name).join(" & ")}</p>}
      </header>

      <div className="mt-8 flex items-end justify-center gap-2">
        {stage.map((p) => {
          const place = sorted.indexOf(p);
          const win = game.winnerIds.includes(p.id);
          return (
            <div key={p.id} className="flex w-24 min-w-0 flex-col items-center gap-2 animate-deal" style={{ animationDelay: `${(2 - place) * 120}ms` }}>
              <Avatar id={p.id} name={p.name} size="lg" className={cx(win && "animate-glow")} />
              <span className="w-full truncate text-center text-sm font-semibold">{p.name}</span>
              <div
                className={cx(
                  "flex w-full flex-col items-center justify-start rounded-t-2xl pt-2",
                  PODIUM_HEIGHT[place],
                  win ? "bg-accent text-ink" : "bg-surface-2",
                )}
              >
                <CountUp value={p.total} className="font-display text-2xl" />
                <span className={cx("font-display text-xs", win ? "text-ink/70" : "text-muted")}>#{place + 1}</span>
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length > 3 && (
        <ol start={4} className="mt-4 flex flex-col gap-2">
          {sorted.slice(3).map((p, i) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
              <span className="w-5 text-center font-display text-sm text-muted">{i + 4}</span>
              <Avatar id={p.id} name={p.name} size="sm" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="font-display tabular-nums">{p.total}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4">
        {conn.isHost ? (
          <Button size="lg" block onClick={() => conn.send({ type: "playAgain" })}>
            Play again
          </Button>
        ) : (
          <p className="flex min-h-16 items-center justify-center rounded-2xl border border-line text-muted">Waiting for the host…</p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onHistory}>
            History
          </Button>
          {conn.isHost && (
            <Button variant="secondary" className="flex-1" onClick={onUndo}>
              Undo
            </Button>
          )}
          <Button variant="ghost" className="flex-1" onClick={onLeave}>
            Leave
          </Button>
        </div>
      </div>
    </>
  );
}
