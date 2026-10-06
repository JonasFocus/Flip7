"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import "./duel.css";
import { shareInvite } from "@/components/lobby/Lobby";
import { useSecondsLeft } from "@/components/table/ActionBar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { CardFace } from "@/components/casino/CardFace";
import { DealtCard, gapTo, reducedMotion } from "@/components/casino/motion";
import { Toast } from "@/components/ui/Toast";
import { fail, success, tap } from "@/lib/client/haptics";
import {
  CARD_SLIDE_MS,
  DEALER_CARD_MS,
  DEAL_STAGGER_MS,
  DENOMS,
  MAX_BUY_IN,
  MIN_BUY_IN,
  HOLE_LEAD_MS,
  SETTLE_MS,
  SHOE_SIZE,
  SHUFFLE_MS,
  TURN_MS,
  betOf,
  chipsFor,
  dealAnimMs,
  handValue,
  inHand,
  isBlackjack,
  isBust,
} from "@/lib/bjduel";
import type { BjCard, Denom, DuelConnection, DuelPlayer, DuelState, Outcome, Versus } from "@/lib/bjduel/types";

const FAN = 0.42; // each card in a hand shows this much (in card widths) of the one beneath: its corner index
const SWEEP_MS = 700; // end of settle: cards sweep to the discard tray, winnings go to the rack
const RESULT_BEAT_MS = 700; // results wait for the dealer's last card to land
const CHIP_FLY_MS = 950; // a lost stake crosses the table to the winner
const CHIP_SET_MS = 560; // a chip set down from your hand
const PAY_DELAY_MS = 450; // after the results show, a beat before chips move
const CHIP_STEP = 0.11; // pile height per chip, in chip diameters
const PILE_MAX = 0.6; // a tall pile (all in) squeezes its chips together to stay this high, clear of the cards

// Height per chip in a pile of `n`: real spacing, squeezed for big piles so an all-in doesn't tower over the table.
const stepOf = (n: number) => Math.min(CHIP_STEP, PILE_MAX / Math.max(1, n));

const CHIP_SIZE = "calc(var(--spot) * 0.64)";
// Side-on chip edges for the dealer's tray: body colour broken by the white edge inserts.
const CHIP_EDGE: Record<Denom, string> = {
  1: "repeating-linear-gradient(90deg, oklch(0.95 0.01 90) 0 3px, oklch(0.42 0.12 260) 3px 4px)",
  2: "repeating-linear-gradient(90deg, oklch(0.84 0.15 88) 0 3px, oklch(0.98 0 0) 3px 4px)",
  5: "repeating-linear-gradient(90deg, oklch(0.56 0.2 27) 0 3px, oklch(0.97 0.01 90) 3px 4px)",
};

function totalLabel(cards: readonly (BjCard | null)[]): string {
  if (isBlackjack(cards)) return "BJ";
  const { total, soft } = handValue(cards);
  return soft && total < 21 ? `${total - 10}/${total}` : `${total}`;
}

const money = (n: number) => `$${n.toLocaleString()}`;

// Settle: a beat, the hole card turns, then one dealer draw per DEALER_CARD_MS. Derived from the deadline so a reload lands mid-reveal.
function useDealerShown(conn: DuelConnection): { shown: number; holeUp: boolean; done: boolean; clearing: boolean } {
  const { game, deadlineAt } = conn;
  const len = game.dealer.length;
  const settling = game.phase === "settle" && deadlineAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!settling) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [settling]);
  if (!settling) return { shown: len, holeUp: game.phase !== "playing", done: true, clearing: false };
  const draws = Math.max(0, len - 2);
  const t = now - (deadlineAt - SETTLE_MS - draws * DEALER_CARD_MS - HOLE_LEAD_MS) - HOLE_LEAD_MS; // ms since the hole card turned
  const shown = Math.min(len, 2 + Math.max(0, Math.floor(t / DEALER_CARD_MS)));
  return { shown, holeUp: t >= 0, done: t >= draws * DEALER_CARD_MS + RESULT_BEAT_MS, clearing: now >= deadlineAt - SWEEP_MS };
}

// When this hand's opening deal began, in local ms, if it is still worth animating (null after a reload mid-hand).
function dealStartOf(conn: DuelConnection): number | null {
  const { game, deadlineAt } = conn;
  if (deadlineAt === undefined) return null;
  const n = inHand(game).length;
  const lead = game.shuffled ? SHUFFLE_MS : 0;
  if (game.phase === "playing") {
    // Once someone has acted the turn clock has moved on, so the deal is long over.
    if (game.players.some((p) => p.cards.length > 2 || (p.done && !isBlackjack(p.cards)))) return null;
    return deadlineAt - TURN_MS - dealAnimMs(n) - lead;
  }
  if (game.phase === "settle" && game.dealer.length === 2 && isBlackjack(game.dealer)) {
    return deadlineAt - SETTLE_MS - HOLE_LEAD_MS - dealAnimMs(n) - lead;
  }
  return null;
}

