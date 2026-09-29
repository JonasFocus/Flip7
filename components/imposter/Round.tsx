"use client";

import { useEffect, useState } from "react";
import { MicroLabel } from "@/components/lobby/Screens";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { success, tap } from "@/lib/client/haptics";
import type { ImposterConnection } from "@/lib/client/types";
import { Footer, PlayerRow, Status, nameOf } from "./Imposter";

const PEEK_MS = 2000;

export function Clues({ conn }: { conn: ImposterConnection }) {
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const starter = nameOf(conn, game.starterId);
  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-2 text-center">
        <MicroLabel>
          Round {game.round} of {game.maxRounds}
        </MicroLabel>
        <p className="font-display text-xl tracking-wide">
          {starter} {starter === "You" ? "give" : "gives"} the first clue
        </p>
        <p className="text-sm text-muted">Say only 1–2 words</p>
      </section>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
        {me?.eliminated ? (
          <p className="rounded-2xl border border-line bg-surface p-4 text-center text-sm text-muted">You&apos;re out. Watch and listen for the faker.</p>
        ) : (
          <SecretCard word={game.word} category={game.category} isImposter={game.imposterId === conn.you} />
        )}
        <Countdown endsAt={conn.cluesEndsAt} />
      </div>

      <ul aria-label="Players" className="flex flex-wrap justify-center gap-2 pb-4">
        {game.players.map((p) => (
          <li
            key={p.id}
            className={cx(
              "rounded-full border px-3 py-1 text-sm font-semibold",
              p.eliminated ? "border-line text-muted/60 line-through" : "border-line text-fg",
              p.id === game.starterId && "border-accent text-accent",
            )}
          >
            {p.id === conn.you ? "You" : p.name}
          </li>
        ))}
      </ul>

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

function SecretCard({ word, category, isImposter }: { word: string | null; category: string | null; isImposter: boolean }) {
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
      className="w-[min(64vw,240px)] aspect-[5/7] perspective-[1200px] [@media(max-height:640px)]:w-[160px]"
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
            isImposter ? "border-danger bg-danger text-ink" : "border-accent bg-accent text-ink",
          )}
        >
          {open && (
            <>
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-70">{category}</span>
              <span className="font-display text-3xl leading-tight break-words">{isImposter ? "IMPOSTER" : word}</span>
              {isImposter && <span className="text-sm font-semibold">Blend in. Guess the word from others&apos; clues.</span>}
            </>
          )}
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
    <p
      role="timer"
      aria-label={`${mmss} left`}
      className={cx("font-display text-6xl tabular-nums transition-colors", left <= 10 ? "text-danger" : "text-fg")}
    >
      {mmss}
    </p>
  );
}

export function Voting({ conn }: { conn: ImposterConnection }) {
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const inPlay = game.players.filter((p) => !p.eliminated);
  const targets = inPlay.filter((p) => p.id !== conn.you);
  const myVote = game.votes[conn.you];
  const voted = game.votedIds.filter((id) => inPlay.some((p) => p.id === id)).length;

  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-2 pb-6 text-center">
        <MicroLabel>Round {game.round} of {game.maxRounds}</MicroLabel>
        <h1 className="font-display text-3xl tracking-wide">Who&apos;s the imposter?</h1>
        <Countdown endsAt={conn.votingEndsAt} />
        <p className="text-sm text-muted">Votes close when the timer ends.</p>
        <p aria-live="polite" className="text-sm text-muted tabular-nums">
          {voted} of {inPlay.length} voted
        </p>
      </section>

      {me?.eliminated ? (
        <p className="rounded-2xl border border-line bg-surface p-4 text-center text-sm text-muted">You&apos;re out this game. Sit tight while the others vote.</p>
      ) : (
        <ul className="flex flex-col gap-2 pb-6">
          {targets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={myVote === p.id}
                onClick={() => (tap(), conn.send({ type: "vote", targetId: p.id }))}
                className="block w-full rounded-2xl transition-transform duration-150 active:scale-[0.98]"
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
      )}

      <Footer>
        <Status>
          {me?.eliminated
            ? `Waiting on ${inPlay.length - voted} more`
            : myVote
              ? "You can change your vote until voting closes"
              : "Tap who you think is faking"}
        </Status>
      </Footer>
    </>
  );
}
