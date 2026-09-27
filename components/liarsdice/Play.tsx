"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Footer, Status } from "@/components/imposter/Imposter";
import { MicroLabel } from "@/components/lobby/Screens";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { fail, success, tap } from "@/lib/client/haptics";
import { isRaise, matches, minRaise, totalDice } from "@/lib/liarsdice";
import type { Bid, DiceConnection, DicePlayer } from "@/lib/liarsdice/types";

const FACES = [2, 3, 4, 5, 6];
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

type DieSize = "xs" | "sm" | "md" | "lg";
type DieTone = "plain" | "match" | "wild" | "dim";

const DIE_SIZE: Record<DieSize, string> = {
  xs: "size-4 rounded-[5px] p-[3px] gap-px",
  sm: "size-8 rounded-lg p-1 gap-0.5",
  md: "size-10 rounded-[10px] p-1.5 gap-0.5",
  lg: "size-[min(15vw,64px)] rounded-2xl p-2 gap-1 shadow-hard",
};
const DIE_TONE: Record<DieTone, string> = {
  plain: "bg-fg",
  match: "bg-accent ring-2 ring-accent ring-offset-2 ring-offset-bg",
  wild: "bg-stayed ring-2 ring-stayed ring-offset-2 ring-offset-bg",
  dim: "bg-fg/35",
};

export function Die({
  face,
  size = "md",
  tone = "plain",
  className,
  style,
}: {
  face: number;
  size?: DieSize;
  tone?: DieTone;
  className?: string;
  style?: CSSProperties;
}) {
  const pips = PIPS[face] ?? [];
  return (
    <span role="img" aria-label={`${face}`} style={style} className={cx("grid flex-none grid-cols-3 grid-rows-3", DIE_SIZE[size], DIE_TONE[tone], className)}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={cx("rounded-full", pips.includes(i) && "bg-ink")} />
      ))}
    </span>
  );
}

function HiddenDice({ count }: { count: number }) {
  return (
    <span aria-label={`${count} ${count === 1 ? "die" : "dice"}`} className="flex items-center gap-0.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} aria-hidden className="size-3 rounded-[3px] border-2 border-muted/70" />
      ))}
    </span>
  );
}

export function nameOf(conn: DiceConnection, id: string | null | undefined): string {
  if (id === conn.you) return "You";
  return conn.game.players.find((p) => p.id === id)?.name ?? "Someone";
}

export const hostName = (conn: DiceConnection): string => conn.game.players.find((p) => p.id === conn.hostId)?.name ?? "the host";

function useSecondsLeft(at: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

function BidLabel({ bid, size = "md" }: { bid: Bid; size?: "md" | "lg" }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display tabular-nums", size === "lg" ? "text-5xl" : "text-lg")}>
      {bid.count}
      <span className="text-muted">×</span>
      <Die face={bid.face} size={size === "lg" ? "md" : "sm"} />
    </span>
  );
}