// Counts up or down to a new amount instead of jumping.
function useTween(value: number, ms = 650): number {
  const [shown, setShown] = useState(value);
  const at = useRef(value);
  useEffect(() => {
    const from = at.current;
    if (from === value) return;
    const start = performance.now();
    const dur = reducedMotion() ? 1 : ms;
    let raf = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - start) / dur);
      at.current = Math.round(from + (value - from) * (1 - (1 - k) ** 3));
      setShown(at.current);
      if (k < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

// Lost the whole stake to the other player: the pile goes across the table (and comes back from the rack if it rides again).
const lostAll = (p: DuelPlayer) => !!p.result && p.result.net < 0 && -p.result.net >= betOf(p);

// Chips a player holds in their rack right now (not on the felt), following the chips as they move.
function rackOf(p: DuelPlayer, phase: DuelState["phase"], revealed: boolean, clearing: boolean): number {
  const bet = betOf(p);
  if (phase === "betting") return p.chips - bet;
  if (phase !== "settle" || !p.result) return p.chips;
  if (!revealed || !clearing) return p.chips - bet - p.result.net; // stake and winnings still on the felt
  return lostAll(p) ? p.chips : p.chips - bet; // the stake rides again
}

// What a player is worth: rack plus whatever of theirs is on the felt.
function worthOf(p: DuelPlayer, phase: DuelState["phase"], revealed: boolean): number {
  if (phase === "playing") return p.chips + betOf(p);
  if (phase === "settle" && p.result && !revealed) return p.chips - p.result.net;
  return p.chips;
}

export function BlackjackDuel({ conn }: { conn: DuelConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const opp = game.players.find((p) => p.id !== conn.you);
  const dealer = useDealerShown(conn);
  const revealed = game.phase === "settle" && dealer.done;
  const left = useSecondsLeft(conn.deadlineAt);
  // While the opening deal is still landing, the turn clock hasn't started: hold the buttons and the countdown.
  const dealing = game.phase === "playing" && left !== null && left > TURN_MS / 1000;
  const secs = dealing ? null : left;
  const myTurn = game.phase === "playing" && game.turnId === conn.you && !dealing;

  useEffect(() => {
    if (myTurn) tap();
  }, [myTurn]);

  async function share() {
    tap();
    const msg = await shareInvite(conn.code);
    if (msg) setToast(msg);
  }

  return (
    <main data-table className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-safe pt-safe select-none">
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
        <p className="flex min-h-11 items-center rounded-full bg-surface px-3 font-display text-xs tracking-[0.12em] whitespace-nowrap text-muted tabular-nums">
          {game.phase !== "lobby" ? (
            <>
              HAND <span className="ml-1.5 text-fg">{Math.max(1, game.hand + (game.phase === "betting" ? 1 : 0))}</span>
            </>
          ) : (
            "1 VS 1"
          )}
        </p>
      </header>

      {me && opp && game.phase !== "lobby" && <Lead me={me} opp={opp} phase={game.phase} revealed={revealed} />}

      <Felt conn={conn} me={me} opp={opp} dealer={dealer} revealed={revealed} acting={dealing ? null : game.turnId} />

      <Panel conn={conn} me={me} opp={opp} myTurn={myTurn} revealed={revealed} secs={secs} dealing={dealing} onShare={share} />
    </main>
  );
}

function Lead({ me, opp, phase, revealed }: { me: DuelPlayer; opp: DuelPlayer; phase: DuelState["phase"]; revealed: boolean }) {
  // Up or down on what each bought in for, so different buy-ins compare fairly.
  const diff = worthOf(me, phase, revealed) - me.bought - (worthOf(opp, phase, revealed) - opp.bought);
  const shown = useTween(Math.abs(diff));
  return (
    <p aria-live="polite" className="pb-1 text-center text-[11px] font-bold tracking-[0.18em] text-muted uppercase">
      {diff === 0 ? (
        "All square"
      ) : diff > 0 ? (
        <>
          You lead by <span className="text-active tabular-nums">{money(shown)}</span>
        </>
      ) : (
        <>
          {opp.name} leads by <span className="text-danger tabular-nums">{money(shown)}</span>
        </>
      )}
    </p>
  );
}

type FeltProps = {
  conn: DuelConnection;
  me: DuelPlayer | undefined;
  opp: DuelPlayer | undefined;
  dealer: ReturnType<typeof useDealerShown>;
  revealed: boolean;
  acting: string | null; // whose turn clock is running (null while the deal lands)
};

function Felt(props: FeltProps) {
  const { conn } = props;
  return (
    <section
      aria-label="Table"
      className="relative mx-3 my-3 min-h-0 flex-1 [container-type:size]"
    >
      <div aria-hidden className="dc-felt absolute inset-0" />
      <Shoe left={conn.game.shoeLeft} />
      {/* The dealer's side: discard tray over the chip tray. */}
      <div className="absolute top-1/2 left-[5%] z-10 flex -translate-y-1/2 flex-col items-center gap-2.5">
        <Discard />
        <Tray />
      </div>
      {/* Re-keyed per hand: each deal is timed from the moment it was first seen. */}
      <Round key={conn.game.round} {...props} />
    </section>
  );
}

function Round({ conn, me, opp, dealer, revealed, acting }: FeltProps) {
  const { game } = conn;
  const [clock] = useState(() => ({ start: dealStartOf(conn), mountAt: Date.now() }));
  const lead = game.shuffled ? SHUFFLE_MS : 0;
  const order = inHand(game);
  const n = order.length;
  // Opening deal: two passes, first player, second player, dealer. Negative = already partway through its trip.
  const slotDelay = (slot: number) => (clock.start === null ? null : clock.start + lead + slot * DEAL_STAGGER_MS - clock.mountAt);
  const shuffling = game.shuffled && clock.start !== null && clock.mountAt < clock.start + SHUFFLE_MS;

  const dealerCards = game.dealer.slice(0, dealer.shown).map((c, i) => (i === 1 && !dealer.holeUp ? null : c));
  const holeDown = dealerCards[1] === null;
  const dealerTotal = holeDown ? handValue(dealerCards.slice(0, 1)) : handValue(dealerCards);
  const dealerBadge = slotDelay(2 * (n + 1) - 1);

  return (
    // Card and circle sizes follow the felt's own height, so the whole table fits any phone without overflowing.
    <div className="relative grid h-full grid-rows-[auto_1fr_auto_1fr_auto] justify-items-center px-4 py-[5.5cqh] [--cw:min(10.5cqh,12.5cqw,52px)] [--spot:min(11cqh,16cqw,62px)]">
      <Side conn={conn} player={opp} mine={false} acting={acting} order={opp ? order.indexOf(opp) : -1} n={n} slotDelay={slotDelay} revealed={revealed} clearing={dealer.clearing} />

      <div className="relative row-start-3 flex flex-col items-center gap-1 py-0.5">
        <FeltPrint />
        <div className="relative flex h-[calc(var(--cw)*1.4)] items-center">
          {dealerCards.length === 0 && <span className="block h-full w-[var(--cw)] rounded-md border border-dashed border-[oklch(0.82_0.11_85/0.35)]" />}
          {dealerCards.map((c, i) => {
            const d = i < 2 ? slotDelay(i * (n + 1) + n) : 0;
            return (
              <DealtCard
                key={i}
                card={c}
                slide={d !== null}
                delay={d ?? 0}
                slideMs={CARD_SLIDE_MS}
                sweepMs={SWEEP_MS}
                sweep={dealer.clearing}
                style={{ fontSize: "var(--cw)", marginLeft: i > 0 ? `calc(var(--cw) * ${FAN - 1})` : undefined }}
              />
            );
          })}
        </div>
        <p className="flex items-center gap-2 rounded-full border border-[oklch(0.82_0.11_85/0.3)] bg-black/35 px-3 py-0.5 text-[10px] font-semibold tracking-[0.22em] text-[oklch(0.9_0.06_85)] backdrop-blur-sm">
          DEALER
          {dealerCards.length > 0 && !dealer.clearing && (
            <span
              style={{ animationDelay: `${Math.max(0, (dealerBadge ?? 0) + CARD_SLIDE_MS)}ms` }}
              className={cx("dc-in font-display text-sm tracking-normal tabular-nums", isBust(dealerCards) ? "text-danger" : "text-fg")}
            >
              {isBust(dealerCards) ? `${dealerTotal.total} BUST` : holeDown ? `${dealerTotal.total}+?` : totalLabel(dealerCards)}
            </span>
          )}
        </p>
        {shuffling && clock.start !== null && <Shuffle elapsed={clock.mountAt - clock.start} />}
      </div>

      <Side conn={conn} player={me} mine acting={acting} order={me ? order.indexOf(me) : -1} n={n} slotDelay={slotDelay} revealed={revealed} clearing={dealer.clearing} />
    </div>
  );
}

// One player's end of the table: rack plaque at the rail, betting circle, then their cards towards the dealer.
// Mirrored for the opponent, who sits across from you.
function Side({
  conn,
  player,
  mine,
  acting,
  order,
  n,
  slotDelay,
  revealed,
  clearing,
}: {
  conn: DuelConnection;
  player: DuelPlayer | undefined;
  mine: boolean;
  acting: string | null;
  order: number;
  n: number;
  slotDelay: (slot: number) => number | null;
  revealed: boolean;
  clearing: boolean;
}) {
  const { game } = conn;
  // The plaques sit on the rail itself, half on the felt.
  const rows = mine
    ? { plaque: "absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2", spot: "row-start-5", hand: "row-start-4 self-end" }
    : { plaque: "absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2", spot: "row-start-1", hand: "row-start-2 self-start" };

  if (!player) {
    return (
      <>
        <p className={cx(rows.plaque, "rounded-full border border-dashed border-fg/25 bg-black/45 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-fg/50 uppercase")}>Open seat</p>
        <span className={cx(rows.spot, "dc-spot my-1 block size-[var(--spot)] opacity-60")} />
      </>
    );
  }

  const turn = game.phase === "playing" && acting === player.id;
  const result = revealed ? player.result : null;
  const bust = isBust(player.cards);
  const cards = player.cards;
  const badgeDelay = slotDelay((n + 1) + order);
  const rackSel = mine ? '[data-rack="me"]' : '[data-rack="opp"]';
  const theirPay = mine ? '[data-pay="opp"]' : '[data-pay="me"]';
  const theirSpot = mine ? '[data-spot="opp"]' : '[data-spot="me"]';
  const won = result && result.net > 0 ? result.net : 0;
  // A whole stake flies across and lands as the winnings; a partial one is cut from the loser's pile.
  const opponent = game.players.find((p) => p.id !== player.id);
  const takenWhole = !!opponent && lostAll(opponent);

  return (
    <>
      <Plaque player={player} mine={mine} className={rows.plaque} rack={rackOf(player, game.phase, revealed, clearing)} turn={turn} />

      <div className={cx(rows.spot, "relative my-1")}>
        <span
          className="dc-spot relative grid size-[var(--spot)] place-items-center"
          data-spot={mine ? "me" : "opp"}
          data-turn={turn || undefined}
          data-win={result?.vs === "win" || undefined}
          aria-label={`${mine ? "Your" : `${player.name}'s`} bet ${money(betOf(player))}`}
        >
          {player.stack.length === 0 && game.phase === "betting" && (
            <span className="dc-fade text-[9px] font-bold tracking-[0.16em] text-[oklch(0.9_0.06_85/0.55)]">BET</span>
          )}
          <BetPile
            stack={player.stack}
            away={result ? lostAll(player) : false}
            winner={theirPay}
            from={(v) => (mine && game.phase === "betting" ? `[data-chip-button="${v}"]` : rackSel)}
            rack={rackSel}
          />
          {player.ready && game.phase === "betting" && (
            <span className="dc-in absolute -right-1 -bottom-1 z-10 grid size-5 place-items-center rounded-full bg-active text-[11px] text-ink" aria-label="Locked in">
              ✓
            </span>
          )}
        </span>
        <span data-pay={mine ? "me" : "opp"} className="absolute top-1/2 left-full ml-1 block -translate-y-1/2" style={{ fontSize: CHIP_SIZE }}>
          {won > 0 && <PayPile key={game.round} amount={won} from={takenWhole ? null : theirSpot} rack={rackSel} clearing={clearing} />}
        </span>
      </div>

      <div className={cx(rows.hand, "relative my-1 flex h-[calc(var(--cw)*1.4)] items-center justify-center")}>
        {cards.length > 0 && (
          <div className={cx("relative h-full", bust && "animate-shake")} style={{ width: `calc(var(--cw) + ${cards.length - 1} * var(--cw) * ${FAN})` }}>
            {cards.map((c, i) => {
              const d = i < 2 ? slotDelay(i * (n + 1) + order) : 0;
              return (
                <DealtCard
                  key={i}
                  card={c}
                  slide={d !== null}
                  delay={d ?? 0}
                  slideMs={CARD_SLIDE_MS}
                  sweepMs={SWEEP_MS}
                  sweep={clearing}
                  className={cx("absolute transition-[filter] duration-500", bust && "brightness-75")}
                  style={{ fontSize: "var(--cw)", left: `calc(${i} * var(--cw) * ${FAN})`, top: 0 }}
                />
              );
            })}
            {!clearing && (
              <span
                style={{ animationDelay: `${Math.max(0, (badgeDelay ?? 0) + CARD_SLIDE_MS)}ms` }}
                className={cx(
                  // Beside the hand, so it never sits over the dealer's cards.
                  "dc-in absolute top-1/2 left-full z-10 ml-1.5 min-w-8 -translate-y-1/2 rounded-full px-2 py-0.5 text-center font-display text-[13px] leading-tight whitespace-nowrap tabular-nums shadow-[0_2px_8px_oklch(0_0_0/0.5)] ring-1 ring-black/20",
                  bust ? "bg-danger text-ink" : isBlackjack(cards) ? "bg-accent text-ink" : "bg-fg text-ink",
                )}
              >
                {bust ? "BUST" : totalLabel(cards)}
              </span>
            )}
            {result && !clearing && <ResultTag result={result} bust={bust} />}
          </div>
        )}
      </div>
    </>
  );
}

function Plaque({ player, mine, rack, turn, className }: { player: DuelPlayer; mine: boolean; rack: number; turn: boolean; className?: string }) {
  const shown = useTween(rack);
  return (
    <p
      data-rack={mine ? "me" : "opp"}
      className={cx(
        className,
        "z-10 flex items-center gap-2 rounded-full border bg-black/45 py-0.5 pr-3 pl-1 backdrop-blur-sm transition-colors duration-300",
        turn ? "border-accent" : "border-[oklch(0.82_0.11_85/0.3)]",
        !player.connected && "opacity-50",
      )}
    >
      <span aria-hidden className="relative h-4 w-4">
        {[5, 2, 1].map((v, i) => (
          <ChipFace key={v} v={v as Denom} size="16px" className="absolute left-0" style={{ bottom: i * 2.5 }} />
        ))}
      </span>
      <span className={cx("max-w-[96px] truncate text-[11px] font-semibold", mine ? "text-accent" : "text-fg/90")}>{mine ? "You" : player.name}</span>
      <span className="font-display text-sm text-fg tabular-nums">{money(shown)}</span>
    </p>
  );
}

function ChipFace({ v, size, className, style, ref }: { v: Denom; size: string; className?: string; style?: CSSProperties; ref?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={ref} className={cx("dc-chip", className)} data-v={v} style={{ fontSize: size, ...style }}>
      <span>{v}</span>
    </span>
  );
}

type FlyDir = "in" | "out";

// Picked up, carried across, set down. "in": from `selector` to the chip's spot. "out": from its spot to `selector`, then gone.
function fly(el: HTMLElement, selector: string, dir: FlyDir, delay: number, duration: number): Animation | null {
  if (reducedMotion()) return null;
  const gap = gapTo(el, selector);
  if (!gap) return null;
  const there = `translate(${gap.dx}px, ${gap.dy}px) scale(0.75)`;
  const lifted = "translate(0, -12px) scale(1.08)";
  const frames: Keyframe[] =
    dir === "out"
      ? [{ transform: "none", opacity: 1 }, { transform: lifted, opacity: 1, offset: 0.16 }, { transform: there, opacity: 1, offset: 0.86 }, { transform: there, opacity: 0 }]
      : [{ transform: there, opacity: 0 }, { transform: there, opacity: 1, offset: 0.08 }, { transform: lifted, opacity: 1, offset: 0.78 }, { transform: "none", opacity: 1 }];
  return el.animate(frames, { duration, delay, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: dir === "out" ? "forwards" : "backwards" });
}

// The chips in a betting circle, as set down. New chips fly in; taken-back ones fly home to the rack; a stake lost
// outright crosses the table to the winner and comes back from the rack when the bet rides again.
function BetPile({ stack, away, from, rack, winner }: { stack: Denom[]; away: boolean; from: (v: Denom) => string; rack: string; winner: string }) {
  const [initial] = useState(stack.length);
  // base: how many chips were down before the latest change, so a handful set at once (all in) lands one after another.
  const [prev, setPrev] = useState({ key: stack.join(), stack, away, gen: 0, base: stack.length });
  const [ghosts, setGhosts] = useState<{ id: string; v: Denom; i: number }[]>([]);
  const key = stack.join();
  if (key !== prev.key || away !== prev.away) {
    // Chips that left the circle by hand (not to the dealer) fly back to the rack.
    if (!prev.away && stack.length < prev.stack.length) {
      const gone = prev.stack.slice(stack.length).map((v, k) => ({ id: `${prev.gen}-${k}`, v, i: stack.length + k }));
      setGhosts((g) => [...g, ...gone]);
    }
    setPrev({ key, stack, away, gen: prev.gen + 1, base: prev.stack.length });
  }
  const step = stepOf(stack.length);
  const gap = Math.min(70, 900 / Math.max(1, stack.length)); // between chips leaving together

  return (
    <span className="absolute inset-0 grid place-items-center" style={{ fontSize: CHIP_SIZE }}>
      <span className="relative block size-[1em]">
        {stack.map((v, i) => (
          <PileChip
            key={i}
            v={v}
            i={i}
            step={step}
            gap={gap}
            from={i >= initial ? from(v) : null}
            delay={Math.max(0, i - prev.base) * 45}
            away={away}
            rack={rack}
            winner={winner}
          />
        ))}
        {ghosts.map((g) => (
          <GhostChip key={g.id} v={g.v} i={g.i} step={step} to={rack} onDone={() => setGhosts((all) => all.filter((x) => x.id !== g.id))} />
        ))}
      </span>
    </span>
  );
}

type PileChipProps = { v: Denom; i: number; step: number; gap: number; from: string | null; delay: number; away: boolean; rack: string; winner: string };

function PileChip({ v, i, step, gap, from, delay, away, rack, winner }: PileChipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [mount] = useState({ from, delay });
  const wasAway = useRef(away);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !mount.from) return;
    const a = fly(el, mount.from, "in", mount.delay, CHIP_SET_MS);
    return () => a?.cancel();
  }, [mount]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (away) {
      wasAway.current = true;
      const a = fly(el, winner, "out", PAY_DELAY_MS + i * gap, CHIP_FLY_MS);
      return () => a?.cancel();
    }
    if (wasAway.current) {
      wasAway.current = false;
      const a = fly(el, rack, "in", i * gap, CHIP_SET_MS + 120);
      return () => a?.cancel();
    }
  }, [away, i, gap, rack, winner]);

  return <ChipFace ref={ref} v={v} size="1em" className="absolute left-0 transition-[bottom] duration-300" style={{ bottom: `${i * step}em`, zIndex: i }} />;
}

