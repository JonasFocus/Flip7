"use client";

import { useEffect, useState, type CSSProperties } from "react";
import "@/components/table/moments/moments.css";
import { Footer, Status } from "@/components/imposter/Imposter";
import { MicroLabel } from "@/components/lobby/Screens";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { success, tap } from "@/lib/client/haptics";
import { LOCATIONS } from "@/lib/spyfall";
import type { SpyConnection, SpyOutcome } from "@/lib/spyfall/types";
import { PlayerRow, hostName, nameOf } from "./Spyfall";

const PEEK_MS = 2000;

export function Questions({ conn }: { conn: SpyConnection }) {
  const { game } = conn;
  const isSpy = game.spyId === conn.you;
  const asker = nameOf(conn, game.firstAskerId);
  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-2 text-center">
        <p className="font-display text-xl tracking-wide">
          {asker} {asker === "You" ? "ask" : "asks"} first
        </p>
        <p className="text-sm text-muted">Ask anyone a question about where we are</p>
      </section>

      <div className="flex flex-col items-center gap-5 py-6">
        <SecretCard location={game.location} role={game.roles[conn.you] ?? null} isSpy={isSpy} />
        <Countdown endsAt={conn.deadlineAt} />
      </div>

      <LocationGrid conn={conn} canGuess={isSpy} />

      {conn.isHost && (
        <Footer>
          <Button size="lg" block onClick={() => (success(), conn.send({ type: "startVoting" }))}>
            Start voting
          </Button>
        </Footer>
      )}
    </>
  );
}

function SecretCard({ location, role, isSpy }: { location: string | null; role: string | null; isSpy: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setOpen(false), PEEK_MS);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <button
      type="button"
      onClick={() => (tap(), setOpen(true))}
      aria-label={open ? undefined : "Tap to peek at your card"}
      className="w-[min(56vw,210px)] aspect-[5/7] perspective-[1200px] [@media(max-height:640px)]:w-[140px]"
    >
      <span
        className={cx(
          "relative block size-full transform-3d transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none",
          open && "rotate-y-180",
        )}
      >
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center rounded-3xl border-2 border-line bg-surface-2 shadow-hard backface-hidden [background-image:repeating-linear-gradient(135deg,oklch(1_0_0/0.035)_0_8px,transparent_8px_20px)]"
        >
          <span className="absolute inset-3 rounded-2xl border-2 border-accent/35" />
          <span className="flex flex-col items-center gap-3">
            <span className="font-display text-7xl text-accent [text-shadow:0_5px_0_var(--color-accent-deep)]">?</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Tap to peek</span>
          </span>
        </span>
        <span
          aria-hidden={!open}
          aria-live="polite"
          className={cx(
            "absolute inset-0 flex rotate-y-180 flex-col items-center justify-center gap-3 rounded-3xl border-2 p-4 text-center shadow-hard backface-hidden",
            isSpy ? "border-danger bg-danger text-ink" : "border-accent bg-accent text-ink",
          )}
        >
          {open &&
            (isSpy ? (
              <>
                <span className="font-display text-3xl leading-tight">YOU ARE THE SPY</span>
                <span className="text-sm font-semibold">Blend in. Figure out where everyone is.</span>
              </>
            ) : (
              <>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-70">We are at the</span>
                <span className="font-display text-3xl leading-tight break-words">{location}</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-70">You are the</span>
                <span className="font-semibold leading-tight">{role}</span>
              </>
            ))}
        </span>
      </span>
    </button>
  );
}

function Countdown({ endsAt }: { endsAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [endsAt]);
  if (!endsAt) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <p role="timer" aria-label={`${mmss} left`} className={cx("font-display text-6xl tabular-nums transition-colors", left <= 30 ? "text-danger" : "text-fg")}>
      {mmss}
    </p>
  );
}