export function Bidding({ conn }: { conn: DiceConnection }) {
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const myTurn = game.turnId === conn.you;
  const turnName = nameOf(conn, game.turnId);
  const turnPlayer = game.players.find((p) => p.id === game.turnId);
  const autoIn = useSecondsLeft(conn.deadlineAt);

  return (
    <>
      <section className="flex items-center justify-between pt-1 pb-3">
        <MicroLabel>Round {game.round}</MicroLabel>
        <MicroLabel>
          <span className="tabular-nums">{totalDice(game)}</span> dice in play · 1s wild
        </MicroLabel>
      </section>

      <ul aria-label="Players" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {game.players.map((p, seat) => (
          <li
            key={p.id}
            className={cx(
              "flex min-w-24 flex-none flex-col items-center gap-1.5 rounded-2xl border-2 bg-surface px-3 py-2",
              p.id === game.turnId ? "border-accent" : "border-line",
              p.diceCount === 0 && "opacity-40 grayscale",
            )}
          >
            <span className="relative">
              <Avatar id={p.id} seat={seat} name={p.name} size="sm" />
              <span aria-hidden className={cx("absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface", p.connected ? "bg-active" : "bg-muted/60")} />
            </span>
            <span className="max-w-20 truncate text-xs font-semibold">{p.id === conn.you ? "You" : p.name}</span>
            {p.diceCount === 0 ? <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Out</span> : <HiddenDice count={p.diceCount} />}
            {p.id === game.bidderId && game.bid && (
              <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-display text-xs tabular-nums">
                {game.bid.count}×<Die face={game.bid.face} size="xs" />
              </span>
            )}
          </li>
        ))}
      </ul>

      <section aria-live="polite" className="flex flex-col items-center gap-2 py-5 text-center">
        <MicroLabel>Current bid</MicroLabel>
        {game.bid ? (
          <>
            <BidLabel bid={game.bid} size="lg" />
            <p className="text-sm text-muted">by {nameOf(conn, game.bidderId)}</p>
          </>
        ) : (
          <p className="font-display text-2xl tracking-wide">
            {turnName} {myTurn ? "open" : "opens"} the bidding
          </p>
        )}
      </section>

      <section aria-label="Your dice" className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
        {me && me.diceCount > 0 ? (
          <>
            <MicroLabel>Your dice</MicroLabel>
            <div key={game.round} className="flex flex-wrap justify-center gap-2">
              {me.dice.map((d, i) => (
                <Die key={i} face={d} size="lg" tone={game.bid && matches(d, game.bid.face) ? "match" : "plain"} className="animate-deal" style={{ animationDelay: `${i * 70}ms` }} />
              ))}
            </div>
          </>
        ) : (
          <p className="rounded-2xl border border-line bg-surface p-4 text-center text-sm text-muted">You&apos;re out. Watch the bluffs fly.</p>
        )}
      </section>

      <Footer>
        {myTurn ? (
          <BidPicker key={`${game.round}:${game.bid?.count}:${game.bid?.face}`} conn={conn} />
        ) : (
          <Status>
            {turnPlayer && !turnPlayer.connected && autoIn !== null
              ? `${turnName} is offline, auto-playing in ${autoIn}s`
              : `Waiting for ${turnName}…`}
          </Status>
        )}
      </Footer>
    </>
  );
}

