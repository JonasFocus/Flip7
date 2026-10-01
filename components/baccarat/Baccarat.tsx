"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./baccarat.css";
import { CardFace } from "@/components/casino/CardFace";
import { Chip, shortAmount } from "@/components/casino/Chip";
import { shareInvite } from "@/components/lobby/Lobby";
import { useSecondsLeft } from "@/components/table/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { fail, success, tap } from "@/lib/client/haptics";
import {
  BET_MS,
  DECKS,
  MAX_BET,
  MIN_BET,
  PAIR_PAYOUT,
  ROAD_LENGTH,
  SEATS,
  SETTLE_MS,
  SHOE_SIZE,
  START_CHIPS,
  TIE_PAYOUT,
  handTotal,
  totalBet,
} from "@/lib/baccarat";
import type { BacCard, BacConnection, BacPlayer, BacRound, BacSpot, BacState, BacWinner } from "@/lib/baccarat/types";

const RACK = [10, 25, 100, 500, 1000] as const;
const SPOT_LABEL: Record<BacSpot, string> = { player: "Player", banker: "Banker", tie: "Tie", playerPair: "P Pair", bankerPair: "B Pair" };
const SPOT_TONE: Record<BacSpot, string> = {
  player: "var(--bac-player)",
  banker: "var(--bac-banker)",
  tie: "var(--bac-tie)",
  playerPair: "var(--bac-player)",
  bankerPair: "var(--bac-banker)",
};
const SPOT_ODDS: Record<BacSpot, string> = {
  player: "1 : 1",
  banker: "0.95 : 1",
  tie: `${TIE_PAYOUT} : 1`,
  playerPair: `${PAIR_PAYOUT} : 1`,
  bankerPair: `${PAIR_PAYOUT} : 1`,
};
const WINNER_LABEL: Record<BacWinner, string> = { player: "PLAYER WINS", banker: "BANKER WINS", tie: "TIE" };
const WINNER_TONE: Record<BacWinner, string> = { player: "var(--bac-player)", banker: "var(--bac-banker)", tie: "var(--bac-tie)" };
const WINNER_LETTER: Record<BacWinner, string> = { player: "P", banker: "B", tie: "T" };

