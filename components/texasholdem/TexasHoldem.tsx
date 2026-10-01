"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import "./texasholdem.css";
import { CardFace } from "@/components/casino/CardFace";
import { Chip, shortAmount } from "@/components/casino/Chip";
import { shareInvite } from "@/components/lobby/Lobby";
import { useSecondsLeft } from "@/components/table/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { tap } from "@/lib/client/haptics";
import {
  BIG_BLIND,
  CARD_SLIDE_MS,
  DEAL_STAGGER_MS,
  FOLD_WIN_MS,
  SEATS,
  SHOWDOWN_MS,
  SMALL_BLIND,
  TURN_MS,
  buildPots,
} from "@/lib/texasholdem";
import type { TxCard, TxConnection, TxPlayer, TxState } from "@/lib/texasholdem/types";
import { Panel } from "./Panel";

// Seats are placed by hand (percent of the table) so plates stay clear of the board on a 375px phone; index = seat relative to you, clockwise.
const SEAT_POS = [
  { x: 50, y: 89 },
  { x: 13, y: 74 },
  { x: 10, y: 50 },
  { x: 16, y: 25 },
  { x: 50, y: 10 },
  { x: 84, y: 25 },
  { x: 90, y: 50 },
  { x: 87, y: 74 },
] as const;
// Where each seat's street bet rests: inside the rail, away from the board and your hole cards.
const BET_POS = [
  { x: 73, y: 73 },
  { x: 31, y: 67 },
  { x: 26, y: 41 },
  { x: 29, y: 28 },
  { x: 50, y: 23 },
  { x: 71, y: 28 },
  { x: 74, y: 41 },
  { x: 69, y: 67 },
] as const;
const SWEEP_MS = 600; // end of the hand: cards slide back to the deck before the table resets
const SWEEP_BETS_MS = 900; // bets glide to the pot
const AWARD_MS = 1100;
const RESULT_BEAT_MS = 1000; // showdown: hands face up for a beat before the winner is called
const FOLD_RESULT_BEAT_MS = 400;
const BOARD_SIZE = "clamp(36px,10.4vw,46px)";
const STREET: Record<TxState["phase"], string> = { lobby: "", preflop: "PRE-FLOP", flop: "FLOP", turn: "TURN", river: "RIVER", showdown: "SHOWDOWN" };

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const seatPos = (rel: number) => SEAT_POS[rel % SEAT_POS.length] ?? SEAT_POS[0];
const betPos = (rel: number) => BET_POS[rel % BET_POS.length] ?? BET_POS[0];

// Distance from el's centre to the centre of a landmark on the felt ([data-deck], [data-pot], [data-seat="n"]).
function gapTo(el: Element, selector: string): { dx: number; dy: number } | null {
  const target = el.closest("[data-table]")?.querySelector(selector);
  if (!target) return null;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return { dx: b.left + b.width / 2 - (a.left + a.width / 2), dy: b.top + b.height / 2 - (a.top + a.height / 2) };
}

// "to": carry el to the landmark and fade it. "from": bring el in from the landmark and set it down.
function useFly(ref: RefObject<HTMLElement | null>, target: string | undefined, dir: "to" | "from", delay = 0, duration = AWARD_MS) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !target || reducedMotion()) return;
    const gap = gapTo(el, target);
    if (!gap) return;
    const there = `translate(${gap.dx}px, ${gap.dy}px) scale(0.6)`;
    const lifted = { transform: "translateY(-8px) scale(1.12)", opacity: 1 };
    const frames =
      dir === "to"
        ? [{ transform: "none", opacity: 1 }, { ...lifted, offset: 0.2 }, { transform: there, opacity: 1, offset: 0.88 }, { transform: there, opacity: 0 }]
        : [{ transform: there, opacity: 0 }, { transform: there, opacity: 1, offset: 0.12 }, { ...lifted, offset: 0.8 }, { transform: "none", opacity: 1 }];
    const fly = el.animate(frames, { duration, delay, easing: "ease-in-out", fill: dir === "to" ? "forwards" : "backwards" });
    return () => fly.cancel();
  }, [ref, target, dir, delay, duration]);
}