function GhostChip({ v, i, step, to, onDone }: { v: Denom; i: number; step: number; to: string; onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    const a = el ? fly(el, to, "out", 0, CHIP_SET_MS) : null;
    if (!a) {
      done.current();
      return;
    }
    a.onfinish = () => done.current();
    return () => a.cancel();
  }, [to]);
  return <ChipFace ref={ref} v={v} size="1em" className="pointer-events-none absolute left-0" style={{ bottom: `${i * step}em`, zIndex: 50 + i }} />;
}

// What you took off your opponent, set beside your bet; at the end of the hand it goes to your rack.
// from: their circle, when the dealer cuts your share out of a bigger pile; null when their whole pile flew over
// (it lands here as their chips arrive).
function PayPile({ amount, from, rack, clearing }: { amount: number; from: string | null; rack: string; clearing: boolean }) {
  const chips = chipsFor(amount);
  const step = stepOf(chips.length);
  const gap = Math.min(120, 900 / chips.length);
  return (
    <span className="relative block size-[1em]" aria-label={`Took ${money(amount)}`}>
      {chips.map((v, i) => (
        <PayChip key={i} v={v} i={i} step={step} gap={gap} from={from} rack={rack} clearing={clearing} />
      ))}
    </span>
  );
}

function PayChip({ v, i, step, gap, from, rack, clearing }: { v: Denom; i: number; step: number; gap: number; from: string | null; rack: string; clearing: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (clearing) {
      const a = fly(el, rack, "out", i * Math.min(60, gap), CHIP_SET_MS);
      return () => a?.cancel();
    }
    if (from) {
      const a = fly(el, from, "in", PAY_DELAY_MS + i * gap, CHIP_FLY_MS);
      return () => a?.cancel();
    }
    if (reducedMotion()) return;
    // Hidden until the other player's chips land on top of it.
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay: PAY_DELAY_MS + CHIP_FLY_MS * 0.82 + i * gap, fill: "backwards" });
    return () => a.cancel();
  }, [clearing, i, gap, from, rack]);
  return <ChipFace ref={ref} v={v} size="1em" className="absolute left-0" style={{ bottom: `${i * step}em`, zIndex: i }} />;
}

