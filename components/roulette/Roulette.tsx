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
import { BET_MS, LAND_MS, MAX_INSIDE, MAX_OUTSIDE, MIN_BET, SEATS, SETTLE_MS, SPIN_MS, START_CHIPS, colorOf } from "@/lib/roulette";
import type { RlBet, RlConnection, RlPlayer, RlSpot, RlState } from "@/lib/roulette/types";
import { Board } from "./Board";
import { Wheel } from "./Wheel";

const RACK = CHIPS.map((c) => c.value).filter((v) => v >= MIN_BET && v <= 500);
const HOLD_MS = 1800; // the big wheel lingers on the result before the layout shows who won
const stake = (bets: readonly RlBet[]) => bets.reduce((sum, b) => sum + b.amount, 0);
const signed = (n: number) => (n > 0 ? `+${shortAmount(n)}` : n < 0 ? `−${shortAmount(-n)}` : "±0");
const COLOR_NAME = { red: "RED", black: "BLACK", green: "GREEN" } as const;

// Settle opens with the ball still dropping: results, history and winnings wait until it lands.
function useSettleBeats({ game, deadlineAt }: RlConnection): { landed: boolean; overlay: boolean } {
  const start = game.phase === "settle" && deadlineAt !== undefined ? deadlineAt - SETTLE_MS : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [start]);
  if (game.phase === "spinning") return { landed: false, overlay: true };
  if (game.phase !== "settle") return { landed: false, overlay: false };
  if (start === null) return { landed: true, overlay: false };
  return { landed: now >= start + LAND_MS, overlay: now < start + LAND_MS + HOLD_MS };
}

export function Roulette({ conn }: { conn: RlConnection }) {
  const { game } = conn;
  const [toast, setToast] = useState<string | null>(null);
  const [chip, setChip] = useState(25);
  const { landed, overlay } = useSettleBeats(conn);
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

      <section className="grid grid-cols-[auto_1fr] items-center gap-3 px-3 pb-1" aria-label="Wheel">
        <Wheel
          phase={game.phase}
          result={game.result}
          last={history.at(-1) ?? null}
          lit={result}
          deadlineAt={conn.deadlineAt}
          className="size-[clamp(80px,24vw,92px)] drop-shadow-[0_6px_10px_oklch(0_0_0/0.55)]"
        />
        <Info game={game} secs={left} landed={landed} history={history} />
      </section>

      <SeatStrip conn={conn} me={me} revealed={landed} />

      <div className="relative min-h-0 flex-1">
        <div className="rl-scroll h-full overflow-y-auto overscroll-contain px-3.5 pt-3.5 pb-4">
          <Board players={game.players} you={conn.you} open={open} win={result} onPlace={place} />
        </div>
        {game.phase !== "betting" && <Stage game={game} open={overlay} landed={landed} deadlineAt={conn.deadlineAt} />}
      </div>

      <Panel conn={conn} me={me} amount={amount} setChip={setChip} secs={left} landed={landed} />
    </main>
  );
}