// Showdown: a beat with the hands face up, then results and chips move. Derived from the deadline so a reload lands mid-beat.
function useShowdown(conn: TxConnection): { revealed: boolean; clearing: boolean } {
  const { game, deadlineAt } = conn;
  const on = game.phase === "showdown" && deadlineAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [on]);
  if (!on) return { revealed: false, clearing: false };
  const shownDown = game.players.some((p) => p.result?.hand);
  const t = now - (deadlineAt - (shownDown ? SHOWDOWN_MS : FOLD_WIN_MS));
  return { revealed: t >= (shownDown ? RESULT_BEAT_MS : FOLD_RESULT_BEAT_MS), clearing: now >= deadlineAt - SWEEP_MS };
}

function winBanner(payees: readonly TxPlayer[], you: string): { title: string; hand: string | null } {
  const total = payees.reduce((n, w) => n + (w.result?.won ?? 0), 0);
  const names = payees.map((w) => (w.id === you ? "You" : w.name)).join(" & ");
  const verb = payees.length > 1 ? "split" : payees[0]?.id === you ? "win" : "wins";
  return { title: `${names} ${verb} ${total.toLocaleString()}`, hand: payees[0]?.result?.hand ?? null };
}

const sameCard = (a: TxCard, b: TxCard) => a.rank === b.rank && a.suit === b.suit;