// How a hand did against the dealer (the dealer only referees: this decides who beat whom).
const AGAINST: Record<Outcome, string> = { blackjack: "blackjack", win: "beat the dealer", push: "tied the dealer", lose: "lost to the dealer" };
const VS_TONE: Record<Versus, string> = { win: "bg-active text-ink", push: "bg-stayed text-ink", lose: "bg-danger text-ink" };
const signed = (net: number) => (net > 0 ? `+${money(net)}` : net < 0 ? `−${money(-net)}` : "EVEN");

function ResultTag({ result, bust }: { result: NonNullable<DuelPlayer["result"]>; bust: boolean }) {
  return (
    <span className={cx("dc-in absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-center font-display text-[11px] leading-tight whitespace-nowrap shadow-hard", VS_TONE[result.vs])}>
      {bust ? "BUST" : result.outcome === "blackjack" ? "BLACKJACK" : result.vs === "win" ? "TAKES IT" : result.vs === "lose" ? "BEATEN" : "STANDOFF"}
      <span className="block tabular-nums">{signed(result.net)}</span>
    </span>
  );
}

// "20, beat the dealer" / "bust": one side of why the chips moved.
function handNote(p: DuelPlayer): string {
  if (!p.result) return "sat out";
  if (isBust(p.cards)) return "bust";
  if (p.result.outcome === "blackjack") return "blackjack";
  return `${handValue(p.cards).total}, ${AGAINST[p.result.outcome]}`;
}

