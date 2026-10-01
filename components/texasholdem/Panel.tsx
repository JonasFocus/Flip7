"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { shortAmount } from "@/components/casino/Chip";
import { fail, success, tap } from "@/lib/client/haptics";
import { BIG_BLIND, START_CHIPS, TURN_MS, legalActions } from "@/lib/texasholdem";
import type { TxConnection, TxIntent, TxPlayer } from "@/lib/texasholdem/types";

const PRESETS = [
  { label: "Min", fraction: null },
  { label: "½ pot", fraction: 0.5 },
  { label: "Pot", fraction: 1 },
] as const;

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

  let view: string;
  let body: ReactNode;
  if (!me || me.seat === null) {
    view = "rail";
    const open = game.players.filter((p) => p.seat !== null).length < 8;
    body = <Status>{open ? <>Tap a glowing <b className="text-accent">SIT</b> to take a seat</> : "Every seat is taken. You're watching from the rail."}</Status>;
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
  } else if (myTurn) {
    view = "turn";
    body = <Actions conn={conn} me={me} secs={secs} />;
  } else {
    view = "wait";
    body = (
      <>
        <TurnClock label={`${acting?.name ?? "Someone"}'s turn`} secs={secs} />
        <Status>{me.folded ? "You folded. Waiting for the next hand…" : me.allIn ? "You're all in. Waiting on the table…" : "Waiting for your turn…"}</Status>
      </>
    );
  }

  // Re-keyed per state so each change (your move, a result, between hands) eases in instead of snapping.
  return (
    <footer className="flex min-h-[196px] flex-col justify-center px-4 pt-1 pb-safe-3">
      <div key={view} className="tx-rise flex flex-col gap-2">
        {body}
      </div>
    </footer>
  );
}

// The only turn countdown: kept down here in the panel, away from the cards and chips on the felt.
function TurnClock({ label, secs }: { label: ReactNode; secs: number | null }) {
  const total = TURN_MS / 1000;
  const pct = secs === null ? 100 : Math.min(100, (secs / total) * 100);
  const low = secs !== null && secs <= 5;
  return (
    <div className="flex flex-col gap-1.5" role="timer" aria-label={secs === null ? undefined : `${secs} seconds left`}>
      <div className="flex items-baseline justify-between font-display text-[13px] tracking-wide">
        <span className="truncate">{label}</span>
        {secs !== null && <span className={cx("tabular-nums", low ? "text-danger" : "text-muted")}>{secs}s</span>}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div className={cx("h-full origin-left rounded-full transition-[width] duration-1000 ease-linear", low ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
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

const presetClass = (on: boolean) =>
  cx(
    "flex min-h-11 flex-col items-center justify-center rounded-xl border text-xs leading-tight font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.96]",
    on ? "border-accent/70 bg-accent/15 text-accent" : "border-line bg-surface text-muted active:bg-surface-2 active:text-fg",
  );

const linkButton = "min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg disabled:opacity-30";

// Seated but not in this hand: waiting for the next deal, sitting out, or busted.
function Idle({ conn, me, secs }: { conn: TxConnection; me: TxPlayer; secs: number | null }) {
  const { game } = conn;
  const broke = me.chips < BIG_BLIND;
  const send = (intent: TxIntent) => {
    tap();
    conn.send(intent);
  };

  let status: ReactNode;
  if (game.phase !== "lobby") status = "Next hand you're dealt in.";
  else if (me.sitOut) status = "You're sitting out.";
  else if (broke) status = "Out of chips. Rebuy to play the next hand.";
  else if (game.startAt !== null) status = `Next hand in ${secs ?? "…"}s`;
  else status = "Waiting for another player to join…";

  return (
    <>
      <Status>{status}</Status>
      {broke && game.phase === "lobby" && (
        <Button size="lg" block onClick={() => (success(), conn.send({ type: "rebuy" }))}>
          Rebuy {START_CHIPS.toLocaleString()}
        </Button>
      )}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => send({ type: "standUp" })} disabled={game.phase !== "lobby"} className={linkButton}>
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
    tap();
  }, []);

  if (!legal) return <Status>Waiting…</Status>;

  const { callAmount, canCheck, canRaise, minRaiseTo, maxRaiseTo } = legal;
  const amount = Math.min(maxRaiseTo, Math.max(minRaiseTo, raiseTo));
  const allIn = amount >= maxRaiseTo;
  const potAfterCall = game.pot + callAmount;
  const clamp = (n: number) => Math.min(maxRaiseTo, Math.max(minRaiseTo, n));
  const presetTarget = (fraction: number | null) => clamp(fraction === null ? minRaiseTo : game.currentBet + Math.round(potAfterCall * fraction));
  const preset = (fraction: number | null) => {
    tap();
    setRaiseTo(presetTarget(fraction));
  };
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
        <>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" onClick={() => preset(p.fraction)} className={presetClass(amount === presetTarget(p.fraction))}>
                <span>{p.label}</span>
                <span className="font-display text-[10px] tabular-nums opacity-70">{shortAmount(presetTarget(p.fraction))}</span>
              </button>
            ))}
            <button type="button" onClick={() => preset(Infinity)} className={presetClass(amount === maxRaiseTo)}>
              <span>All-in</span>
              <span className="font-display text-[10px] tabular-nums opacity-70">{shortAmount(maxRaiseTo)}</span>
            </button>
          </div>
          <input
            type="range"
            aria-label="Raise amount"
            min={minRaiseTo}
            max={maxRaiseTo}
            step={1}
            value={amount}
            onChange={(e) => {
              const v = Number(e.target.value);
              // Snap to small-blind steps so the amount reads cleanly; the ends stay exact.
              setRaiseTo(v >= maxRaiseTo || v <= minRaiseTo ? v : Math.round(v / 10) * 10);
            }}
            className="tx-range"
          />
        </>
      )}
      <div className={cx("grid gap-2.5", canRaise ? "grid-cols-[1fr_1.15fr_1.5fr]" : "grid-cols-2")}>
        <Button size="md" variant="danger" className="min-h-14 px-2" onClick={() => (fail(), conn.send({ type: "fold" }))}>
          Fold
        </Button>
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
    </>
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
  const won = (result?.won ?? 0) > 0;
  const onlyLive = game.players.filter((p) => p.cards.length > 0 && !p.folded).length === 1;
  const canShow = !me.folded && onlyLive && !me.shown;

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
