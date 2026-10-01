"use client";

import { useEffect, useState, type ReactNode } from "react";
import "./roulette.css";
import { CHIPS, Chip, shortAmount } from "@/components/casino/Chip";
import { shareInvite } from "@/components/lobby/Lobby";
import { useSecondsLeft } from "@/components/table/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { fail, success, tap } from "@/lib/client/haptics";
import { BET_MS, LAND_MS, MAX_INSIDE, MAX_OUTSIDE, MIN_BET, SEATS, SETTLE_MS, START_CHIPS, colorOf } from "@/lib/roulette";
import type { RlBet, RlConnection, RlPlayer, RlSpot, RlState } from "@/lib/roulette/types";
import { Board } from "./Board";
import { Wheel } from "./Wheel";

const RACK = CHIPS.map((c) => c.value).filter((v) => v >= MIN_BET && v <= 500);
const HOLD_MS = 2200; // the big wheel lingers on the result before it shrinks back and the layout takes over
const stake = (bets: readonly RlBet[]) => bets.reduce((sum, b) => sum + b.amount, 0);
const signed = (n: number) => (n > 0 ? `+${shortAmount(n)}` : n < 0 ? `−${shortAmount(-n)}` : "±0");
const COLOR_NAME = { red: "Red", black: "Black", green: "Green" } as const;

// Settle opens with the ball still dropping: results, history and winnings wait until it lands.
function useSettleBeats({ game, deadlineAt }: RlConnection): { landed: boolean; big: boolean } {
  const start = game.phase === "settle" && deadlineAt !== undefined ? deadlineAt - SETTLE_MS : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [start]);
  if (game.phase === "spinning") return { landed: false, big: true };
  if (game.phase !== "settle") return { landed: false, big: false };
  if (start === null) return { landed: true, big: false };
  return { landed: now >= start + LAND_MS, big: now < start + LAND_MS + HOLD_MS };
}