function FeltPrint() {
  return (
    <svg aria-hidden viewBox="0 0 100 46" className="pointer-events-none absolute top-1/2 left-1/2 w-[min(80cqw,330px)] -translate-x-1/2 -translate-y-1/2 font-sans font-semibold">
      <path id="dc-arc-top" d="M 8 14 Q 50 -4 92 14" fill="none" />
      <path id="dc-arc-bottom" d="M 14 36 Q 50 50 86 36" fill="none" />
      <text fontSize="3" fill="oklch(0.82 0.11 85 / 0.55)" letterSpacing="0.7">
        <textPath href="#dc-arc-top" startOffset="50%" textAnchor="middle">
          BEAT YOUR RIVAL · TAKE THEIR CHIPS
        </textPath>
      </text>
      <text fontSize="2.4" fill="oklch(0.82 0.11 85 / 0.38)" letterSpacing="0.8">
        <textPath href="#dc-arc-bottom" startOffset="50%" textAnchor="middle">
          DEALER STANDS ON ALL 17s
        </textPath>
      </text>
    </svg>
  );
}

function Shoe({ left }: { left: number }) {
  return (
    <div role="img" className="absolute top-1/2 right-[5%] z-10 flex -translate-y-1/2 flex-col items-center gap-1" aria-label={`${left} cards left in the shoe`}>
      <div data-shoe aria-hidden className="relative h-[42px] w-[30px] rounded-[3px] bg-[oklch(0.18_0.02_45)] shadow-[0_3px_8px_oklch(0_0_0/0.5)] ring-1 ring-[oklch(0.82_0.11_85/0.35)]">
        {[0, 1, 2].map((i) => (
          <CardFace key={i} card={null} className="absolute" style={{ fontSize: 26, left: 2 + i * 1.2, top: 2 - i * 1.2 }} />
        ))}
      </div>
      <p className="font-display text-[10px] leading-none text-fg/80 tabular-nums">{left}</p>
      <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-black/50">
        <span className="block h-full bg-[oklch(0.82_0.11_85/0.8)] transition-[width] duration-700" style={{ width: `${(left / SHOE_SIZE) * 100}%` }} />
      </span>
      <p className="text-[8px] font-bold tracking-[0.14em] text-[oklch(0.9_0.06_85/0.6)]">7 DECKS</p>
    </div>
  );
}