function LocationGrid({ conn, canGuess }: { conn: SpyConnection; canGuess: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <section aria-labelledby="spy-locations" className="pb-6">
      <MicroLabel className="mb-2">
        <span id="spy-locations">{canGuess ? "Know where we are? Tap to guess" : "Possible locations"}</span>
      </MicroLabel>
      <ul className="grid max-h-[50dvh] grid-cols-2 gap-2 overflow-y-auto overscroll-contain rounded-2xl">
        {LOCATIONS.map((l) => {
          const selected = picked === l.name;
          const cls = cx(
            "flex min-h-12 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold",
            selected ? "border-danger bg-danger/15 text-fg" : "border-line bg-surface",
          );
          const body = (
            <>
              <span aria-hidden>{l.emoji}</span>
              <span className="truncate">{l.name}</span>
            </>
          );
          return (
            <li key={l.name}>
              {canGuess ? (
                <button type="button" aria-pressed={selected} onClick={() => (tap(), setPicked(selected ? null : l.name))} className={cx(cls, "active:bg-surface-2")}>
                  {body}
                </button>
              ) : (
                <span className={cls}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      {canGuess && picked && (
        <div className="m-rise mt-3 flex flex-col gap-2 rounded-2xl border-2 border-danger bg-surface p-4">
          <p className="text-center text-sm">
            Guess <span className="font-semibold">{picked}</span>? A wrong guess loses the game.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => (success(), conn.send({ type: "guess", location: picked }))}>
              Guess
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export function Voting({ conn }: { conn: SpyConnection }) {
  const { game } = conn;
  const targets = game.players.filter((p) => p.id !== conn.you);
  const myVote = game.votes[conn.you];
  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-2 pb-6 text-center">
        <MicroLabel>Voting</MicroLabel>
        <h1 className="font-display text-3xl tracking-wide">Who&apos;s the spy?</h1>
        <p aria-live="polite" className="text-sm text-muted tabular-nums">
          {game.votedIds.length} of {game.players.length} voted
        </p>
      </section>

      <ul className="flex flex-col gap-2 pb-6">
        {targets.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              aria-pressed={myVote === p.id}
              onClick={() => (tap(), conn.send({ type: "vote", targetId: p.id }))}
              className="block w-full rounded-2xl transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none"
            >
              <PlayerRow conn={conn} player={p} className={myVote === p.id ? "border-accent bg-surface-2" : "border-line"}>
                {myVote === p.id && (
                  <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink">Your vote</span>
                )}
                {game.votedIds.includes(p.id) && myVote !== p.id && <span className="text-xs text-muted">Voted</span>}
              </PlayerRow>
            </button>
          </li>
        ))}
      </ul>

      <Footer>
        <Status>{myVote ? "You can change your vote until everyone's in" : "Tap who you think is the spy"}</Status>
      </Footer>
    </>
  );
}

const OUTCOME: Record<SpyOutcome, string> = {
  guessRight: "The spy guessed the location",
  guessWrong: "The spy guessed wrong",
  caught: "The spy was voted out",
  missed: "The vote missed the spy",
  spyLeft: "The spy left the game",
  tooFew: "Too few players left",
};

export function GameOver({ conn }: { conn: SpyConnection }) {
  const { game } = conn;
  const result = game.result;
  const faithful = result?.winner === "faithful";
  const tally = Object.entries(result?.tally ?? {}).sort((a, b) => b[1] - a[1]);
  const totalVotes = tally.reduce((sum, [, n]) => sum + n, 0);
  return (
    <>
      {faithful && <Confetti />}
      <section className="m-rise relative flex flex-col items-center gap-3 pt-8 pb-6 text-center">
        <MicroLabel>Game over</MicroLabel>
        <h1
          className={cx(
            "font-display text-5xl leading-none tracking-tight",
            faithful ? "text-accent [text-shadow:0_4px_0_var(--color-accent-deep)]" : "text-danger [text-shadow:0_4px_0_var(--color-danger-deep)]",
          )}
        >
          {faithful ? "The faithful win" : "The spy wins"}
        </h1>
        {result && (
          <p className="text-sm text-muted">
            {OUTCOME[result.outcome]}
            {result.guess && ` (${result.guess})`}
          </p>
        )}
        <div className="mt-3 w-full rounded-3xl border-2 border-line bg-surface p-5">
          <MicroLabel>The spy was</MicroLabel>
          <p className="mt-1 font-display text-3xl tracking-wide text-danger">{nameOf(conn, game.spyId)}</p>
          <MicroLabel className="mt-4">We were at the</MicroLabel>
          <p className="mt-1 font-display text-3xl tracking-wide text-accent">{game.location ?? "?"}</p>
        </div>
      </section>

      <section aria-label="Roles" className="flex flex-col gap-2 pb-6">
        <MicroLabel>Roles</MicroLabel>
        {game.players.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
            <span className="truncate font-semibold">{nameOf(conn, p.id)}</span>
            <span className={cx("text-right text-sm", p.id === game.spyId ? "font-bold text-danger" : "text-muted")}>
              {p.id === game.spyId ? "Spy" : (game.roles[p.id] ?? "")}
            </span>
          </div>
        ))}
      </section>

      {totalVotes > 0 && (
        <section aria-label="Votes" className="flex flex-col gap-3 pb-6">
          <MicroLabel>Votes</MicroLabel>
          {tally.map(([id, n]) => (
            <div key={id} className="flex items-center gap-3">
              <span className="w-24 truncate font-semibold">{nameOf(conn, id)}</span>
              <span className="h-8 flex-1 overflow-hidden rounded-lg bg-surface">
                <span className="m-bar block h-full rounded-lg bg-accent" style={{ width: `${(n / totalVotes) * 100}%` }} />
              </span>
              <span className="w-6 text-right font-display tabular-nums">{n}</span>
            </div>
          ))}
        </section>
      )}

      <Footer>
        {conn.isHost ? (
          <Button size="lg" block onClick={() => (success(), conn.send({ type: "playAgain" }))}>
            Play again
          </Button>
        ) : (
          <Status>Waiting for {hostName(conn)} to play again…</Status>
        )}
        <Button variant="secondary" block onClick={conn.leave}>
          Home
        </Button>
      </Footer>
    </>
  );
}

const BIT_COLORS = [1, 3, 5, 7, 8, 9, 10, 12].map((v) => `var(--color-card-${v})`);

function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none fixed top-[30%] left-1/2 z-20">
      {Array.from({ length: 40 }, (_, i) => {
        const style: CSSProperties & Record<`--${string}`, string> = {
          "--a": `${i * 9}deg`,
          "--d": `${160 + ((i * 41) % 6) * 40}px`,
          "--spin": `${(i % 2 ? 1 : -1) * (200 + i * 15)}deg`,
          "--c": BIT_COLORS[i % BIT_COLORS.length] ?? "var(--color-accent)",
          animationDelay: `${200 + (i % 5) * 40}ms`,
          animationDuration: "1600ms",
        };
        return <span key={i} className="m-bit" style={style} />;
      })}
    </div>
  );
}