export function Roulette({ conn }: { conn: RlConnection }) {
  const { game } = conn;
  const [toast, setToast] = useState<string | null>(null);
  const [chip, setChip] = useState(25);
  const { landed, big } = useSettleBeats(conn);
  const left = useSecondsLeft(conn.deadlineAt);
  const me = game.players.find((p) => p.id === conn.you);
  const seated = !!me && me.seat !== null;
  const open = game.phase === "betting" && seated;
  const result = landed ? game.result : null;

  useEffect(() => {
    if (conn.error) fail();
  }, [conn.error]);

  const held = game.phase === "settle" && !landed && me?.result ? me.result.payout : 0;
  const balance = me ? me.chips - held : 0;
  const history = game.phase === "settle" && !landed ? game.history.slice(0, -1) : game.history;
  // Tapping a chip you can't cover falls back to the biggest one you can.
  const amount = chip <= balance ? chip : (RACK.filter((v) => v <= balance).at(-1) ?? MIN_BET);

  function place(spot: RlSpot) {
    if (!me || !open) return;
    if (amount > me.chips) return fail();
    tap();
    conn.send({ type: "place", spot, amount });
  }

  async function share() {
    tap();
    const msg = await shareInvite(conn.code);
    if (msg) setToast(msg);
  }

  return (
    <main className="rl-root mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-safe pt-safe select-none">
      <Toast message={toast ?? conn.error} tone={toast ? "accent" : "danger"} onDismiss={() => setToast(null)} />
      <header className="flex items-center justify-between gap-2 px-3">
        <Button variant="ghost" size="sm" className="-ml-2 px-3" onClick={conn.leave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <button
          type="button"
          onClick={share}
          aria-label={`Invite to table ${conn.code}`}
          className="min-h-11 rounded-full border border-line px-3 font-display text-xs tracking-[0.12em] text-muted tabular-nums transition-colors active:bg-surface-2"
        >
          #{conn.code}
        </button>
        <p className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-3 font-display text-sm tabular-nums text-accent" aria-label={`${balance} chips`}>
          <Chip amount={0} size="xs" label="" color="var(--color-accent)" />
          {balance.toLocaleString()}
        </p>
      </header>

      <StatusBar game={game} secs={left} result={result} history={history} />

      <section aria-label="Wheel" className="rl-stage" data-big={big || undefined}>
        <Wheel phase={game.phase} result={game.result} last={history.at(-1) ?? null} lit={result} deadlineAt={conn.deadlineAt} className="rl-stage-wheel" />
        {big && result !== null && <StageCaption game={game} result={result} />}
      </section>

      <SeatStrip conn={conn} me={me} revealed={landed} />

      <div className="rl-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-2">
        <Board players={game.players} you={conn.you} open={open} win={result} onPlace={place} />
      </div>

      <Panel conn={conn} me={me} amount={amount} setChip={setChip} secs={left} landed={landed} />
    </main>
  );
}

// One line that always says what's happening: the call (or the result), the clock, and the last numbers.
function StatusBar({ game, secs, result, history }: { game: RlState; secs: number | null; result: number | null; history: readonly number[] }) {
  const timed = game.phase === "betting" && secs !== null;
  const pct = timed ? Math.min(100, (secs / (BET_MS / 1000)) * 100) : game.phase === "betting" ? 100 : 0;
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-1">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          {result !== null ? (
            <p key={game.round} className="rl-hero flex items-center gap-2">
              <span className="rl-pill grid h-7 min-w-9 place-items-center rounded-md px-1.5 font-sans text-lg font-bold tabular-nums" data-c={colorOf(result)}>
                {result}
              </span>
              <span className="text-sm font-semibold text-fg/80">{COLOR_NAME[colorOf(result)]}</span>
            </p>
          ) : (
            <p className="truncate font-display text-sm tracking-wide">
              {game.phase === "betting" ? (secs === null ? "Place your bets" : "Bets closing") : game.phase === "spinning" ? "No more bets" : "Ball dropping…"}
              {timed && <span className={cx("ml-2 tabular-nums", secs <= 5 ? "text-danger" : "text-muted")}>{secs}s</span>}
            </p>
          )}
        </div>
        <ol aria-label="Recent results" className="flex max-w-[55%] gap-[3px] overflow-hidden">
          {[...history]
            .reverse()
            .slice(0, 9)
            .map((n, i) => (
              <li
                key={history.length - i}
                data-c={colorOf(n)}
                className={cx("rl-pill grid size-6 flex-none place-items-center rounded-md font-sans text-[11px] font-bold tabular-nums", i === 0 ? "ring-2 ring-accent" : "opacity-80")}
              >
                {n}
              </li>
            ))}
        </ol>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cx("h-full rounded-full transition-[width] duration-1000 ease-linear", timed && secs <= 5 ? "bg-danger" : "bg-accent", game.phase === "spinning" && "w-full animate-pulse")}
          style={game.phase === "spinning" ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// The landed number over the big wheel, with who won, before the wheel shrinks back.
function StageCaption({ game, result }: { game: RlState; result: number }) {
  const winners = game.players.filter((p) => p.result && p.result.net > 0);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-1 grid place-items-center text-center" aria-live="polite">
      <div className="flex flex-col items-center gap-1">
        <p className="rl-hero flex items-center gap-2.5">
          <span className="rl-medal grid size-12 place-items-center rounded-full font-sans text-2xl font-bold tabular-nums" data-c={colorOf(result)}>
            {result}
          </span>
        </p>
        <p className="rl-rise rounded-full bg-black/50 px-3 py-0.5 text-xs text-fg/80 backdrop-blur-sm">
          {winners.length === 0
            ? "House wins this one"
            : winners
                .slice(0, 3)
                .map((p) => `${p.name} ${signed(p.result?.net ?? 0)}`)
                .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function SeatStrip({ conn, me, revealed }: { conn: RlConnection; me: RlPlayer | undefined; revealed: boolean }) {
  const { game } = conn;
  const canSit = game.phase === "betting" && !!me && me.bets.length === 0;
  return (
    <ul aria-label="Seats" className="grid grid-cols-8 px-2 pt-1.5">
      {Array.from({ length: SEATS }, (_, seat) => {
        const p = game.players.find((x) => x.seat === seat);
        const note = p ? (revealed && p.result ? p.result.net : stake(p.bets)) : 0;
        return (
          <li key={seat} className="flex min-w-0 justify-center">
            {p ? (
              <SeatTag
                leave={p.id === conn.you && canSit ? () => (tap(), conn.send({ type: "standUp" })) : undefined}
                className={cx("flex min-h-[44px] w-full min-w-0 flex-col items-center gap-px", !p.connected && "opacity-50")}
              >
                <span className={cx("relative rounded-full", p.id === conn.you && "ring-2 ring-accent ring-offset-1 ring-offset-bg")}>
                  {p.id === conn.you && canSit && (
                    <span aria-hidden className="absolute -top-1 -right-1 z-10 grid size-3.5 place-items-center rounded-full bg-surface-2 text-[9px] leading-none text-fg ring-1 ring-line">
                      ×
                    </span>
                  )}
                  <Avatar id={p.id} seat={seat} name={p.name} size="sm" />
                  {p.ready && game.phase === "betting" && (
                    <span className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-active text-[9px] text-ink" aria-label="Ready">
                      ✓
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate text-[9px] leading-tight font-semibold text-fg/80">{p.id === conn.you ? "You" : p.name}</span>
                <span
                  className={cx(
                    "font-display text-[10px] leading-none tabular-nums",
                    revealed && p.result ? (p.result.net > 0 ? "text-active" : p.result.net < 0 ? "text-danger" : "text-muted") : "text-muted",
                  )}
                >
                  {revealed && p.result ? signed(note) : note > 0 ? shortAmount(note) : "·"}
                </span>
              </SeatTag>
            ) : (
              <button
                type="button"
                disabled={!canSit}
                onClick={() => (tap(), conn.send({ type: "sit", seat }))}
                aria-label={`Sit in seat ${seat + 1}`}
                className="flex min-h-[44px] w-full flex-col items-center justify-start gap-px transition-transform active:scale-95 disabled:opacity-40"
              >
                <span
                  className={cx(
                    "grid size-7 place-items-center rounded-full border-2 border-dashed text-xs font-bold",
                    canSit && me?.seat === null ? "rl-sit border-accent text-accent" : "border-fg/25 text-fg/40",
                  )}
                >
                  +
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Your own seat doubles as the "leave seat" button while you have nothing on the layout.
function SeatTag({ leave, className, children }: { leave: (() => void) | undefined; className: string; children: ReactNode }) {
  if (!leave) return <span className={className}>{children}</span>;
  return (
    <button type="button" aria-label="Leave seat" onClick={leave} className={cx(className, "transition-transform active:scale-95")}>
      {children}
    </button>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="grid min-h-14 place-items-center rounded-2xl border border-line bg-surface px-4 text-center text-sm text-muted">
      {children}
    </p>
  );
}

function Panel({
  conn,
  me,
  amount,
  setChip,
  secs,
  landed,
}: {
  conn: RlConnection;
  me: RlPlayer | undefined;
  amount: number;
  setChip: (v: number) => void;
  secs: number | null;
  landed: boolean;
}) {
  const { game } = conn;
  const openSeats = SEATS - game.players.filter((p) => p.seat !== null).length;

  let body: ReactNode;
  let view: string;
  if (!me || me.seat === null) {
    view = "rail";
    body = (
      <Status>
        {openSeats > 0 ? (
          <span>
            Tap a glowing <span className="font-semibold text-accent">+</span> to take a seat
          </span>
        ) : (
          "Every seat is taken. You're watching from the rail."
        )}
      </Status>
    );
  } else if (game.phase === "betting") {
    view = "bet";
    body = <Betting conn={conn} me={me} amount={amount} setChip={setChip} secs={secs} />;
  } else if (me.bets.length === 0) {
    view = "idle";
    body = <Status>{game.phase === "spinning" ? "Watching this spin. Bets open after the result." : "No bet on this spin."}</Status>;
  } else if (game.phase === "spinning" || !landed || !me.result) {
    view = "wait";
    body = (
      <Status>
        <span>
          <span className="font-semibold text-fg tabular-nums">{stake(me.bets).toLocaleString()}</span> riding on this spin
        </span>
      </Status>
    );
  } else {
    view = "result";
    body = <MyResult net={me.result.net} secs={secs} />;
  }

  return (
    <footer className="flex min-h-[148px] flex-col justify-end border-t border-line/60 bg-bg/80 px-3 pt-2 pb-safe-2 backdrop-blur">
      <div key={view} className="rl-rise flex flex-col gap-2">
        {body}
      </div>
    </footer>
  );
}

function Betting({ conn, me, amount, setChip, secs }: { conn: RlConnection; me: RlPlayer; amount: number; setChip: (v: number) => void; secs: number | null }) {
  const total = stake(me.bets);
  const broke = me.chips < MIN_BET && me.bets.length === 0;
  const waiting = conn.game.players.filter((p) => p.seat !== null && p.bets.length > 0 && !p.ready).length;
  const act = (type: "undo" | "clear" | "rebet" | "double") => {
    tap();
    conn.send({ type });
  };

  if (broke) {
    return (
      <>
        <Status>Out of chips. The house spots you another stack.</Status>
        <Button size="lg" block onClick={() => (success(), conn.send({ type: "rebuy" }))}>
          Rebuy {START_CHIPS.toLocaleString()}
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 px-1 tabular-nums">
        <p aria-live="polite" className="text-xs text-muted">
          Bet <span className={cx("ml-1 font-sans text-lg font-bold", total > 0 ? "text-fg" : "text-muted")}>{total.toLocaleString()}</span>
        </p>
        <p className="text-[11px] text-muted">
          {MIN_BET}–{MAX_INSIDE} inside · {shortAmount(MAX_OUTSIDE)} outside
        </p>
      </div>
      <div className="grid grid-cols-5 justify-items-center" role="radiogroup" aria-label="Chip value">
        {RACK.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={v === amount}
            aria-label={`${v} chip`}
            disabled={v > me.chips}
            onClick={() => (tap(), setChip(v))}
            className={cx(
              "relative grid size-12 place-items-center rounded-full transition-transform duration-200 ease-(--ease-out) active:scale-[0.94] disabled:opacity-30",
              v === amount ? "-translate-y-1 scale-110" : "opacity-80",
            )}
          >
            <Chip amount={v} className={cx("size-[42px]! text-xs!", v === amount && "rl-chip-on")} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Tool label="Undo" icon="↶" disabled={me.bets.length === 0} onClick={() => act("undo")} />
        <Tool label="Clear" icon="✕" disabled={me.bets.length === 0} onClick={() => act("clear")} />
        <Tool label="Rebet" icon="↻" disabled={me.bets.length > 0 || me.lastBets.length === 0 || me.chips < stake(me.lastBets)} onClick={() => act("rebet")} />
        <Tool label="Double" icon="×2" disabled={total === 0 || me.chips < total} onClick={() => act("double")} />
        <Button size="md" block className="flex-1" disabled={me.ready || total === 0} onClick={() => (success(), conn.send({ type: "ready" }))}>
          {total === 0 ? "Place a bet" : me.ready ? (waiting > 0 && secs !== null ? `Spin in ${secs}s` : "Spinning…") : "Spin"}
        </Button>
      </div>
    </>
  );
}

function Tool({ label, icon, disabled, onClick }: { label: string; icon: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 flex-none place-items-center rounded-2xl bg-surface-2 text-base font-medium text-fg/90 transition-[transform,opacity] duration-150 ease-(--ease-out) active:scale-[0.94] disabled:opacity-30"
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}

function MyResult({ net, secs }: { net: number; secs: number | null }) {
  useEffect(() => {
    if (net > 0) success();
    else if (net < 0) fail();
  }, [net]);
  return (
    <div
      className={cx(
        "rl-hero flex flex-col items-center gap-0.5 rounded-2xl border bg-surface py-3",
        net > 0 ? "border-active/60 shadow-[0_0_28px_-8px_var(--color-active)]" : "border-line",
      )}
    >
      <p className={cx("font-display text-2xl", net > 0 ? "text-active" : net < 0 ? "text-danger" : "text-stayed")}>{net > 0 ? "YOU WIN" : net < 0 ? "NO LUCK" : "BROKE EVEN"}</p>
      <p className="font-sans text-xl font-bold tabular-nums">{net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `−${(-net).toLocaleString()}` : "Stake returned"}</p>
      {secs !== null && <p className="text-xs text-muted tabular-nums">Bets open in {secs}s</p>}
    </div>
  );
}