function Discard() {
  return (
    <div aria-hidden className="flex flex-col items-center gap-1">
      <div data-discard className="relative h-[42px] w-[30px] rotate-[-8deg]">
        {[0, 1].map((i) => (
          <CardFace key={i} card={null} className="absolute opacity-60" style={{ fontSize: 28, left: i * 2, top: -i * 1.5 }} />
        ))}
      </div>
      <p className="text-[8px] font-bold tracking-[0.14em] text-[oklch(0.9_0.06_85/0.5)]">DISCARD</p>
    </div>
  );
}

// The dealer's chip tray: columns of $5, $2 and $1 seen from above the rail.
function Tray() {
  return (
    <div aria-hidden data-tray className="flex gap-[3px] rounded-md bg-black/40 p-1 ring-1 ring-[oklch(0.82_0.11_85/0.3)]">
      {([5, 2, 1] as const).map((v) => (
        <span key={v} className="relative block h-9 w-3 overflow-hidden rounded-[3px]">
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="absolute left-0 h-[5px] w-3 rounded-[2px] shadow-[0_1px_0_oklch(0_0_0/0.45)]" style={{ top: i * 4, background: CHIP_EDGE[v] }} />
          ))}
        </span>
      ))}
    </div>
  );
}

// A fresh 7-deck shoe: split into two packets, riffled together twice, squared up and loaded into the shoe.
function Shuffle({ elapsed }: { elapsed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = (ms: number) => `${ms - elapsed}ms`;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion()) return;
    const gap = gapTo(el, "[data-shoe]");
    if (!gap) return;
    const a = el.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: "translateY(-6px) scale(1.04)", opacity: 1, offset: 0.25 },
        { transform: `translate(${gap.dx}px, ${gap.dy}px) scale(0.55)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${gap.dx}px, ${gap.dy}px) scale(0.55)`, opacity: 0 },
      ],
      { duration: 650, delay: 1850 - elapsed, easing: "cubic-bezier(0.5, 0, 0.3, 1)", fill: "forwards" },
    );
    return () => a.cancel();
  }, [elapsed]);

  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
      <div ref={ref} className="relative h-[calc(var(--cw)*1.4)] w-[var(--cw)]">
        {(["l", "r"] as const).map((side) => (
          <span key={side} data-side={side} className="dc-packet absolute inset-0" style={{ animationDelay: at(0) }}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="dc-back absolute inset-0" style={{ top: -i * 1.5, bottom: i * 1.5 }} />
            ))}
          </span>
        ))}
        {[0, 1].map((r) =>
          Array.from({ length: 10 }, (_, i) => (
            <span
              key={`${r}-${i}`}
              data-side={i % 2 ? "r" : "l"}
              className="dc-riffle dc-back absolute inset-0"
              style={{ animationDelay: at(260 + r * 720 + i * 48), top: -(r * 10 + i) * 0.6, bottom: (r * 10 + i) * 0.6 }}
            />
          )),
        )}
      </div>
      <p
        className="dc-caption absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-0.5 text-[10px] font-bold tracking-[0.2em] whitespace-nowrap text-[oklch(0.9_0.06_85)]"
        style={{ animationDelay: at(0) }}
      >
        SHUFFLING 7 DECKS
      </p>
    </div>
  );
}