const SLIDE_MS = 420; // a dealt card glides out of the shoe
const FLIP_AFTER_MS = 300; // ...and turns face up as it lands
const SWEEP_MS = 600; // end of settle: cards clear before the table resets
const CARD = "clamp(38px, 6.6dvh, 54px)";
const FAN = 0.6; // each card shows this much (in card widths) of the one beneath

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n < 0 ? `−${(-n).toLocaleString()}` : "0");
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const stake = (p: BacPlayer) => totalBet(p.bets);

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// Counts a result up from zero so a win lands with a beat; jumps straight there under reduced motion.
function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - start) / ms);
      setValue(Math.round(target * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

export function Baccarat({ conn }: { conn: BacConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const [chip, setChip] = useState<number>(25);
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const secs = useSecondsLeft(conn.deadlineAt);
  const now = useNow(game.phase === "settle");
  const clearing = game.phase === "settle" && conn.deadlineAt !== undefined && now >= conn.deadlineAt - SWEEP_MS;

  async function share() {
    tap();
    const msg = await shareInvite(conn.code);
    if (msg) setToast(msg);
  }

  return (
    <main className="bac-root mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-safe pt-safe select-none">
      <Toast message={toast ?? conn.error} tone={toast ? "accent" : "danger"} onDismiss={() => setToast(null)} />
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <Button variant="ghost" size="sm" className="-ml-2 px-3" onClick={conn.leave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <button
          type="button"
          onClick={share}
          aria-label={`Invite to table ${conn.code}`}
          className="min-h-11 rounded-full border border-line px-3 font-display text-xs tracking-[0.12em] text-muted tabular-nums active:bg-surface-2"
        >
          #{conn.code}
        </button>
        <p className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-3 font-display text-sm tabular-nums text-accent" aria-label={`${me?.chips ?? 0} chips`}>
          <Chip amount={me?.chips ?? 0} size="xs" label="" color="var(--color-accent)" />
          {(me?.chips ?? 0).toLocaleString()}
        </p>
      </header>

      <Road road={game.road} />

      <Felt conn={conn} me={me} chip={chip} clearing={clearing} />

      <Panel conn={conn} me={me} chip={chip} setChip={setChip} secs={secs} />
    </main>
  );
}

function Road({ road }: { road: readonly BacRound[] }) {
  const count = (w: BacWinner) => road.filter((r) => r.winner === w).length;
  const slots = Array.from({ length: ROAD_LENGTH }, (_, i) => road[i]);
  const last = road.at(-1);
  return (
    <section aria-label="Road" className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]">
      <div role="img" aria-label={`Last ${road.length} results`} className="bac-road [--cell:12px]">
        {slots.map((r, i) =>
          r ? (
            <span key={`${road.length}-${i}`} className="bac-bead" data-latest={i === road.length - 1 || undefined} style={{ "--tone": WINNER_TONE[r.winner] } as CSSProperties}>
              {WINNER_LETTER[r.winner]}
              {r.playerPair && <i className="p" />}
              {r.bankerPair && <i className="b" />}
            </span>
          ) : (
            <span key={i} className="bac-bead" data-empty />
          ),
        )}
      </div>
      <dl className="grid flex-1 grid-cols-3 gap-1 text-center">
        {(["player", "banker", "tie"] as const).map((w) => (
          <div key={w}>
            <dt className="text-[9px] font-semibold tracking-[0.18em] uppercase" style={{ color: WINNER_TONE[w] }}>
              {w}
            </dt>
            <dd className="font-display text-xl tabular-nums leading-tight">{count(w)}</dd>
          </div>
        ))}
        <p className="col-span-3 pt-0.5 text-[10px] tracking-wide text-muted tabular-nums">{last ? `Last: ${WINNER_LABEL[last.winner].toLowerCase()} ${last.playerTotal}–${last.bankerTotal}` : "No coups yet"}</p>
      </dl>
    </section>
  );
}

function Felt({ conn, me, chip, clearing }: { conn: BacConnection; me: BacPlayer | undefined; chip: number; clearing: boolean }) {
  const { game } = conn;
  const betting = game.phase === "betting";
  const canBet = betting && !!me && me.seat !== null && !me.ready;
  const result = game.phase === "settle" ? game.result : null;

  function place(spot: BacSpot) {
    if (!me || !canBet) return;
    const cur = me.bets[spot];
    const room = me.chips - stake(me);
    const amount = Math.min(cur + chip, MAX_BET, cur + room);
    if (amount === cur || amount < MIN_BET) return fail();
    tap();
    conn.send({ type: "bet", spot, amount });
  }

  function remove(spot: BacSpot) {
    tap();
    conn.send({ type: "bet", spot, amount: 0 });
  }

  const zone = (spot: BacSpot, className: string, i: number) => (
    <Zone
      key={spot}
      spot={spot}
      className={className}
      index={i}
      game={game}
      me={me}
      canBet={canBet}
      win={result ? isWin(spot, result) : false}
      dim={result ? !isWin(spot, result) : false}
      onPlace={() => place(spot)}
      onRemove={() => remove(spot)}
    />
  );

  return (
    <section aria-label="Table" data-table className="relative mx-2 flex min-h-0 flex-1 flex-col px-2 pt-2 pb-[2%]">
      <div aria-hidden className="bac-felt absolute inset-x-0 top-0 bottom-0" />

      <div className="relative flex min-h-0 flex-1 items-start justify-between">
        <Shoe left={game.shoeLeft} />
        <Hands game={game} clearing={clearing} />
      </div>

      <div className="relative mb-2 flex min-h-8 items-center justify-center">
        {result ? <Verdict result={result} /> : <p className="bac-rule">Punto banco · {DECKS} decks</p>}
      </div>

      <div className="relative grid grid-cols-3 gap-1.5">
        {zone("playerPair", "h-[clamp(44px,7.2dvh,58px)]", 0)}
        {zone("tie", "h-[clamp(44px,7.2dvh,58px)]", 1)}
        {zone("bankerPair", "h-[clamp(44px,7.2dvh,58px)]", 2)}
      </div>
      <div className="relative mt-1.5 grid grid-cols-2 gap-1.5">
        {zone("player", "h-[clamp(60px,10.6dvh,84px)]", 3)}
        {zone("banker", "h-[clamp(60px,10.6dvh,84px)]", 4)}
      </div>

      <Seats conn={conn} me={me} />
    </section>
  );
}

const isWin = (spot: BacSpot, r: BacRound): boolean =>
  spot === "playerPair" ? r.playerPair : spot === "bankerPair" ? r.bankerPair : spot === r.winner;

function Shoe({ left }: { left: number }) {
  return (
    <div role="img" aria-label={`${left} cards left in the shoe`} className="flex w-9 flex-col items-center gap-1">
      <div data-shoe aria-hidden className="relative h-[34px] w-6">
        {[0, 1, 2].map((i) => (
          <CardFace key={i} card={null} size={22} className="absolute" style={{ left: i * 1.5, top: -i * 1.5 }} />
        ))}
      </div>
      <p className="font-display text-[10px] leading-none text-fg/80 tabular-nums">{left}</p>
      <span aria-hidden className="h-1 w-7 overflow-hidden rounded-full bg-ink/60">
        <span className="block h-full bg-fg/60" style={{ width: `${(left / SHOE_SIZE) * 100}%` }} />
      </span>
    </div>
  );
}

function Hands({ game, clearing }: { game: BacState; clearing: boolean }) {
  const settled = game.phase === "settle";
  return (
    <div className="flex flex-1 items-center justify-center gap-[clamp(12px,4vw,24px)] self-stretch pr-9">
      <Hand label="PLAYER" tone="var(--bac-player)" cards={game.playerHand} round={game.round} animate={game.phase === "dealing"} sweep={clearing} winner={settled && game.result?.winner === "player"} lost={settled && game.result?.winner === "banker"} />
      <Hand label="BANKER" tone="var(--bac-banker)" cards={game.bankerHand} round={game.round} animate={game.phase === "dealing"} sweep={clearing} winner={settled && game.result?.winner === "banker"} lost={settled && game.result?.winner === "player"} />
    </div>
  );
}

function Hand({
  label,
  tone,
  cards,
  round,
  animate,
  sweep,
  winner,
  lost,
}: {
  label: string;
  tone: string;
  cards: readonly BacCard[];
  round: number;
  animate: boolean;
  sweep: boolean;
  winner: boolean;
  lost: boolean;
}) {
  const n = cards.length;
  const total = handTotal(cards);
  return (
    <div className="bac-hand flex flex-col items-center gap-1.5" data-win={winner || undefined} data-lose={lost || undefined} style={{ "--tone": tone } as CSSProperties}>
      <div className="bac-cards relative flex items-end" style={{ width: `calc(${CARD} * ${1 + 2 * FAN})`, height: `calc(${CARD} * 1.4)` }}>
        {n === 0 && <span className="absolute bottom-0 left-0 rounded-md border border-dashed border-fg/20 bg-black/10" style={{ width: CARD, height: `calc(${CARD} * 1.4)` }} />}
        {cards.map((c, i) => (
          <DealtCard key={`${round}-${i}`} card={c} animate={animate} sweep={sweep} style={{ left: `calc(${CARD} * ${FAN * i})`, bottom: 0 }} />
        ))}
      </div>
      <p className="bac-hand-pill">
        <span>{label}</span>
        {n > 0 ? (
          <b key={n} style={{ animationDelay: animate ? `${SLIDE_MS + FLIP_AFTER_MS}ms` : "0ms" }} className="bac-total">
            {total}
          </b>
        ) : (
          <b className="opacity-40">–</b>
        )}
      </p>
    </div>
  );
}

// Slides out of the shoe face down, then turns over as it lands. A card already on the table at mount (a reload) just shows.
function DealtCard({ card, animate, sweep, style }: { card: BacCard; animate: boolean; sweep: boolean; style: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [onMount] = useState(animate && !reducedMotion());
  const [up, setUp] = useState(!onMount);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onMount) return;
    const shoe = el.closest("[data-table]")?.querySelector("[data-shoe]");
    if (!shoe) return;
    const a = el.getBoundingClientRect();
    const b = shoe.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const slide = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) rotate(-40deg) scale(0.6)` }, { transform: "translate(0, -4%) rotate(3deg) scale(1.05)", offset: 0.75 }, { transform: "none" }],
      { duration: SLIDE_MS, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)", fill: "backwards" },
    );
    return () => slide.cancel();
  }, [onMount]);

  useEffect(() => {
    if (up) return;
    const t = setTimeout(() => setUp(true), FLIP_AFTER_MS);
    return () => clearTimeout(t);
  }, [up]);

  return <CardFace ref={ref} card={card} faceDown={!up} size={CARD} className={cx("bac-card absolute", sweep && "bac-sweep")} style={style} />;
}

const SPARKS = Array.from({ length: 14 }, (_, i) => ({ a: `${i * (360 / 14) + (i % 2) * 9}deg`, r: `${52 + (i % 3) * 16}px`, d: (i % 4) * 40 }));

function Verdict({ result }: { result: BacRound }) {
  const tone = WINNER_TONE[result.winner];
  return (
    <p key={`${result.winner}-${result.playerTotal}-${result.bankerTotal}`} className="bac-verdict font-display text-sm tracking-wide tabular-nums" style={{ "--tone": tone } as CSSProperties}>
      <span aria-hidden>
        {SPARKS.map((p, i) => (
          <i key={i} className="bac-spark" style={{ "--a": p.a, "--r": p.r, "--d": p.d + 180 } as CSSProperties} />
        ))}
      </span>
      <span style={{ color: tone }}>{WINNER_LABEL[result.winner]}</span>
      <span className="text-fg">
        {result.playerTotal}–{result.bankerTotal}
      </span>
      {result.natural && <span className="rounded-full bg-accent px-2 py-px font-sans text-[9px] font-bold tracking-[0.14em] text-ink">NATURAL</span>}
    </p>
  );
}

function Zone({
  spot,
  className,
  index,
  game,
  me,
  canBet,
  win,
  dim,
  onPlace,
  onRemove,
}: {
  spot: BacSpot;
  className: string;
  index: number;
  game: BacState;
  me: BacPlayer | undefined;
  canBet: boolean;
  win: boolean;
  dim: boolean;
  onPlace: () => void;
  onRemove: () => void;
}) {
  const mine = me ? me.bets[spot] : 0;
  const others = game.players.reduce((n, p) => (p.id === me?.id || p.seat === null ? n : n + p.bets[spot]), 0);
  const net = game.phase === "settle" && me?.result && mine > 0 ? me.result.spots[spot] : null;
  const big = spot === "player" || spot === "banker";
  return (
    <div className={cx("bac-stagger relative", className)} style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        disabled={!canBet}
        onClick={onPlace}
        aria-label={`${SPOT_LABEL[spot]}, pays ${SPOT_ODDS[spot]}${mine > 0 ? `, your bet ${mine}` : ""}`}
        data-win={win || undefined}
        data-dim={dim || undefined}
        className="bac-zone size-full"
        style={{ "--tone": SPOT_TONE[spot] } as CSSProperties}
      >
        <span className={cx("flex flex-col gap-1 leading-none", mine > 0 ? "items-start justify-self-start pl-2.5" : "items-center")}>
          <span className={cx("font-display tracking-[0.12em] uppercase", big ? "text-[15px]" : "text-[11px]")} style={{ color: SPOT_TONE[spot] }}>
            {SPOT_LABEL[spot]}
          </span>
          <span className="font-sans text-[10px] font-medium tracking-[0.08em] text-fg/55 tabular-nums">{SPOT_ODDS[spot]}</span>
        </span>
        {others > 0 && <span className="absolute bottom-1 left-2 rounded-full bg-black/35 px-1.5 py-px text-[9px] font-semibold text-fg/70 tabular-nums">+{shortAmount(others)}</span>}
        {mine > 0 && <Chip key={mine} amount={mine} size={big ? "md" : "sm"} stack className="bac-in absolute top-1/2 right-2 -translate-y-[58%]" />}
        {net !== null && net !== 0 && (
          <span className={cx("bac-in absolute top-1.5 right-2 rounded-full px-1.5 font-display text-[10px] tabular-nums", net > 0 ? "bg-active text-ink" : "bg-danger text-ink")}>{signed(net)}</span>
        )}
      </button>
      {canBet && mine > 0 && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove your ${SPOT_LABEL[spot]} bet`}
          className="absolute -top-2.5 -right-2 grid size-9 place-items-center rounded-full active:scale-90"
        >
          <span aria-hidden className="grid size-5 place-items-center rounded-full bg-ink text-xs text-fg ring-1 ring-fg/30">×</span>
        </button>
      )}
    </div>
  );
}

