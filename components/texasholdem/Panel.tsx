"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Chip, shortAmount } from "@/components/casino/Chip";
import { fail, success, tap } from "@/lib/client/haptics";
import { BIG_BLIND, FOLD_HOLD_MS, RAISE_CHIPS, START_CHIPS, TURN_MS, canRebuyTx, canStandUpTx, clampRaise, facing, legalActions, potWon, preActionIntent, stackRaise, type Facing, type PreAction } from "@/lib/texasholdem";
import type { TxConnection, TxIntent, TxPlayer } from "@/lib/texasholdem/types";

export const LOW_SECS = 5; // the clock turns urgent and your phone buzzes again at this many seconds left

export function Panel({
  conn,
  me,
  myTurn,
  dealing,
  revealed,
  secs,
}: {
  conn: TxConnection;
  me: TxPlayer | undefined;
  myTurn: boolean;
  dealing: boolean;
  revealed: boolean;
  secs: number | null;
}) {
  const { game } = conn;
  const inHand = !!me && me.cards.length > 0;
  const acting = game.players.find((p) => p.id === game.turnId);
  const street = game.phase !== "lobby" && game.phase !== "showdown";

  // A queued move is dropped when its street or hand ends, or once your turn has come and gone:
  // the bet it was chosen against is no longer there.
  const [pre, setPre] = useState<PreAction | null>(null);
  const [preScope, setPreScope] = useState(`${game.round}-${game.phase}`);
  const [wasMyTurn, setWasMyTurn] = useState(myTurn);
  if (preScope !== `${game.round}-${game.phase}`) {
    setPreScope(`${game.round}-${game.phase}`);
    setPre(null);
  }
  if (wasMyTurn !== myTurn) {
    setWasMyTurn(myTurn);
    if (!myTurn) setPre(null);
  }
  const canQueue = inHand && !me.folded && !me.allIn && !me.sitOut && street && !game.runout && !myTurn;
  const now = canQueue ? facing(game, me) : null;
  if (pre && now && preActionIntent(pre, now) === null) setPre(null);

  // Your turn with a queued move that still fits: it goes out at once instead of showing the buttons.
  const turnLegal = myTurn && !dealing && conn.status === "open" ? legalActions(game, conn.you) : null;
  const queued = pre && turnLegal ? preActionIntent(pre, turnLegal) : null;
  const queuedType = queued?.type ?? null;
  const { send } = conn;
  useEffect(() => {
    if (!queuedType) return;
    tap();
    send({ type: queuedType });
  }, [queuedType, send]);

  let view: string;
  let body: ReactNode;
  if (!me || me.seat === null) {
    view = "rail";
    const open = game.players.filter((p) => p.seat !== null).length < 8;
    body = <Status>{open ? "Tap an open seat to sit down" : "Every seat is taken. You're watching from the rail."}</Status>;
  } else if (game.phase === "showdown" && inHand) {
    view = `showdown-${revealed}`;
    body = revealed ? <MyResult conn={conn} me={me} secs={secs} /> : <Status>Showdown…</Status>;
  } else if (!inHand) {
    view = `idle-${game.phase}-${me.sitOut}`;
    body = <Idle conn={conn} me={me} secs={secs} />;
  } else if (game.runout) {
    view = "runout";
    body = <Status>{me.folded ? "Folded. Watching the board run out…" : "All in. Running it out…"}</Status>;
  } else if (street && dealing) {
    view = "dealing";
    body = <Status>Dealing…</Status>;
  } else if (queued) {
    view = "queued";
    body = <Status>Playing your queued move…</Status>;
  } else if (myTurn) {
    view = "turn";
    body = <Actions conn={conn} me={me} secs={secs} />;
  } else {
    view = "wait";
    body = (
      <>
        <TurnClock label={`${acting?.name ?? "Someone"}'s turn`} secs={secs} />
        <Status>{me.folded ? "You folded. Waiting for the next hand…" : me.allIn ? "You're all in. Waiting on the table…" : "Waiting for your turn…"}</Status>
        {now && <PreActions now={now} pre={pre} onChange={setPre} />}
      </>
    );
  }

  // Re-keyed per state so each change (your move, a result, between hands) eases in instead of snapping.
  // The floor is the tallest view (your move, 210px of content) plus the home-indicator inset that pb-safe-3 adds,
  // so the felt above never resizes when your turn starts.
  return (
    <footer className="flex min-h-[calc(226px+env(safe-area-inset-bottom))] flex-col justify-center px-4 pt-1 pb-safe-3">
      <div key={view} className="tx-rise flex flex-col gap-2">
        {me?.timedOut && <TimedOutNotice conn={conn} />}
        {body}
      </div>
    </footer>
  );
}