function Panel({
  conn,
  me,
  opp,
  myTurn,
  revealed,
  secs,
  dealing,
  onShare,
}: {
  conn: DuelConnection;
  me: DuelPlayer | undefined;
  opp: DuelPlayer | undefined;
  myTurn: boolean;
  revealed: boolean;
  secs: number | null;
  dealing: boolean;
  onShare: () => void;
}) {
  const { game } = conn;
  const oppName = opp?.name ?? "Your opponent";

  let body: ReactNode;
  let view: string = game.phase;
  if (!me) {
    body = <Status>Finding your seat…</Status>;
  } else if (game.phase === "lobby" || !opp) {
    body = (
      <>
        <Status>
          <span>
            Waiting for a challenger. Send them code <span className="font-display tracking-[0.12em] text-accent">{conn.code}</span>
          </span>
        </Status>
        <Button size="lg" block onClick={onShare}>
          Invite a friend
        </Button>
      </>
    );
  } else if (game.phase === "betting") {
    body = <Betting conn={conn} me={me} opp={opp} secs={secs} />;
  } else if (game.phase === "playing" && dealing) {
    view = "dealing";
    const first = inHand(game)[0];
    body = (
      <Status>
        {game.shuffled ? "Fresh shoe. The dealer shuffles…" : "Dealing…"}
        {first && <span className="mt-0.5 block text-xs">{first.id === me.id ? "You act first this hand" : `${first.name} acts first this hand`}</span>}
      </Status>
    );
  } else if (game.phase === "playing") {
    view = myTurn ? "turn" : "wait";
    body = myTurn ? (
      <Actions conn={conn} me={me} secs={secs} />
    ) : (
      <>
        <TurnClock label={`${game.players.find((p) => p.id === game.turnId)?.name ?? oppName} is thinking`} secs={secs} />
        <Status>{me.cards.length === 0 ? "Sitting this one out." : me.done ? "You're set. Waiting on the table…" : "You're up next…"}</Status>
      </>
    );
  } else {
    view = `settle-${revealed}`;
    body = revealed && me.result ? <MyResult me={me} opp={opp} secs={secs} /> : <Status>Dealer&apos;s turn…</Status>;
  }

  // Re-keyed per state so each change (betting, your move, result) eases in instead of snapping.
  return (
    <footer className="flex min-h-[196px] flex-col justify-end px-4 pt-2 pb-safe-3">
      <div key={view} className="dc-rise flex flex-col gap-2.5">
        {body}
      </div>
    </footer>
  );
}

function TurnClock({ label, secs }: { label: ReactNode; secs: number | null }) {
  const total = TURN_MS / 1000;
  const pct = secs === null ? 100 : Math.min(100, (secs / total) * 100);
  return (
    <div className="flex flex-col gap-1.5" role="timer" aria-label={secs === null ? undefined : `${secs} seconds left`}>
      <div className="flex items-baseline justify-between font-display text-sm tracking-wide">
        <span className="truncate">{label}</span>
        {secs !== null && <span className={cx("tabular-nums", secs <= 5 ? "text-danger" : "text-muted")}>{secs}s</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cx("h-full rounded-full transition-[width] duration-1000 ease-linear", secs !== null && secs <= 5 ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="grid min-h-16 place-items-center rounded-2xl border border-line bg-surface px-4 py-2 text-center text-sm text-muted">
      {children}
    </p>
  );
}

function Betting({ conn, me, opp, secs }: { conn: DuelConnection; me: DuelPlayer; opp: DuelPlayer; secs: number | null }) {
  const [topUp, setTopUp] = useState(false);
  // No chips (just sat down, or went broke): buy in before anything else.
  if (me.chips < 1 || topUp) return <BuyIn conn={conn} me={me} opp={opp} onCancel={me.chips < 1 ? undefined : () => setTopUp(false)} onDone={() => setTopUp(false)} />;
  return <BetChips conn={conn} me={me} opp={opp} secs={secs} onTopUp={() => (tap(), setTopUp(true))} />;
}

const BUY_IN_PRESETS = [MIN_BUY_IN, 50, MAX_BUY_IN] as const;

// Pick how much to bring to the table: $20 to $100 a time.
function BuyIn({ conn, me, opp, onCancel, onDone }: { conn: DuelConnection; me: DuelPlayer; opp: DuelPlayer; onCancel?: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState<number>(MAX_BUY_IN);
  const first = me.bought === 0;
  return (
    <>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-sm tracking-wide">{first ? "Choose your buy-in" : me.chips < 1 ? "You're out of chips. Buy back in" : "Top up your chips"}</p>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg">
            Back
          </button>
        ) : (
          <p className="text-[10px] tracking-[0.1em] text-muted uppercase">{opp.chips < 1 ? `${opp.name} is buying in…` : `${opp.name} has ${money(opp.chips)}`}</p>
        )}
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <p className="w-20 font-display text-3xl text-accent tabular-nums">{money(amount)}</p>
        <input
          type="range"
          min={MIN_BUY_IN}
          max={MAX_BUY_IN}
          step={5}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Buy-in amount"
          className="h-11 min-w-0 flex-1 accent-[var(--color-accent)]"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {BUY_IN_PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => (tap(), setAmount(v))}
            className={cx(
              "min-h-11 rounded-xl border font-display text-sm tabular-nums transition-colors",
              amount === v ? "border-accent bg-accent/15 text-accent" : "border-line text-muted active:bg-surface-2",
            )}
          >
            {money(v)}
          </button>
        ))}
      </div>
      <Button size="lg" block onClick={() => (success(), conn.send({ type: "buyin", amount }), onDone())}>
        Buy in for {money(amount)}
      </Button>
    </>
  );
}