function Seats({ conn, me }: { conn: BacConnection; me: BacPlayer | undefined }) {
  const { game } = conn;
  const canSit = !!me && me.seat === null && !(game.phase !== "betting" && stake(me) > 0);

  return (
    <ul className="relative mt-auto grid grid-cols-5 gap-1 pt-3">
      {Array.from({ length: SEATS }, (_, seat) => {
        const p = game.players.find((x) => x.seat === seat);
        return (
          <li key={seat} className="flex flex-col items-center">
            {p ? (
              <SeatedPlayer game={game} player={p} mine={p.id === conn.you} />
            ) : (
              <button
                type="button"
                disabled={!canSit}
                onClick={() => (tap(), conn.send({ type: "sit", seat }))}
                aria-label={`Sit in seat ${seat + 1}`}
                className={cx(
                  "grid size-[clamp(40px,11.5vw,48px)] place-items-center rounded-full border-2 border-dashed font-display text-[10px] tracking-[0.12em] transition-transform active:scale-95",
                  canSit ? "bac-seat border-accent/80 bg-accent/10 text-accent" : "border-fg/20 text-fg/35",
                )}
              >
                {canSit ? "SIT" : seat + 1}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SeatedPlayer({ game, player, mine }: { game: BacState; player: BacPlayer; mine: boolean }) {
  const staked = stake(player);
  const net = game.phase === "settle" ? player.result?.net : undefined;
  return (
    <>
      <span
        className={cx(
          "bac-seated relative grid size-[clamp(40px,11.5vw,48px)] place-items-center rounded-full border-2 bg-ink/30",
          mine ? "border-accent/70" : "border-fg/30",
          net !== undefined && net > 0 && "border-active",
          !player.connected && "opacity-50",
        )}
      >
        <Avatar id={player.id} seat={player.seat ?? undefined} name={player.name} />
        {player.ready && game.phase === "betting" && (
          <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-active text-[10px] text-ink" aria-label="Ready">
            ✓
          </span>
        )}
        {net !== undefined && net !== 0 && (
          <span className={cx("bac-in absolute -top-2 left-1/2 -translate-x-1/2 rounded px-1 font-display text-[10px] whitespace-nowrap tabular-nums shadow-hard", net > 0 ? "bg-active text-ink" : "bg-danger text-ink")}>
            {signed(net)}
          </span>
        )}
      </span>
      <span className={cx("mt-0.5 max-w-full truncate rounded-full px-1.5 py-px text-[10px] font-semibold", mine ? "bg-accent text-ink" : "bg-ink/70 text-fg/90")}>{mine ? "You" : player.name}</span>
      <span className="h-3.5 font-display text-[10px] leading-[14px] text-fg/60 tabular-nums">{staked > 0 ? shortAmount(staked) : ""}</span>
    </>
  );
}

function Panel({ conn, me, chip, setChip, secs }: { conn: BacConnection; me: BacPlayer | undefined; chip: number; setChip: (v: number) => void; secs: number | null }) {
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
            Tap a glowing <span className="font-semibold text-accent">SIT</span> to take a seat
          </span>
        ) : (
          "Every seat is taken. You're watching from the rail."
        )}
      </Status>
    );
  } else if (game.phase === "betting") {
    view = "bet";
    body = <Betting conn={conn} me={me} chip={chip} setChip={setChip} secs={secs} />;
  } else if (game.phase === "dealing") {
    view = "dealing";
    body = <Status>{stake(me) > 0 ? <>Dealing · your stake <span className="font-display text-accent tabular-nums">{stake(me).toLocaleString()}</span></> : "Dealing. You're in next coup."}</Status>;
  } else {
    view = "settle";
    body = <MyResult me={me} secs={secs} />;
  }

  return (
    <footer className="flex min-h-[148px] flex-col justify-end px-4 pt-2 pb-safe-3">
      <div key={view} className="bac-rise flex flex-col gap-2.5">
        {body}
      </div>
    </footer>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="grid min-h-16 place-items-center rounded-2xl border border-line bg-surface px-4 text-center text-sm text-muted">
      {children}
    </p>
  );
}

function Betting({ conn, me, chip, setChip, secs }: { conn: BacConnection; me: BacPlayer; chip: number; setChip: (v: number) => void; secs: number | null }) {
  const { game } = conn;
  const staked = stake(me);
  const waiting = game.players.filter((p) => p.seat !== null && stake(p) > 0 && !p.ready).length;
  const canRebet = !!me.lastBets && totalBet(me.lastBets) <= me.chips && staked === 0;
  const total = secs === null ? 100 : Math.min(100, (secs / (BET_MS / 1000)) * 100);

  if (me.chips < MIN_BET && staked === 0) {
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
      {secs !== null && (
        <div role="timer" aria-label={`${secs} seconds left to bet`} className="h-1 overflow-hidden rounded-full bg-surface-2">
          <div className={cx("h-full rounded-full transition-[width,background-color] duration-1000 ease-linear", secs <= 5 ? "bg-danger" : "bg-(--bac-gold)")} style={{ width: `${total}%` }} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => (tap(), conn.send({ type: "standUp" }))} className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg">
          Stand up
        </button>
        <p className="font-display text-sm tabular-nums">
          <span className="text-muted">BET </span>
          <span className="text-(--bac-gold)">{staked.toLocaleString()}</span>
        </p>
        <button
          type="button"
          disabled={staked === 0 || me.ready}
          onClick={() => (tap(), conn.send({ type: "clearBets" }))}
          className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg disabled:opacity-30"
        >
          Clear
        </button>
      </div>
      <div role="radiogroup" aria-label="Chip value" className="grid grid-cols-5 justify-items-center gap-2 pt-1.5">
        {RACK.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={chip === v}
            aria-label={`${v} chip`}
            disabled={me.ready}
            onClick={() => (tap(), setChip(v))}
            className={cx("bac-rack rounded-full disabled:opacity-40", chip === v && "ring-2 ring-accent ring-offset-2 ring-offset-bg")}
          >
            <Chip amount={v} size="lg" />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2.5">
        <Button size="lg" variant="secondary" disabled={!canRebet || me.ready} onClick={() => (success(), conn.send({ type: "rebet" }))}>
          Rebet
        </Button>
        <Button size="lg" block disabled={me.ready || staked < MIN_BET} onClick={() => (success(), conn.send({ type: "deal" }))}>
          {me.ready ? (waiting > 0 ? `Waiting · ${secs ?? "…"}s` : "Dealing…") : staked < MIN_BET ? "Place bet" : secs !== null ? `Deal · ${secs}s` : "Deal"}
        </Button>
      </div>
    </>
  );
}

function MyResult({ me, secs }: { me: BacPlayer; secs: number | null }) {
  const net = me.result?.net;
  const shown = useCountUp(net ?? 0);
  useEffect(() => {
    if (net === undefined) return;
    if (net > 0) success();
    else if (net < 0) fail();
  }, [net]);

  if (!me.result) return <Status>{secs !== null ? `Next coup in ${secs}s` : "Next coup soon"}</Status>;
  const lines = (Object.keys(me.bets) as BacSpot[]).filter((s) => me.bets[s] > 0);
  const headline = me.result.net > 0 ? "text-(--bac-gold)" : me.result.net < 0 ? "text-danger" : "text-stayed";
  return (
    <div className="bac-in bac-result flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface py-3" data-net={me.result.net > 0 ? "win" : undefined}>
      <p className={cx("bac-net font-display text-4xl leading-none tabular-nums", headline)}>{me.result.net === 0 ? "Push" : signed(shown)}</p>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 px-3 text-xs text-muted tabular-nums">
        {lines.map((s) => {
          const n = me.result?.spots[s] ?? 0;
          return (
            <li key={s}>
              {SPOT_LABEL[s]} <span className={n > 0 ? "text-active" : n < 0 ? "text-danger" : ""}>{n === 0 ? "push" : signed(n)}</span>
            </li>
          );
        })}
      </ul>
      {secs !== null && <p className="text-xs text-muted tabular-nums">Next coup in {Math.min(secs, SETTLE_MS / 1000)}s</p>}
    </div>
  );
}