function Info({ game, secs, landed, history }: { game: RlState; secs: number | null; landed: boolean; history: readonly number[] }) {
  const total = game.phase === "betting" ? BET_MS : game.phase === "spinning" ? SPIN_MS : SETTLE_MS;
  const timed = game.phase !== "spinning" && secs !== null;
  const pct = secs === null ? 0 : Math.min(100, (secs / (total / 1000)) * 100);
  const result = landed ? game.result : null;
  const title =
    game.phase === "betting" ? "Place your bets" : game.phase === "spinning" ? "No more bets" : result === null ? "Ball dropping…" : null;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-col gap-1" role="timer" aria-label={timed ? `${secs} seconds left` : undefined}>
        <div className="flex items-center justify-between gap-2 font-display text-sm tracking-wide">
          {title !== null ? (
            <span className="truncate">{title}</span>
          ) : (
            <span key={game.round} className="rl-hero flex items-center gap-2">
              <span className="rl-pill grid h-7 min-w-9 place-items-center rounded-md px-1.5 font-sans text-lg font-bold tabular-nums" data-c={colorOf(result ?? 0)}>
                {result}
              </span>
              <span className="text-xs text-muted">{COLOR_NAME[colorOf(result ?? 0)]}</span>
            </span>
          )}
          {timed && <span className={cx("tabular-nums", secs <= 5 ? "text-danger" : "text-muted")}>{secs}s</span>}
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={cx("h-full rounded-full transition-[width] duration-1000 ease-linear", timed && secs <= 5 ? "bg-danger" : "bg-accent", game.phase === "spinning" && "animate-pulse")}
            style={{ width: game.phase === "spinning" ? "100%" : `${pct}%` }}
          />
        </div>
        {game.phase === "betting" && (
          <p className="text-[11px] leading-tight text-muted tabular-nums">
            {secs === null ? "The wheel spins once someone bets" : `Bets ${MIN_BET}–${MAX_INSIDE} · outside to ${shortAmount(MAX_OUTSIDE)}`}
          </p>
        )}
      </div>
      <ol aria-label="Recent results" className="flex flex-wrap gap-[3px]">
        {history.length === 0 && <li className="text-[11px] text-muted">No spins yet</li>}
        {[...history].reverse().map((n, i) => (
          <li
            key={`${history.length - i}`}
            data-c={colorOf(n)}
            className={cx("rl-pill grid size-5 place-items-center rounded-[5px] font-sans text-[10px] font-bold tabular-nums", i === 0 && "ring-2 ring-accent")}
          >
            {n}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SeatStrip({ conn, me, revealed }: { conn: RlConnection; me: RlPlayer | undefined; revealed: boolean }) {
  const { game } = conn;
  const canSit = game.phase === "betting" && !!me && me.bets.length === 0;
  return (
    <ul aria-label="Seats" className="grid grid-cols-8 px-2 pt-1">
      {Array.from({ length: SEATS }, (_, seat) => {
        const p = game.players.find((x) => x.seat === seat);
        const note = p ? (revealed && p.result ? p.result.net : stake(p.bets)) : 0;
        return (
          <li key={seat} className="flex min-w-0 justify-center">
            {p ? (
              <span className={cx("flex min-h-[46px] w-full min-w-0 flex-col items-center gap-px", !p.connected && "opacity-50")}>
                <span className={cx("relative rounded-full", p.id === conn.you && "ring-2 ring-accent ring-offset-1 ring-offset-bg")}>
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
              </span>
            ) : (
              <button
                type="button"
                disabled={!canSit}
                onClick={() => (tap(), conn.send({ type: "sit", seat }))}
                aria-label={`Sit in seat ${seat + 1}`}
                className="flex min-h-[46px] w-full flex-col items-center gap-px active:scale-95 disabled:opacity-40"
              >
                <span
                  className={cx(
                    "grid size-7 place-items-center rounded-full border-2 border-dashed text-xs font-bold",
                    canSit && me?.seat === null ? "border-accent text-accent" : "border-fg/25 text-fg/40",
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

// The big wheel over the layout while the ball is in play, then the result and the winners before the layout takes over.
function Stage({ game, open, landed, deadlineAt }: { game: RlState; open: boolean; landed: boolean; deadlineAt: number | undefined }) {
  const winners = game.players.filter((p) => p.result && p.result.net > 0);
  const result = landed ? game.result : null;
  return (
    <div
      className="rl-overlay absolute inset-0 z-20 grid place-items-center rounded-xl bg-bg/92 backdrop-blur-sm"
      data-open={open}
      style={{ containerType: "size" }}
      aria-hidden={!open}
    >
      <div className="flex flex-col items-center gap-2">
        <Wheel
          phase={game.phase}
          result={game.result}
          last={null}
          lit={result}
          deadlineAt={deadlineAt}
          className="size-[min(78cqw,calc(100cqh-96px))] drop-shadow-[0_14px_18px_oklch(0_0_0/0.6)]"
        />
        <div className="grid min-h-[76px] place-items-center text-center" aria-live="polite">
          {result === null ? (
            <p className="font-display text-base tracking-[0.14em] text-muted uppercase">{game.phase === "spinning" ? "No more bets" : "Ball dropping…"}</p>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <p className="rl-hero flex items-center gap-3">
                <span className="rl-medal grid size-12 place-items-center rounded-full font-sans text-2xl font-bold tabular-nums" data-c={colorOf(result)}>
                  {result}
                </span>
                <span className="font-display text-sm tracking-[0.14em] text-muted">{COLOR_NAME[colorOf(result)]}</span>
              </p>
              <p className="rl-rise text-xs text-muted">
                {winners.length === 0
                  ? "No winners this spin"
                  : winners
                      .slice(0, 3)
                      .map((p) => `${p.name} ${signed(p.result?.net ?? 0)}`)
                      .join(" · ")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="grid min-h-16 place-items-center rounded-2xl border border-line bg-surface px-4 text-center text-sm text-muted">
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
            Tap a glowing <span className="font-semibold text-accent">+</span> above to take a seat
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
    body = <Status>{`${stake(me.bets).toLocaleString()} on the table. Good luck.`}</Status>;
  } else {
    view = "result";
    body = <MyResult net={me.result.net} secs={secs} />;
  }

  return (
    <footer className="flex min-h-[152px] flex-col justify-end px-4 pt-1 pb-safe-2">
      <div key={view} className="rl-rise flex flex-col gap-1.5">
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
      <div className="grid grid-cols-5 items-end justify-items-center pt-1.5" role="radiogroup" aria-label="Chip value">
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
              "relative grid size-12 place-items-center rounded-full transition-transform duration-200 ease-(--ease-out) active:scale-[0.96] disabled:opacity-30",
              v === amount && "-translate-y-1",
            )}
          >
            <Chip amount={v} className="size-[44px]! text-xs!" />
            {v === amount && <span aria-hidden className="absolute -bottom-1 h-[3px] w-5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr] gap-1.5">
        <button
          type="button"
          aria-label="Stand up"
          onClick={() => (tap(), conn.send({ type: "standUp" }))}
          className="min-h-10 rounded-xl px-2 text-[11px] font-bold tracking-[0.12em] text-muted uppercase transition-colors active:text-fg"
        >
          Stand
        </button>
        <Pill disabled={me.bets.length === 0} onClick={() => act("undo")}>
          Undo
        </Pill>
        <Pill disabled={me.bets.length === 0} onClick={() => act("clear")}>
          Clear
        </Pill>
        <Pill disabled={me.bets.length > 0 || me.lastBets.length === 0 || me.chips < stake(me.lastBets)} onClick={() => act("rebet")}>
          Rebet
        </Pill>
        <Pill disabled={total === 0 || me.chips < total} onClick={() => act("double")}>
          Double
        </Pill>
      </div>
      <Button size="md" block disabled={me.ready || total === 0} onClick={() => (success(), conn.send({ type: "ready" }))}>
        {total === 0
          ? "Tap the layout to bet"
          : me.ready
            ? waiting > 0 && secs !== null
              ? `Spinning in ${secs}s`
              : "Spinning…"
            : secs !== null
              ? `Spin ${shortAmount(total)} · ${secs}s`
              : `Spin ${shortAmount(total)}`}
      </Button>
    </>
  );
}

function Pill({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-10 rounded-xl border border-line bg-surface-2 text-xs font-bold tracking-[0.08em] text-fg uppercase transition-[transform,opacity] duration-150 ease-(--ease-out) active:scale-[0.96] disabled:opacity-35"
    >
      {children}
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