function BidPicker({ conn }: { conn: DiceConnection }) {
  const { bid } = conn.game;
  const total = totalDice(conn.game);
  const start = minRaise(bid);
  const [count, setCount] = useState(start.count);
  const [face, setFace] = useState(start.face);
  const canRaise = start.count <= total;
  const legal = isRaise(bid, { count, face }) && count <= total;

  function step(delta: number) {
    tap();
    const next = Math.min(total, Math.max(start.count, count + delta));
    setCount(next);
    if (!isRaise(bid, { count: next, face })) setFace(FACES.find((f) => isRaise(bid, { count: next, face: f })) ?? 6);
  }

  return (
    <div className="flex flex-col gap-3">
      {canRaise ? (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-1.5">
            <StepButton label="Fewer dice" disabled={count <= start.count} onClick={() => step(-1)}>
              −
            </StepButton>
            <p aria-live="polite" className="font-display text-3xl tabular-nums">
              {count} <span className="text-base text-muted">{count === 1 ? "die" : "dice"}</span>
            </p>
            <StepButton label="More dice" disabled={count >= total} onClick={() => step(1)}>
              +
            </StepButton>
          </div>
          <div role="radiogroup" aria-label="Face" className="grid grid-cols-5 gap-2">
            {FACES.map((f) => {
              const ok = isRaise(bid, { count, face: f });
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={face === f}
                  aria-label={`${f}s`}
                  disabled={!ok}
                  onClick={() => (tap(), setFace(f))}
                  className={cx(
                    "grid min-h-14 place-items-center rounded-xl border-2 transition-colors duration-150",
                    face === f ? "border-accent bg-surface-2" : "border-line bg-surface",
                    !ok && "opacity-30",
                  )}
                >
                  <Die face={f} size="sm" />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <Status>Nobody can bid higher. Call it!</Status>
      )}
      <div className={cx("grid gap-3", bid && canRaise ? "grid-cols-2" : "grid-cols-1")}>
        {canRaise && (
          <Button size="lg" disabled={!legal} onClick={() => (success(), conn.send({ type: "bid", count, face }))}>
            Bid
          </Button>
        )}
        {bid && (
          <Button size="lg" variant="danger" onClick={() => (fail(), conn.send({ type: "liar" }))}>
            Liar!
          </Button>
        )}
      </div>
    </div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press grid size-12 place-items-center rounded-xl bg-surface-2 font-display text-2xl disabled:opacity-30 [--press-shadow:oklch(0.1_0.02_275)]"
    >
      {children}
    </button>
  );
}

function AllDice({ conn }: { conn: DiceConnection }) {
  const { game } = conn;
  const c = game.lastChallenge;
  return (
    <ul aria-label="Everyone's dice" className="flex flex-col gap-2">
      {game.players
        .filter((p) => p.dice.length > 0)
        .map((p) => (
          <li key={p.id} className={cx("flex min-h-14 items-center gap-3 rounded-2xl border bg-surface px-3", p.id === c?.loserId ? "border-danger" : "border-line")}>
            <span className="w-20 truncate text-sm font-semibold">{p.id === conn.you ? "You" : p.name}</span>
            <span className="flex flex-1 flex-wrap gap-2 py-2">
              {p.dice.map((d, i) => (
                <Die key={i} face={d} size="sm" tone={!c ? "plain" : d === 1 ? "wild" : d === c.bid.face ? "match" : "dim"} className="animate-pop" style={{ animationDelay: `${i * 60}ms` }} />
              ))}
            </span>
            {p.id === c?.loserId && <LoserTag player={p} />}
          </li>
        ))}
    </ul>
  );
}

function LoserTag({ player }: { player: DicePlayer }) {
  return (
    <span className="rounded-full bg-danger px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink">{player.diceCount === 0 ? "Out" : "−1"}</span>
  );
}

function Verdict({ conn }: { conn: DiceConnection }) {
  const c = conn.game.lastChallenge;
  if (!c) return null;
  const held = c.total >= c.bid.count;
  const loser = conn.game.players.find((p) => p.id === c.loserId);
  const loserName = nameOf(conn, c.loserId);
  return (
    <section aria-live="polite" className="flex flex-col items-center gap-3 pt-2 pb-5 text-center">
      <MicroLabel>
        {nameOf(conn, c.callerId)} called liar on {nameOf(conn, c.bidderId)}
      </MicroLabel>
      <div className="flex items-center gap-6">
        <div className="flex flex-col items-center gap-1">
          <MicroLabel>Bid</MicroLabel>
          <BidLabel bid={c.bid} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <MicroLabel>Actual</MicroLabel>
          <span className={cx("font-display text-4xl tabular-nums", held ? "text-active" : "text-danger")}>{c.total}</span>
        </div>
      </div>
      <h1 className="animate-pop font-display text-3xl leading-tight tracking-wide">{held ? "The bid holds!" : "Busted bluff!"}</h1>
      <p className="text-sm text-muted">
        {loserName} {loser?.diceCount === 0 ? (loserName === "You" ? "are out!" : "is out!") : loserName === "You" ? "lose a die" : "loses a die"}
        <span className="mx-1.5">·</span>
        <span className="text-stayed">blue</span> 1s are wild
      </p>
    </section>
  );
}

export function Reveal({ conn }: { conn: DiceConnection }) {
  const left = useSecondsLeft(conn.deadlineAt);
  return (
    <>
      <Verdict conn={conn} />
      <AllDice conn={conn} />
      <Footer>
        <Status>{left !== null ? `Round starts in ${left}…` : "Next round coming up…"}</Status>
        {conn.isHost && (
          <Button size="lg" block onClick={() => (success(), conn.send({ type: "nextRound" }))}>
            Next round
          </Button>
        )}
      </Footer>
    </>
  );
}

export function GameOver({ conn }: { conn: DiceConnection }) {
  const winner = nameOf(conn, conn.game.winnerId);
  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-6 pb-4 text-center">
        <MicroLabel>Game over</MicroLabel>
        <h1 className="animate-pop font-display text-4xl leading-tight tracking-wide text-accent [text-shadow:0_4px_0_var(--color-accent-deep)]">
          {conn.game.winnerId ? (winner === "You" ? "You win!" : `${winner} wins!`) : "No winner"}
        </h1>
      </section>
      <Verdict conn={conn} />
      <AllDice conn={conn} />
      <Footer>
        {conn.isHost ? (
          <Button size="lg" block onClick={() => (success(), conn.send({ type: "playAgain" }))}>
            Play again
          </Button>
        ) : (
          <Status>Waiting for {hostName(conn)} to start a new game…</Status>
        )}
        <Button variant="secondary" block onClick={conn.leave}>
          Home
        </Button>
      </Footer>
    </>
  );
}
