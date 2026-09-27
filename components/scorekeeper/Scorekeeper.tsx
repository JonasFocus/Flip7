"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ScoreConnection } from "@/lib/client/types";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { Board } from "./Board";
import { InviteHero, shareInvite } from "@/components/lobby/Lobby";
import { AddSeatForm, CountUp, HistoryTable, MicroLabel, canControl, hostName, rankOf, standings, useTapGuard } from "./shared";

export function Scorekeeper({ conn }: { conn: ScoreConnection }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { game } = conn;
  const recorded = game.players[0]?.rounds.length ?? 0;
  const canUndo = conn.isHost && recorded > 0;
  const enteredNow = game.phase === "playing" ? Object.values(game.entries).filter(Boolean).length : 0;

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
        // Keyed by round so an open hand picker or confirm sheet can't carry over into the next round.
        <Board key={game.round} conn={conn} onMenu={() => setMenu(true)} />
      ) : (
        <Podium conn={conn} onHistory={() => setHistory(true)} onUndo={() => setConfirmUndo(true)} onLeave={leave} />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title={`Room ${conn.code}`}>
        <div className="flex flex-col gap-2">
          {conn.isHost && game.phase === "playing" && <GoalStepper conn={conn} className="mb-2" />}
          {game.phase === "playing" && (
            <section className="mb-2">
              <MicroLabel className="mb-2">Late arrival</MicroLabel>
              <AddSeatForm conn={conn} />
            </section>
          )}
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
        <p className="text-muted">
          Round {recorded} comes off everyone&apos;s total.{" "}
          {game.entryHistory.length > 0
            ? "Its hands come back so you can fix one and finish again."
            : `Hands for round ${recorded} weren't kept, so re-enter them before finishing.`}
          {enteredNow > 0 && (
            <>
              {" "}
              The {enteredNow === 1 ? "hand" : `${enteredNow} hands`} entered for round {game.round} will be cleared.
            </>
          )}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="danger" size="lg" block onClick={() => {
              if (!confirmUndo) return; // the sheet is still clickable while it slides out
              conn.send({ type: "undoRound", round: recorded });
              setConfirmUndo(false);
            }}>
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
          {game.players.map((p, i) => (
            <li key={p.id} className="flex animate-pop items-center gap-3 rounded-2xl border border-line bg-surface py-2 pr-1 pl-3">
              <Avatar id={p.id} seat={i} name={p.name} />
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
        <AddSeatForm conn={conn} className="mt-3" />
      </section>

      <GoalStepper conn={conn} className="mt-8 mb-6" />

      <div className="sticky bottom-0 -mx-4 mt-auto bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4">
        {conn.isHost ? (
          <Button size="lg" block disabled={game.players.length === 0} onClick={() => conn.send({ type: "start" })}>
            Start game
          </Button>
        ) : (
          <p className="flex min-h-16 items-center justify-center rounded-2xl border border-line text-muted">Waiting for {hostName(conn)} to start…</p>
        )}
      </div>
    </>
  );
}

// Mid-game the goal can't drop to or below the top total, or it would crown a winner instantly.
function GoalStepper({ conn, className }: { conn: ScoreConnection; className?: string }) {
  const { game } = conn;
  const min = game.phase === "playing" ? Math.max(50, ...game.players.map((p) => p.total + 1)) : 50;
  const setGoal = (goal: number) => conn.send({ type: "setGoal", goal });
  return (
    <section className={className}>
      <MicroLabel className="mb-2">First to</MicroLabel>
      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-2">
        {conn.isHost && (
          <StepButton label="Lower goal" disabled={game.goal - GOAL_STEP < min} onClick={() => setGoal(game.goal - GOAL_STEP)}>
            −
          </StepButton>
        )}
        <p className="flex-1 text-center">
          <span className="font-display text-3xl tabular-nums">{game.goal}</span>
          <span className="ml-1.5 text-sm text-muted">pts</span>
        </p>
        {conn.isHost && (
          <StepButton label="Raise goal" disabled={game.goal + GOAL_STEP > 1000} onClick={() => setGoal(game.goal + GOAL_STEP)}>
            +
          </StepButton>
        )}
      </div>
    </section>
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
  // Steps are places, not indices: tied players share a step, and anyone past 3rd place goes in the list.
  const places = [0, 1, 2].map((place) => sorted.filter((p) => rankOf(sorted, p) === place));
  // Visual order: 2nd, 1st, 3rd.
  const stage = [1, 0, 2].flatMap((place) => (places[place]?.length ? [{ place, seats: places[place] }] : []));
  const rest = sorted.filter((p) => rankOf(sorted, p) > 2);
  const [held] = useTapGuard();

  return (
    <>
      <header className="pt-safe-8 text-center">
        <MicroLabel>
          Game over · {game.round} {game.round === 1 ? "round" : "rounds"}
        </MicroLabel>
        <h1 className="mt-2 animate-pop font-display text-4xl leading-tight text-accent text-balance">
          {winners.length > 1 ? "It's a tie!" : `${winners[0]?.name ?? "Nobody"} wins!`}
        </h1>
        {winners.length > 1 && <p className="mt-1 text-muted">{winners.map((w) => w.name).join(" & ")}</p>}
      </header>

      <div className="mt-8 flex items-end justify-center gap-2">
        {stage.map(({ place, seats }) => {
          const win = seats.some((p) => game.winnerIds.includes(p.id));
          return (
            <div
              key={place}
              className={cx("flex min-w-0 flex-col items-center gap-2 animate-deal", seats.length > 1 ? "w-32" : "w-24")}
              style={{ animationDelay: `${(2 - place) * 120}ms` }}
            >
              <span className="flex -space-x-3">
                {seats.map((p) => (
                  <Avatar key={p.id} id={p.id} seat={game.players.indexOf(p)} name={p.name} size="lg" className={cx("ring-2 ring-bg", win && "turn-glow")} />
                ))}
              </span>
              <span className="w-full truncate text-center text-sm font-semibold">{seats.map((p) => p.name).join(" & ")}</span>
              <div
                className={cx(
                  "flex w-full flex-col items-center justify-start rounded-t-2xl pt-2",
                  PODIUM_HEIGHT[place],
                  win ? "bg-accent text-ink" : "bg-surface-2",
                )}
              >
                <CountUp value={seats[0]?.total ?? 0} className="font-display text-2xl" />
                <span className={cx("font-display text-xs", win ? "text-ink/70" : "text-muted")}>#{place + 1}</span>
              </div>
            </div>
          );
        })}
      </div>

      {rest.length > 0 && (
        <ol className="mt-4 flex flex-col gap-2">
          {rest.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2">
              <span className="w-5 text-center font-display text-sm text-muted">{rankOf(sorted, p) + 1}</span>
              <Avatar id={p.id} seat={game.players.indexOf(p)} name={p.name} size="sm" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="font-display tabular-nums">{p.total}</span>
            </li>
          ))}
        </ol>
      )}

      <div
        className={cx(
          "sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4",
          held && "pointer-events-none",
        )}
      >
        {conn.isHost ? (
          <Button size="lg" block onClick={() => conn.send({ type: "playAgain" })}>
            Play again
          </Button>
        ) : (
          <p className="flex min-h-16 items-center justify-center rounded-2xl border border-line text-muted">Waiting for {hostName(conn)}…</p>
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