function BetChips({ conn, me, opp, secs, onTopUp }: { conn: DuelConnection; me: DuelPlayer; opp: DuelPlayer; secs: number | null; onTopUp: () => void }) {
  const bet = betOf(me);
  const room = me.chips - bet;
  const allIn = bet > 0 && room === 0;
  const oppBet = betOf(opp);
  // Only the smaller bet is at risk: you can't win more than the other player put up.
  const stake = bet > 0 && oppBet > 0 ? Math.min(bet, oppBet) : 0;

  function add(v: Denom) {
    if (v > room) return fail();
    tap();
    conn.send({ type: "chip", value: v });
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={me.stack.length === 0 || me.ready}
          onClick={() => (tap(), conn.send({ type: "undo" }))}
          className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg disabled:opacity-30"
        >
          Undo
        </button>
        <p className="text-center font-display text-sm tabular-nums">
          <span className="text-muted">BET </span>
          <span className="text-accent">{money(bet)}</span>
          {allIn && <span className="ml-1.5 rounded-sm bg-danger px-1 text-[10px] tracking-[0.1em] text-ink">ALL IN</span>}
          <span className="block text-[10px] tracking-[0.1em] text-muted">
            {opp.ready ? `${opp.name} locked ${money(oppBet)}` : opp.chips < 1 ? `${opp.name} is buying in…` : `${opp.name} is betting…`}
            {stake > 0 && bet !== oppBet && ` · ${money(stake)} at stake`}
          </span>
        </p>
        <button
          type="button"
          disabled={me.stack.length === 0 || me.ready}
          onClick={() => (tap(), conn.send({ type: "clear" }))}
          className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg disabled:opacity-30"
        >
          Clear
        </button>
      </div>
      <div className="grid grid-cols-4 items-center justify-items-center gap-2">
        {DENOMS.map((v) => (
          <button
            key={v}
            type="button"
            data-chip-button={v}
            disabled={me.ready || v > room}
            onClick={() => add(v)}
            aria-label={`Add $${v}`}
            className="rounded-full transition-[transform,opacity] duration-150 active:translate-y-0.5 active:scale-95 disabled:opacity-30"
          >
            <ChipFace v={v} size="clamp(54px,15vw,64px)" />
          </button>
        ))}
        <button
          type="button"
          disabled={me.ready || room <= 0}
          onClick={() => (tap(), conn.send({ type: "allin" }))}
          aria-label={`All in, ${money(me.chips)}`}
          className="grid size-[clamp(54px,15vw,64px)] place-items-center rounded-full border-2 border-[oklch(0.82_0.11_85)] bg-[radial-gradient(circle_at_40%_35%,oklch(0.3_0.02_45),oklch(0.16_0.01_45))] font-display text-[13px] leading-none tracking-[0.06em] text-[oklch(0.9_0.08_85)] shadow-[0_3px_0_oklch(0.1_0_0),0_6px_12px_oklch(0_0_0/0.45)] transition-[transform,opacity] duration-150 active:translate-y-0.5 active:scale-95 disabled:opacity-30"
        >
          <span>
            ALL
            <br />
            IN
          </span>
        </button>
      </div>
      <Button size="lg" block disabled={me.ready || bet < 1} onClick={() => (success(), conn.send({ type: "lock" }))}>
        {me.ready
          ? `Waiting on ${opp.name}${secs !== null ? ` · ${secs}s` : "…"}`
          : bet < 1
            ? `Set down a chip${secs !== null ? ` · $1 in ${secs}s` : ""}`
            : `${allIn ? "Go all in" : "Lock in"} ${money(bet)}${secs !== null ? ` · ${secs}s` : ""}`}
      </Button>
      {!me.ready && (
        <button type="button" onClick={onTopUp} className="-mt-1 min-h-9 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg">
          + Buy more chips
        </button>
      )}
    </>
  );
}

function Actions({ conn, me, secs }: { conn: DuelConnection; me: DuelPlayer; secs: number | null }) {
  const bet = betOf(me);
  const canDouble = me.cards.length === 2 && me.chips >= bet;
  const go = (type: "hit" | "stand" | "double") => {
    tap();
    conn.send({ type });
  };
  return (
    <>
      <TurnClock
        label={
          <>
            Your move · <span className="text-accent tabular-nums">{totalLabel(me.cards)}</span>
          </>
        }
        secs={secs}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <Button size="lg" onClick={() => go("hit")}>
          Hit
        </Button>
        <Button size="lg" variant="secondary" onClick={() => go("stand")}>
          Stand
        </Button>
      </div>
      <Button variant="secondary" block disabled={!canDouble} onClick={() => go("double")}>
        Double {canDouble && <span className="text-muted tabular-nums">+{money(bet)}</span>}
      </Button>
    </>
  );
}

function MyResult({ me, opp, secs }: { me: DuelPlayer; opp: DuelPlayer; secs: number | null }) {
  const net = me.result?.net ?? 0;
  const vs = me.result?.vs;
  useEffect(() => {
    if (net > 0) success();
    else if (net < 0) fail();
  }, [net]);
  if (!vs) return <Status>Sat this one out.</Status>;
  return (
    <div className="dc-in flex flex-col items-center gap-1 rounded-2xl border border-line bg-surface px-3 py-3.5">
      <p className={cx("max-w-full truncate font-display text-2xl", net > 0 ? "text-active" : net < 0 ? "text-danger" : "text-stayed")}>
        {vs === "win" ? `YOU TAKE ${money(net)}` : vs === "lose" ? `${opp.name} takes ${money(-net)}` : "STANDOFF"}
      </p>
      <p className="text-center text-xs text-muted">
        You: {handNote(me)} · {opp.name}: {handNote(opp)}
      </p>
      {secs !== null && <p className="text-xs text-muted tabular-nums">Next hand in {secs}s</p>}
    </div>
  );
}