export function TexasHoldem({ conn }: { conn: TxConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const { revealed, clearing } = useShowdown(conn);
  const street = game.phase !== "lobby" && game.phase !== "showdown";
  const myTurn = street && !game.runout && game.turnId === conn.you;
  const left = useSecondsLeft(conn.deadlineAt);
  // While the deal is still landing the turn clock hasn't started: hold the buttons and the countdown.
  const dealing = street && !game.runout && left !== null && left > TURN_MS / 1000;
  const secs = dealing ? null : left;

  // Winnings are already in the stack at showdown; hold them back until the winner is called.
  const stack = me ? me.chips - (game.phase === "showdown" && !revealed && me.result ? me.result.won : 0) : 0;
  const offline = conn.status !== "open";

  async function share() {
    tap();
    const msg = await shareInvite(conn.code);
    if (msg) setToast(msg);
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-safe pt-safe select-none">
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
        <p className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-3 font-display text-sm tabular-nums text-accent" aria-label={`${stack} chips`}>
          <Chip amount={stack} size="xs" label="" color="var(--color-accent)" />
          {stack.toLocaleString()}
        </p>
      </header>

      {offline && (
        <p role="status" className="mx-3 rounded-full bg-danger/15 px-3 py-1 text-center text-xs font-semibold text-danger">
          {conn.status === "closed" ? "Disconnected" : "Reconnecting…"}
        </p>
      )}

      <Felt conn={conn} me={me} revealed={revealed} clearing={clearing} secs={secs} />

      <Panel conn={conn} me={me} myTurn={myTurn} dealing={dealing} revealed={revealed} secs={secs} />
    </main>
  );
}

function Felt({ conn, me, revealed, clearing, secs }: { conn: TxConnection; me: TxPlayer | undefined; revealed: boolean; clearing: boolean; secs: number | null }) {
  const { game } = conn;
  const mySeat = me?.seat ?? 0;
  const rel = (seat: number) => (seat - mySeat + SEATS) % SEATS;
  const canSit = !!me && me.cards.length === 0;
  const hand = game.players.filter((p) => p.cards.length > 0 && p.seat !== null);
  // Cards go round the table starting left of the button.
  const dealOrder = (p: TxPlayer) =>
    [...hand].sort((a, b) => ((a.seat ?? 0) - (game.button ?? 0) - 1 + SEATS) % SEATS - ((b.seat ?? 0) - (game.button ?? 0) - 1 + SEATS) % SEATS).indexOf(p);

  const sweeps = useBetSweeps(game.players);
  // Blinds of different sizes cut equal-eligibility slices; only a real side pot (someone all-in short) is worth showing.
  const pots = useMemo(() => {
    const merged: { amount: number; eligible: string[] }[] = [];
    for (const pot of buildPots(game.players.filter((p) => p.total > 0).map((p) => ({ id: p.id, total: p.total, folded: p.folded })))) {
      const last = merged.at(-1);
      if (last && last.eligible.length === pot.eligible.length && last.eligible.every((id) => pot.eligible.includes(id))) last.amount += pot.amount;
      else merged.push({ ...pot });
    }
    return merged;
  }, [game.players]);

  // At showdown, anything not part of a winning five fades back so the winning hand reads at a glance.
  const winners = game.phase === "showdown" && revealed ? game.players.filter((p) => (p.result?.won ?? 0) > 0 && p.result?.best.length) : [];
  const winning = (c: TxCard) => winners.some((w) => w.result?.best.some((b) => sameCard(b, c)));
  const dimBoard = (c: TxCard) => winners.length > 0 && !winning(c);

  const payees = game.phase === "showdown" && revealed ? game.players.filter((p) => (p.result?.won ?? 0) > 0) : [];
  const banner = payees.length > 0 ? winBanner(payees, conn.you) : null;

  function sit(seat: number) {
    if (!canSit) return;
    tap();
    conn.send({ type: "sit", seat });
  }

  return (
    <section aria-label="Table" data-table className="relative mx-2 min-h-0 flex-1">
      <div aria-hidden className="tx-felt absolute inset-x-0 top-[3%] bottom-[3%]" />

      <div aria-hidden data-deck className="absolute top-[1%] left-[2%] h-[38px] w-[27px]">
        {[0, 1, 2].map((i) => (
          <CardFace key={i} card={null} className="absolute" size={25} style={{ left: i * 1.5, top: -i * 1.5 }} />
        ))}
      </div>
      <p aria-label={`Blinds ${SMALL_BLIND} and ${BIG_BLIND}`} className="absolute top-[1%] right-[3%] rounded-full border border-white/10 bg-black/40 px-2 py-0.5 font-display text-[10px] tracking-[0.14em] text-fg/70 tabular-nums">
        {SMALL_BLIND}/{BIG_BLIND}
      </p>

      <div data-pot className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2" style={{ top: "34%" }}>
        {game.pot > 0 && <Chip key={game.round} amount={game.pot} size="sm" stack className="tx-in" />}
        <p aria-label={`Pot ${game.pot}`} className="min-w-6 font-display text-base tabular-nums text-fg">
          {game.pot > 0 ? game.pot.toLocaleString() : ""}
        </p>
      </div>

      <div className="absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-[clamp(3px,1vw,5px)]" style={{ top: "50%" }}>
        {Array.from({ length: 5 }, (_, i) => {
          const c = game.board[i];
          return c ? (
            <Dealt
              key={`${game.round}-${i}`}
              card={c}
              delay={i < 3 ? i * DEAL_STAGGER_MS : 0}
              sweep={clearing}
              dim={dimBoard(c)}
              size={BOARD_SIZE}
              className={cx(winning(c) && "tx-lift ring-2 ring-active", "rounded-[0.12em]")}
            />
          ) : (
            <span key={i} aria-hidden className="rounded-[0.12em] border border-white/10 bg-black/15" style={{ fontSize: BOARD_SIZE, width: "1em", aspectRatio: "5 / 7" }} />
          );
        })}
      </div>

      <div className="absolute left-1/2 flex w-[84%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ top: "62%" }}>
        {banner ? (
          <p key={`${game.round}-banner`} role="status" className="tx-pop flex max-w-full flex-col items-center rounded-2xl border border-active/50 bg-ink/90 px-4 py-1.5 text-center shadow-[0_8px_24px_-8px_oklch(0_0_0/0.8)]">
            <span className="max-w-full truncate font-display text-sm tracking-wide text-active">{banner.title}</span>
            {banner.hand && <span className="max-w-full truncate text-[11px] text-fg/70">{banner.hand}</span>}
          </p>
        ) : pots.length > 1 && game.players.some((p) => p.allIn && p.total > 0) ? (
          <p className="font-display text-[10px] tracking-[0.1em] text-fg/50 tabular-nums">
            {pots.map((p, i) => (
              <span key={i} className="mx-1">
                {i === 0 ? "MAIN" : `SIDE ${i}`} {shortAmount(p.amount)}
              </span>
            ))}
          </p>
        ) : (
          <p className="font-display text-[10px] tracking-[0.26em] text-fg/35">{STREET[game.phase]}</p>
        )}
      </div>

      {game.players.map((p) => {
        if (p.seat === null || p.bet === 0) return null;
        const pos = betPos(rel(p.seat));
        return <Bet key={p.seat} amount={p.bet} seat={p.seat} pos={pos} />;
      })}
      {sweeps.map((g) => (
        <Bet key={g.key} amount={g.amount} seat={g.seat} pos={betPos(rel(g.seat))} sweep />
      ))}

      {Array.from({ length: SEATS }, (_, seat) => {
        const p = game.players.find((x) => x.seat === seat);
        const pos = seatPos(rel(seat));
        return (
          <div key={seat} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
            {p ? (
              <Seat conn={conn} player={p} below={pos.y < 35} order={dealOrder(p)} handSize={hand.length} revealed={revealed} clearing={clearing} secs={secs} />
            ) : (
              <button
                type="button"
                disabled={!canSit}
                onClick={() => sit(seat)}
                aria-label={`Sit in seat ${seat + 1}`}
                className={cx(
                  "grid size-[clamp(40px,12vw,50px)] place-items-center rounded-full border-2 border-dashed font-display text-[10px] tracking-[0.12em] transition-transform active:scale-95",
                  canSit && me?.seat === null ? "tx-glow border-accent bg-accent/10 text-accent" : "border-fg/20 text-fg/30",
                )}
              >
                {canSit ? "SIT" : seat + 1}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

// Streets collect into the pot: when a player's bet drops to nothing, a copy of it glides to the middle.
function useBetSweeps(players: readonly TxPlayer[]): { key: string; seat: number; amount: number }[] {
  const sig = players.map((p) => `${p.seat}:${p.bet}`).join();
  const [prev, setPrev] = useState({ sig, bets: players.map((p) => ({ seat: p.seat, bet: p.bet })) });
  const [sweeps, setSweeps] = useState<{ key: string; seat: number; amount: number }[]>([]);

  if (sig !== prev.sig) {
    const gone = prev.bets.flatMap(({ seat, bet }) => (seat !== null && bet > 0 && !players.some((p) => p.seat === seat && p.bet > 0) ? [{ key: `${sig}-${seat}`, seat, amount: bet }] : []));
    setPrev({ sig, bets: players.map((p) => ({ seat: p.seat, bet: p.bet })) });
    if (gone.length > 0) setSweeps(gone);
  }

  useEffect(() => {
    if (sweeps.length === 0) return;
    const t = setTimeout(() => setSweeps([]), SWEEP_BETS_MS + 100);
    return () => clearTimeout(t);
  }, [sweeps]);

  return sweeps;
}

// A street's bet in front of its seat: slides out of the seat when placed, or (sweep) on to the pot.
function Bet({ amount, seat, pos, sweep = false }: { amount: number; seat: number; pos: { x: number; y: number }; sweep?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useFly(ref, sweep ? "[data-pot]" : `[data-seat="${seat}"]`, sweep ? "to" : "from", 0, sweep ? SWEEP_BETS_MS : 450);
  return (
    <span className="pointer-events-none absolute z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      <Chip ref={ref} amount={amount} size="sm" />
    </span>
  );
}

// Deals out of the deck face down, spinning onto its spot, and turns over as it lands. A hidden card stays down until its face arrives.
function Dealt({
  card,
  delay = 0,
  sweep = false,
  dim = false,
  size,
  className,
  style,
}: {
  card: TxCard | null;
  delay?: number;
  sweep?: boolean;
  dim?: boolean;
  size: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [onMount] = useState(() => ({ delay, faceUp: card !== null }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const gap = gapTo(el, "[data-deck]");
    if (!gap) return;
    const timing: KeyframeAnimationOptions = { duration: CARD_SLIDE_MS, delay: onMount.delay, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)", fill: "backwards" };
    const moves = [
      el.animate(
        [
          { transform: `translate(${gap.dx}px, ${gap.dy}px) rotate(-55deg) scale(0.6)` },
          { transform: "translate(0, -6%) rotate(4deg) scale(1.06)", offset: 0.75 },
          { transform: "none" },
        ],
        timing,
      ),
    ];
    const inner = el.firstElementChild;
    if (onMount.faceUp && inner instanceof HTMLElement) {
      moves.push(inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(180deg)", offset: 0.55 }, { transform: "rotateY(0deg)" }], timing));
    }
    return () => moves.forEach((m) => m.cancel());
  }, [onMount]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !sweep || reducedMotion()) return;
    const gap = gapTo(el, "[data-deck]");
    if (!gap) return;
    const away = el.animate([{ transform: "none" }, { transform: `translate(${gap.dx}px, ${gap.dy}px) rotate(30deg) scale(0.5)`, opacity: 0 }], {
      duration: SWEEP_MS - 100,
      easing: "cubic-bezier(0.5, 0, 0.75, 0)",
      fill: "forwards",
    });
    return () => away.cancel();
  }, [sweep]);

  return <CardFace ref={ref} card={card} size={size} className={cx("transition-[filter,opacity,font-size] duration-500", dim && "opacity-40 brightness-75", className)} style={style} />;
}

function Seat({
  conn,
  player,
  below,
  order,
  handSize,
  revealed,
  clearing,
  secs,
}: {
  conn: TxConnection;
  player: TxPlayer;
  below: boolean; // upper seats show their showdown hand under the plate, there is no room above
  order: number;
  handSize: number;
  revealed: boolean;
  clearing: boolean;
  secs: number | null;
}) {
  const { game } = conn;
  const mine = player.id === conn.you;
  const street = game.phase !== "lobby" && game.phase !== "showdown";
  const turn = street && !game.runout && game.turnId === player.id && secs !== null; // secs is null while the deal lands
  const result = revealed ? player.result : null;
  const won = (result?.won ?? 0) > 0;
  const inHand = player.cards.length > 0;
  const showCards = inHand && (mine || !player.folded);
  const busted = !inHand && player.chips < BIG_BLIND;
  const awardRef = useRef<HTMLSpanElement>(null);
  useFly(awardRef, won ? "[data-pot]" : undefined, "from", 150);
  const bestOf = player.result?.best ?? [];
  const dimCard = (c: TxCard | null) => revealed && won && bestOf.length > 0 && c !== null && !bestOf.some((b) => sameCard(b, c));

  // Winnings are in the stack already at showdown; hold them back until the winner is called.
  const shownStack = player.chips - (game.phase === "showdown" && !revealed && player.result ? player.result.won : 0);
  const faceUp = !mine && player.cards.some((c) => c !== null); // an opponent's hand only arrives face up at showdown
  const size = mine ? "clamp(44px,13vw,54px)" : faceUp ? "clamp(30px,9vw,36px)" : "clamp(22px,6.4vw,28px)";

  let line: { text: string; tone: string };
  if (result && result.net !== 0 && player.cards.length > 0) line = { text: `${result.net > 0 ? "+" : "−"}${Math.abs(result.net).toLocaleString()}`, tone: won ? "text-active" : "text-fg/60" };
  else if (won) line = { text: "WINS", tone: "text-active" };
  else if (player.gone) line = { text: "LEFT", tone: "text-muted" };
  else if (player.folded && inHand) line = { text: "FOLD", tone: "text-muted" };
  else if (player.allIn) line = { text: "ALL-IN", tone: "text-accent" };
  else if (player.sitOut) line = { text: "SIT OUT", tone: "text-muted" };
  else if (busted) line = { text: "BUSTED", tone: "text-danger" };
  else line = { text: shownStack.toLocaleString(), tone: "text-fg" };

  return (
    <div className={cx("relative flex flex-col items-center", !player.connected && "opacity-50")}>
      {showCards && (
        <div className={cx("absolute left-1/2 flex -translate-x-1/2", mine ? "bottom-full z-10 mb-0.5 gap-1" : faceUp ? cx("z-10 gap-0.5", below ? "top-full mt-6" : "bottom-full mb-1") : "bottom-[58%]")}>
          {player.cards.map((c, i) => (
            <Dealt
              key={`${game.round}-${i}`}
              card={c}
              delay={(i * handSize + order) * DEAL_STAGGER_MS}
              sweep={clearing}
              dim={player.folded || dimCard(c)}
              size={size}
              className={cx(mine ? (i === 0 ? "-rotate-3" : "rotate-3") : faceUp ? (i === 0 ? "-rotate-3" : "rotate-3") : i === 0 ? "-rotate-6" : "rotate-6 -ml-[0.5em]", c && won && !dimCard(c) && "ring-2 ring-active", "rounded-[0.12em]")}
            />
          ))}
        </div>
      )}

      <span
        data-seat={player.seat}
        className={cx(
          "relative z-[1] grid place-items-center rounded-full bg-surface shadow-[0_6px_14px_-4px_oklch(0_0_0/0.7)] ring-2 ring-offset-2 ring-offset-[oklch(0.255_0.008_260)]",
          mine ? "size-[clamp(44px,12.5vw,50px)]" : "size-[clamp(38px,11vw,44px)]",
          turn ? "tx-glow ring-accent" : mine ? "ring-accent/60" : "ring-white/15",
          won && "tx-win ring-active",
          player.folded && inHand && "opacity-55",
        )}
      >
        <Avatar id={player.id} seat={player.seat ?? undefined} name={player.name} />
        {game.button === player.seat && (
          <span aria-label="Dealer button" className="absolute top-1/2 -left-3.5 z-10 grid size-[18px] -translate-y-1/2 place-items-center rounded-full bg-fg font-display text-[10px] text-ink shadow-[0_2px_6px_oklch(0_0_0/0.6)]">
            D
          </span>
        )}
        {(game.sbId === player.id || game.bbId === player.id) && inHand && (
          <span aria-label={game.sbId === player.id ? "Small blind" : "Big blind"} className="absolute top-1/2 -right-3.5 z-10 -translate-y-1/2 rounded-full bg-accent px-1 font-display text-[9px] leading-4 text-ink shadow-[0_2px_6px_oklch(0_0_0/0.6)]">
            {game.sbId === player.id ? "SB" : "BB"}
          </span>
        )}
        {won && result && <Chip ref={awardRef} amount={result.won} size="sm" className="absolute -top-4 -right-6 z-20" />}
      </span>

      <span
        className={cx(
          "-mt-2 w-[clamp(58px,17vw,66px)] rounded-lg border px-1 pt-2.5 pb-[3px] text-center leading-tight shadow-[0_6px_14px_-6px_oklch(0_0_0/0.8)]",
          mine ? "border-accent/80 bg-accent" : "border-white/10 bg-ink/90",
        )}
      >
        <span className={cx("block truncate text-[10.5px] font-semibold", mine ? "text-ink" : "text-fg/85")}>{mine ? "You" : player.name}</span>
        <span className={cx("block truncate font-display text-[11px] tabular-nums", mine ? "text-ink/80" : line.tone)}>{line.text}</span>
      </span>
      {result?.hand && !mine && (
        <span className={cx("tx-in absolute top-full mt-1 max-w-[96px] truncate rounded-full bg-ink/90 px-2 py-0.5 text-[10px] font-semibold", won ? "text-active" : "text-fg/65")}>{result.hand}</span>
      )}
    </div>
  );
}