// The only turn countdown: kept down here in the panel, away from the cards and chips on the felt.
function TurnClock({ label, secs }: { label: ReactNode; secs: number | null }) {
  const total = TURN_MS / 1000;
  const pct = secs === null ? 100 : Math.min(100, (secs / total) * 100);
  const low = secs !== null && secs <= LOW_SECS;
  return (
    <div className="flex flex-col gap-1.5" role="timer" aria-label={secs === null ? undefined : `${secs} seconds left`}>
      <div className="flex items-baseline justify-between font-display text-[13px] tracking-wide">
        <span className="truncate">{label}</span>
        {secs !== null && <span className={cx("text-[15px] font-semibold tabular-nums", low ? "tx-low text-danger" : "text-muted")}>{secs}s</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cx("h-full origin-left rounded-full transition-[width] duration-1000 ease-linear motion-reduce:transition-none", low ? "tx-low bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Shown on every panel view until they sit back in, so a clock-forced sit out is never a silent surprise.
function TimedOutNotice({ conn }: { conn: TxConnection }) {
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-2xl border border-danger px-4 py-2 text-sm">
      <span>You timed out and were sat out.</span>
      <button
        type="button"
        onClick={() => (tap(), conn.send({ type: "sitIn" }))}
        className="min-h-11 shrink-0 text-xs font-bold tracking-[0.16em] text-accent uppercase active:text-fg"
      >
        Sit back in
      </button>
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="grid min-h-14 place-items-center rounded-2xl border border-line bg-surface px-4 text-center text-sm text-muted">
      {children}
    </p>
  );
}

// Moves you can queue while others act: tap again to clear. Check and Call X drop out if the bet changes before your turn.
function PreActions({ now, pre, onChange }: { now: Facing; pre: PreAction | null; onChange: (pre: PreAction | null) => void }) {
  const options: { action: PreAction; label: string }[] = [{ action: { type: "checkFold" }, label: "Check / Fold" }];
  if (now.canCheck) options.push({ action: { type: "check" }, label: "Check" }, { action: { type: "callAny" }, label: "Call any" });
  else options.push({ action: { type: "call", amount: now.callAmount }, label: `Call ${shortAmount(now.callAmount)}` });

  return (
    <div className="flex gap-2">
      {options.map(({ action, label }) => {
        const on = pre?.type === action.type;
        return (
          <button
            key={action.type}
            type="button"
            aria-pressed={on}
            onClick={() => (tap(), onChange(on ? null : action))}
            className={cx(chipButton, "flex-1 px-2 text-xs font-bold tracking-wide uppercase", on ? "border-accent bg-accent/15 text-accent" : "text-muted")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const chipButton =
  "flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-line bg-surface transition-[background-color,transform,opacity] duration-150 active:scale-[0.96] active:bg-surface-2 disabled:opacity-30";

const linkButton = "min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg disabled:opacity-30";

// Seated but not in this hand: waiting for the next deal, sitting out, or busted.
function Idle({ conn, me, secs }: { conn: TxConnection; me: TxPlayer; secs: number | null }) {
  const { game } = conn;
  const send = (intent: TxIntent) => {
    tap();
    conn.send(intent);
  };

  let status: ReactNode;
  if (canRebuyTx(me)) status = "Out of chips. Rebuy to play the next hand.";
  else if (game.phase !== "lobby") status = "Next hand you're dealt in.";
  else if (me.sitOut) status = "You're sitting out.";
  else if (game.startAt !== null) status = `Next hand in ${secs ?? "…"}s`;
  else status = "Waiting for another player to join…";

  return (
    <>
      <Status>{status}</Status>
      {canRebuyTx(me) && (
        <Button size="lg" block onClick={() => (success(), conn.send({ type: "rebuy" }))}>
          Rebuy {START_CHIPS.toLocaleString()}
        </Button>
      )}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => send({ type: "standUp" })} disabled={!canStandUpTx(me)} className={linkButton}>
          Stand up
        </button>
        <button type="button" onClick={() => send({ type: me.sitOut ? "sitIn" : "sitOut" })} className={linkButton}>
          {me.sitOut ? "Sit in" : "Sit out"}
        </button>
      </div>
    </>
  );
}

function Actions({ conn, me, secs }: { conn: TxConnection; me: TxPlayer; secs: number | null }) {
  const { game } = conn;
  const legal = legalActions(game, conn.you);
  const [raiseTo, setRaiseTo] = useState(() => legal?.minRaiseTo ?? 0);

  useEffect(() => {
    success();
  }, []);

  useEffect(() => {
    if (secs === LOW_SECS) fail();
  }, [secs]);

  if (!legal) return <Status>Waiting…</Status>;

  const { callAmount, canCheck, canRaise, minRaiseTo, maxRaiseTo } = legal;
  const amount = clampRaise(raiseTo, minRaiseTo, maxRaiseTo);
  const allIn = amount >= maxRaiseTo;
  const go = (intent: TxIntent) => {
    tap();
    conn.send(intent);
  };

  return (
    <>
      <TurnClock
        label={
          <>
            Your move · pot <span className="text-accent tabular-nums">{game.pot.toLocaleString()}</span>
          </>
        }
        secs={secs}
      />
      {canRaise && (
        <div className="grid grid-cols-5 items-center gap-2">
          {RAISE_CHIPS.map((bb) => {
            const add = bb * BIG_BLIND;
            return (
              <button
                key={bb}
                type="button"
                aria-label={`Add ${bb} big blind${bb === 1 ? "" : "s"}, ${add} chips`}
                disabled={allIn}
                onClick={() => (tap(), setRaiseTo(stackRaise(amount, bb, minRaiseTo, maxRaiseTo)))}
                className={chipButton}
              >
                <Chip amount={add} label={`+${shortAmount(add)}`} />
              </button>
            );
          })}
          <button type="button" onClick={() => (tap(), setRaiseTo(maxRaiseTo))} disabled={allIn} className={cx(chipButton, "text-xs font-bold tracking-wide text-accent uppercase")}>
            All-in
          </button>
          <button type="button" onClick={() => (tap(), setRaiseTo(minRaiseTo))} disabled={amount === minRaiseTo} className={cx(chipButton, "text-xs font-bold tracking-wide text-muted uppercase")}>
            Min
          </button>
        </div>
      )}
      <div className={cx("grid gap-2.5", canRaise ? "grid-cols-2" : "grid-cols-1")}>
        <Button size="md" variant="secondary" className="min-h-14 px-2" onClick={() => go({ type: canCheck ? "check" : "call" })}>
          {canCheck ? (
            "Check"
          ) : (
            <Label top={callAmount >= me.chips ? "All-in" : "Call"} bottom={shortAmount(callAmount)} />
          )}
        </Button>
        {canRaise && (
          <Button size="md" className="min-h-14 px-2" onClick={() => go(allIn ? { type: "allIn" } : { type: "bet", amount })}>
            <Label top={allIn ? "All-in" : game.currentBet === 0 ? "Bet" : "Raise to"} bottom={shortAmount(amount)} />
          </Button>
        )}
      </div>
      <HoldToFold onFold={() => (fail(), conn.send({ type: "fold" }))} />
    </>
  );
}

// Fold only goes through after a deliberate hold, so a stray tap can't throw the hand away.
// Works with touch, mouse and the keyboard (hold Space or Enter); letting go early cancels.
function HoldToFold({ onFold }: { onFold: () => void }) {
  const [held, setHeld] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFoldRef = useRef(onFold);
  useEffect(() => {
    onFoldRef.current = onFold;
  });

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (tick.current) clearInterval(tick.current);
    timer.current = null;
    tick.current = null;
    setHeld(null);
  }, []);

  const start = useCallback(() => {
    if (timer.current) return;
    const t0 = Date.now();
    tap();
    setHeld(0);
    tick.current = setInterval(() => setHeld(Math.min(FOLD_HOLD_MS, Date.now() - t0)), 100);
    timer.current = setTimeout(() => {
      stop();
      onFoldRef.current();
    }, FOLD_HOLD_MS);
  }, [stop]);

  useEffect(() => stop, [stop]);

  const left = held === null ? null : Math.max(1, Math.ceil((FOLD_HOLD_MS - held) / 1000));
  return (
    <button
      type="button"
      aria-label="Fold, hold for 3 seconds"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="press relative min-h-14 touch-none overflow-hidden rounded-2xl border border-danger/60 bg-surface font-display text-sm tracking-wide text-danger uppercase select-none [--press-shadow:var(--color-danger-deep)]"
    >
      {held !== null && <span aria-hidden className="tx-hold absolute inset-y-0 left-0 w-full bg-danger/70" />}
      <span className={cx("relative", held !== null && "text-ink")}>{left === null ? "Hold to fold" : `Keep holding… ${left}s`}</span>
    </button>
  );
}

function Label({ top, bottom }: { top: string; bottom: string }) {
  return (
    <span className="flex flex-col items-center gap-1 leading-none">
      <span className="text-[11px] tracking-[0.12em] opacity-70">{top}</span>
      <span className="text-lg tabular-nums">{bottom}</span>
    </span>
  );
}

function MyResult({ conn, me, secs }: { conn: TxConnection; me: TxPlayer; secs: number | null }) {
  const { game } = conn;
  const result = me.result;
  const net = result?.net ?? 0;
  const take = result?.won ?? 0;
  const won = take > 0;
  const pot = potWon(game.players);
  const onlyLive = game.players.filter((p) => p.cards.length > 0 && !p.folded).length === 1;
  const canShow = !me.folded && onlyLive && !me.shown && result?.hand == null;

  useEffect(() => {
    if (won) success();
    else if (net < 0) fail();
  }, [won, net]);

  return (
    <>
      <div className="tx-in flex flex-col items-center gap-1 rounded-2xl border border-line bg-surface py-4">
        <p className={cx("font-display text-3xl", won ? "text-active" : me.folded ? "text-muted" : "text-danger")}>{won ? (net > 0 ? "YOU WIN" : "SPLIT POT") : me.folded ? "FOLDED" : "LOST"}</p>
        {result?.hand && <p className="text-sm text-muted">{result.hand}</p>}
        <p className="font-display text-lg tabular-nums">{net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `−${(-net).toLocaleString()}` : "Even"}</p>
        {won && take < pot && <p className="text-sm text-muted tabular-nums">{`Won ${take.toLocaleString()} of ${pot.toLocaleString()}`}</p>}
        <p className="text-sm text-muted tabular-nums">Stack {me.chips.toLocaleString()}</p>
        {secs !== null && <p className="text-xs text-muted tabular-nums">Next hand in {secs}s</p>}
      </div>
      {canShow && (
        <Button variant="secondary" block onClick={() => (tap(), conn.send({ type: "show" }))}>
          Show hand
        </Button>
      )}
    </>
  );
}
