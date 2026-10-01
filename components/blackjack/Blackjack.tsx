"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./blackjack.css";
import { shareInvite } from "@/components/lobby/Lobby";
import { useSecondsLeft } from "@/components/table/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { fail, success, tap } from "@/lib/client/haptics";
import {
  CARD_SLIDE_MS,
  DEALER_CARD_MS,
  DEAL_STAGGER_MS,
  MIN_BET,
  SEATS,
  SETTLE_MS,
  SHOE_SIZE,
  TURN_MS,
  handValue,
  isBlackjack,
  isBust,
} from "@/lib/blackjack";
import type { BjCard, BjConnection, BjPlayer, BjState, Outcome } from "@/lib/blackjack/types";

const SUIT = { s: "♠︎", h: "♥︎", d: "♦︎", c: "♣︎" } as const;
const CHIPS = [
  { value: 10, color: "var(--color-card-5)" },
  { value: 25, color: "var(--color-card-7)" },
  { value: 100, color: "var(--color-card-12)" },
  { value: 500, color: "var(--color-card-2)" },
];

// First base (seat 1) sits at the dealer's left, i.e. the right of the screen, and acts first.
const SEAT_POS = Array.from({ length: SEATS }, (_, i) => {
  const a = ((18 + i * 36) * Math.PI) / 180;
  return { left: `${50 + 40 * Math.cos(a)}%`, top: `${37 + 49 * Math.sin(a)}%` };
});

const chipColor = (amount: number) => [...CHIPS].reverse().find((c) => amount >= c.value)?.color ?? "var(--color-card-0)";
const short = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`);
const FAN = 0.42; // each card in a hand shows this much (in card widths) of the one beneath: its corner index
const SWEEP_MS = 700; // end of settle: cards sweep to the discard tray before the table resets
const CHIP_FLY_MS = 650;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Distance from el's centre to the centre of a landmark on the felt ([data-shoe], [data-dealer], [data-discard]).
function gapTo(el: Element, selector: string): { dx: number; dy: number } | null {
  const target = el.closest("[data-table]")?.querySelector(selector);
  if (!target) return null;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return { dx: b.left + b.width / 2 - (a.left + a.width / 2), dy: b.top + b.height / 2 - (a.top + a.height / 2) };
}

const inHand = (g: BjState) => g.players.filter((p) => p.cards.length > 0).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));

function totalLabel(cards: readonly (BjCard | null)[]): string {
  if (isBlackjack(cards)) return "BJ";
  const { total, soft } = handValue(cards);
  return soft && total < 21 ? `${total - 10}/${total}` : `${total}`;
}

// Settle: the hole card flips, then the dealer draws one card per DEALER_CARD_MS. Derived from the deadline so a reload lands mid-reveal.
function useDealerShown(conn: BjConnection): { shown: number; done: boolean; clearing: boolean } {
  const { game, deadlineAt } = conn;
  const len = game.dealer.length;
  const settling = game.phase === "settle" && deadlineAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!settling) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [settling]);
  if (!settling) return { shown: len, done: true, clearing: false };
  // On a dealer blackjack the hand settles mid-deal, so `start` can still be ahead while the cards land.
  const start = deadlineAt - SETTLE_MS - Math.max(0, len - 2) * DEALER_CARD_MS;
  const shown = Math.min(len, 2 + Math.max(0, Math.floor((now - start) / DEALER_CARD_MS)));
  return { shown, done: now >= start && shown >= len, clearing: now >= deadlineAt - SWEEP_MS };
}

export function Blackjack({ conn }: { conn: BjConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const { shown, done, clearing } = useDealerShown(conn);
  const revealed = game.phase === "settle" && done;
  const myTurn = game.phase === "playing" && game.turnId === conn.you;
  const left = useSecondsLeft(conn.deadlineAt);
  // While the opening deal is still landing, the turn clock hasn't started: hold the buttons and the countdown.
  const dealing = game.phase === "playing" && left !== null && left > TURN_MS / 1000;
  const secs = dealing ? null : left;

  useEffect(() => {
    if (myTurn) tap();
  }, [myTurn]);

  // Chips already include this hand's payout on settle; hold it back until the dealer finishes.
  const chips = me ? me.chips - (game.phase === "settle" && !revealed && me.result ? me.result.net + me.bet : 0) : 0;

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
        <p className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-3 font-display text-sm tabular-nums text-accent" aria-label={`${chips} chips`}>
          <span aria-hidden className="bj-chip size-3.5 text-[9px]" style={{ "--chip": "var(--color-accent)" } as CSSProperties} />
          {chips.toLocaleString()}
        </p>
      </header>

      <Felt conn={conn} shown={shown} revealed={revealed} clearing={clearing} secs={secs} />

      <Panel conn={conn} me={me} myTurn={myTurn} revealed={revealed} secs={secs} dealing={dealing} />
    </main>
  );
}

function Felt({
  conn,
  shown,
  revealed,
  clearing,
  secs,
}: {
  conn: BjConnection;
  shown: number;
  revealed: boolean;
  clearing: boolean;
  secs: number | null;
}) {
  const { game } = conn;
  const arcId = useId();
  const me = game.players.find((p) => p.id === conn.you);
  const canSit = !!me && me.cards.length === 0;
  const hand = inHand(game);
  const dealerCards = game.dealer.slice(0, shown);
  const dealerTotal = game.phase === "playing" ? handValue(dealerCards.slice(0, 1)) : handValue(dealerCards);

  function sit(seat: number) {
    if (!canSit) return;
    tap();
    conn.send({ type: "sit", seat });
  }

  return (
    <section aria-label="Table" data-table className="relative mx-2 min-h-0 flex-1">
      <div aria-hidden className="bj-felt absolute inset-x-0 top-0 bottom-[3%]" />
      <svg aria-hidden viewBox="0 0 100 40" className="pointer-events-none absolute top-[24%] left-[6%] w-[88%] font-display">
        <path id={arcId} d="M 6 4 Q 50 34 94 4" fill="none" />
        <text fontSize="3.6" fill="oklch(0.89 0.18 98 / 0.75)" letterSpacing="0.4">
          <textPath href={`#${arcId}`} startOffset="50%" textAnchor="middle">
            BLACKJACK PAYS 3 TO 2
          </textPath>
        </text>
        <text x="50" y="25" fontSize="2.6" fill="oklch(1 0 0 / 0.4)" textAnchor="middle" letterSpacing="0.3">
          DEALER STANDS ON ALL 17s
        </text>
      </svg>

      <div className="absolute top-[3%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="flex h-[calc(var(--d)*1.4)] items-end [--d:clamp(42px,12.5vw,54px)]">
          {dealerCards.length === 0 && <span className="grid h-full w-[var(--d)] place-items-center rounded-md border-2 border-dashed border-fg/25" />}
          {dealerCards.map((c, i) => (
            <Card
              key={`${game.round}-${i}`}
              card={c}
              delay={i < 2 ? (i * (hand.length + 1) + hand.length) * DEAL_STAGGER_MS : 0}
              sweep={clearing}
              className={cx(i > 0 && "-ml-[calc(var(--d)*0.55)]")}
              style={{ fontSize: "var(--d)" }}
            />
          ))}
        </div>
        <p data-dealer className="flex items-center gap-1.5 rounded-full bg-ink/70 px-2.5 py-0.5 font-display text-[10px] tracking-[0.14em] text-fg/80">
          DEALER
          {dealerCards.length > 0 && (
            <span
              style={{ animationDelay: `${(game.phase === "settle" ? 2 * hand.length + 1 : hand.length) * DEAL_STAGGER_MS + CARD_SLIDE_MS}ms` }}
              className={cx("bj-in tabular-nums", isBust(dealerCards) ? "text-danger" : "text-accent")}
            >
              {isBust(dealerCards) ? `${dealerTotal.total} BUST` : game.phase === "playing" ? `${dealerTotal.total}+?` : totalLabel(dealerCards)}
            </span>
          )}
        </p>
      </div>

      <Shoe left={game.shoeLeft} />
      <Discard />

      {SEAT_POS.map((pos, seat) => {
        const p = game.players.find((x) => x.seat === seat);
        return (
          <div key={seat} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={pos}>
            {p ? (
              <Seat conn={conn} player={p} order={hand.indexOf(p)} inHandCount={hand.length} revealed={revealed} clearing={clearing} secs={secs} />
            ) : (
              <button
                type="button"
                disabled={!canSit}
                onClick={() => sit(seat)}
                aria-label={`Sit in seat ${seat + 1}`}
                className={cx(
                  "grid size-[clamp(48px,14vw,58px)] place-items-center rounded-full border-2 border-dashed font-display text-[11px] tracking-[0.12em] transition-transform active:scale-95",
                  canSit && me?.seat === null ? "bj-glow border-accent bg-accent/10 text-accent" : "border-fg/25 text-fg/40",
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

function Shoe({ left }: { left: number }) {
  return (
    <div role="img" className="absolute top-[3%] right-[4%] flex flex-col items-center gap-1" aria-label={`${left} cards left in the shoe`}>
      <div data-shoe aria-hidden className="relative h-[42px] w-[30px]">
        {[0, 1, 2].map((i) => (
          <Card key={i} card={null} slide={false} className="absolute" style={{ fontSize: 28, left: i * 1.5, top: -i * 1.5 }} />
        ))}
      </div>
      <p className="font-display text-[10px] leading-none text-fg/80 tabular-nums">{left}</p>
      <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-ink/60">
        <span className="block h-full bg-accent" style={{ width: `${(left / SHOE_SIZE) * 100}%` }} />
      </span>
      <p className="text-[8px] font-bold tracking-[0.14em] text-fg/50">7 DECKS</p>
    </div>
  );
}

function Discard() {
  return (
    <div aria-hidden className="absolute top-[3%] left-[4%] flex flex-col items-center gap-1">
      <div data-discard className="relative h-[42px] w-[30px] rotate-[-8deg]">
        {[0, 1].map((i) => (
          <Card key={i} card={null} slide={false} className="absolute opacity-60" style={{ fontSize: 28, left: i * 2, top: -i * 1.5 }} />
        ))}
      </div>
      <p className="text-[8px] font-bold tracking-[0.14em] text-fg/50">DISCARD</p>
    </div>
  );
}

function Seat({
  conn,
  player,
  order,
  inHandCount,
  revealed,
  clearing,
  secs,
}: {
  conn: BjConnection;
  player: BjPlayer;
  order: number;
  inHandCount: number;
  revealed: boolean;
  clearing: boolean;
  secs: number | null;
}) {
  const { game } = conn;
  const mine = player.id === conn.you;
  const turn = game.phase === "playing" && game.turnId === player.id && secs !== null; // secs is null while the deal lands
  const bust = isBust(player.cards);
  const result = revealed ? player.result : null;
  const size = mine ? "clamp(38px,11.5vw,48px)" : "clamp(30px,8.6vw,38px)";
  const n = player.cards.length;

  return (
    <div className="relative flex flex-col items-center">
      {n > 0 && (
        <div className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2" style={{ "--s": size } as CSSProperties}>
          <div className={cx("relative h-[calc(var(--s)*1.4)]", bust && "animate-shake")} style={{ width: `calc(var(--s) + ${n - 1} * var(--s) * ${FAN})` }}>
            {player.cards.map((c, i) => (
              <Card
                key={`${game.round}-${i}`}
                card={c}
                delay={i < 2 ? (i * (inHandCount + 1) + order) * DEAL_STAGGER_MS : 0}
                sweep={clearing}
                className={cx("absolute transition-[filter] duration-500", bust && "brightness-75")}
                style={{ fontSize: "var(--s)", left: `calc(${i} * var(--s) * ${FAN})`, bottom: 0 }}
              />
            ))}
          </div>
          <span
            style={{ animationDelay: `${((inHandCount + 1) + order) * DEAL_STAGGER_MS + CARD_SLIDE_MS}ms` }}
            className={cx(
              "bj-in absolute -top-2 -right-3 rounded-full px-1.5 py-px font-display text-[10px] tabular-nums shadow-hard",
              bust ? "bg-danger text-ink" : isBlackjack(player.cards) ? "bg-accent text-ink" : "bg-ink text-fg",
            )}
          >
            {bust ? "BUST" : totalLabel(player.cards)}
          </span>
          {result && !clearing && <ResultTag outcome={result.outcome} net={result.net} />}
        </div>
      )}

      <span
        className={cx(
          "relative grid size-[clamp(48px,14vw,58px)] place-items-center rounded-full border-2 bg-ink/25",
          turn ? "bj-glow border-accent" : mine ? "border-accent/70" : "border-fg/30",
          result && result.net > 0 && "bj-win border-active",
        )}
      >
        {player.bet > 0 ? (
          // Re-keyed when betting reopens so a lost stake comes back as a fresh rebet.
          <Chip
            key={`${player.bet}-${game.phase === "lobby"}`}
            amount={player.bet}
            flyTo={result?.outcome === "lose" ? "[data-dealer]" : undefined}
            delay={350}
            className="animate-pop"
          />
        ) : (
          <Avatar id={player.id} seat={player.seat ?? undefined} name={player.name} />
        )}
        {result && result.net > 0 && (
          <Chip amount={result.net} small flyFrom="[data-dealer]" delay={350} className="absolute -top-2 -right-3 z-10" />
        )}
        {player.ready && game.phase === "lobby" && (
          <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-active text-[11px] text-ink" aria-label="Ready">
            ✓
          </span>
        )}
        {turn && secs !== null && (
          <span className="absolute -top-1 -left-1 grid size-5 place-items-center rounded-full bg-accent font-display text-[10px] text-ink tabular-nums">{secs}</span>
        )}
      </span>
      <span
        className={cx(
          "mt-1 max-w-[76px] truncate rounded-full px-2 py-px text-[11px] font-semibold",
          mine ? "bg-accent text-ink" : "bg-ink/70 text-fg/90",
          !player.connected && "opacity-50",
        )}
      >
        {mine ? "You" : player.name}
      </span>
    </div>
  );
}

const OUTCOME: Record<Outcome, { label: string; tone: string }> = {
  blackjack: { label: "BLACKJACK", tone: "bg-accent text-ink" },
  win: { label: "WIN", tone: "bg-active text-ink" },
  push: { label: "PUSH", tone: "bg-stayed text-ink" },
  lose: { label: "LOSE", tone: "bg-danger text-ink" },
};

function ResultTag({ outcome, net }: { outcome: Outcome; net: number }) {
  return (
    <span className={cx("bj-in absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-center font-display text-[10px] leading-tight whitespace-nowrap shadow-hard", OUTCOME[outcome].tone)}>
      {OUTCOME[outcome].label}
      {net !== 0 && <span className="block tabular-nums">{net > 0 ? `+${short(net)}` : `−${short(-net)}`}</span>}
    </span>
  );
}

// flyTo: the stake is swept to the dealer (a loss). flyFrom: winnings are pushed out from the dealer.
function Chip({
  amount,
  small = false,
  flyTo,
  flyFrom,
  delay = 0,
  className,
}: {
  amount: number;
  small?: boolean;
  flyTo?: string;
  flyFrom?: string;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    const target = flyTo ?? flyFrom;
    if (!el || !target || reducedMotion()) return;
    const gap = gapTo(el, target);
    if (!gap) return;
    const away = { transform: `translate(${gap.dx}px, ${gap.dy}px) scale(0.55)`, opacity: 0.2 };
    const home = { transform: "none", opacity: 1 };
    const fly = el.animate(flyTo ? [home, { ...away, opacity: 0 }] : [away, home], {
      duration: CHIP_FLY_MS,
      delay,
      easing: "cubic-bezier(0.22, 0.9, 0.3, 1)",
      fill: flyTo ? "forwards" : "backwards",
    });
    return () => fly.cancel();
  }, [flyTo, flyFrom, delay]);

  return (
    <span
      ref={ref}
      className={cx(
        "bj-chip grid place-items-center font-display tabular-nums",
        small ? "size-[clamp(24px,7vw,30px)] text-[9px]" : "size-[clamp(34px,10vw,42px)] text-[11px]",
        className,
      )}
      style={{ "--chip": chipColor(amount) } as CSSProperties}
    >
      {short(amount)}
    </span>
  );
}

function Index({ card, flip = false }: { card: BjCard; flip?: boolean }) {
  return (
    <span aria-hidden className="bj-idx" data-flip={flip || undefined}>
      <span className="bj-r" data-wide={card.rank === "10" || undefined}>
        {card.rank}
      </span>
      <span className="bj-s">{SUIT[card.suit]}</span>
    </span>
  );
}

// Deals out of the shoe face down, spinning onto its spot, and turns over as it lands (a hidden hole card stays down).
// Later changes (the hole card revealed) turn it over in place via the .bj-inner transition.
function Card({
  card,
  slide = true,
  delay = 0,
  sweep = false,
  className,
  style,
}: {
  card: BjCard | null;
  slide?: boolean;
  delay?: number;
  sweep?: boolean; // end of the hand: slide off to the discard tray
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [onMount] = useState(() => ({ slide, delay, faceUp: card !== null }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onMount.slide || reducedMotion()) return;
    const gap = gapTo(el, "[data-shoe]");
    if (!gap) return;
    const { dx, dy } = gap;
    const timing: KeyframeAnimationOptions = { duration: CARD_SLIDE_MS, delay: onMount.delay, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)", fill: "backwards" };
    const moves = [
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotate(-55deg) scale(0.75)` },
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
    const gap = gapTo(el, "[data-discard]");
    if (!gap) return;
    const away = el.animate(
      [{ transform: "none" }, { transform: `translate(${gap.dx}px, ${gap.dy}px) rotate(30deg) scale(0.6)`, opacity: 0 }],
      { duration: SWEEP_MS - 100, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
    );
    return () => away.cancel();
  }, [sweep]);

  const red = card?.suit === "h" || card?.suit === "d";
  return (
    <span
      ref={ref}
      role="img"
      aria-label={card ? `${card.rank}${SUIT[card.suit]}` : "Face-down card"}
      data-down={card ? undefined : true}
      className={cx("bj-card", className)}
      style={style}
    >
      <span className="bj-inner">
        <span className="bj-face bj-front" data-red={red || undefined}>
          {card && (
            <>
              <Index card={card} />
              {card.rank === "J" || card.rank === "Q" || card.rank === "K" ? (
                <span className="bj-court">
                  <span>{card.rank}</span>
                </span>
              ) : (
                <span className="bj-pip">{SUIT[card.suit]}</span>
              )}
              <Index card={card} flip />
            </>
          )}
        </span>
        <span className="bj-face bj-back" />
      </span>
    </span>
  );
}

function Panel({
  conn,
  me,
  myTurn,
  revealed,
  secs,
  dealing,
}: {
  conn: BjConnection;
  me: BjPlayer | undefined;
  myTurn: boolean;
  revealed: boolean;
  secs: number | null;
  dealing: boolean;
}) {
  const { game } = conn;
  const turnName = game.players.find((p) => p.id === game.turnId)?.name ?? "Someone";
  const openSeats = SEATS - game.players.filter((p) => p.seat !== null).length;

  let body;
  if (!me || me.seat === null) {
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
  } else if (game.phase === "lobby") {
    body = <Betting conn={conn} me={me} secs={secs} />;
  } else if (me.cards.length === 0) {
    body = <Status>Sitting this one out. You&apos;re in next hand.</Status>;
  } else if (game.phase === "playing" && dealing) {
    body = <Status>Dealing…</Status>;
  } else if (game.phase === "playing") {
    body = myTurn ? <Actions conn={conn} me={me} secs={secs} /> : <Status>{me.done ? "Waiting for the table…" : `${turnName} is playing…`}</Status>;
  } else {
    body = revealed && me.result ? <MyResult outcome={me.result.outcome} net={me.result.net} secs={secs} /> : <Status>Dealer&apos;s turn…</Status>;
  }

  // Re-keyed per state so each change (betting, your move, result) eases in instead of snapping.
  const view = !me || me.seat === null ? "rail" : game.phase === "playing" ? (dealing ? "dealing" : myTurn ? "turn" : "wait") : game.phase === "settle" ? `settle-${revealed}` : "bet";
  return (
    <footer className="flex min-h-[188px] flex-col justify-end px-4 pt-2 pb-safe-3">
      <div key={view} className="bj-rise flex flex-col gap-2.5">
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

function Betting({ conn, me, secs }: { conn: BjConnection; me: BjPlayer; secs: number | null }) {
  const { game } = conn;
  const broke = me.chips < MIN_BET;
  const waiting = game.players.filter((p) => p.seat !== null && !p.ready).length;

  function add(v: number) {
    const amount = Math.min(me.chips, me.bet + v);
    if (amount === me.bet) return fail();
    tap();
    conn.send({ type: "bet", amount });
  }

  if (broke) {
    return (
      <>
        <Status>Out of chips. The house spots you another stack.</Status>
        <Button size="lg" block onClick={() => (success(), conn.send({ type: "rebuy" }))}>
          Rebuy 1,000
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => (tap(), conn.send({ type: "standUp" }))} className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg">
          Stand up
        </button>
        <p className="font-display text-sm tabular-nums">
          <span className="text-muted">BET </span>
          <span className="text-accent">{me.bet.toLocaleString()}</span>
        </p>
        <button
          type="button"
          disabled={me.bet === 0 || me.ready}
          onClick={() => (tap(), conn.send({ type: "bet", amount: 0 }))}
          className="min-h-11 text-xs font-bold tracking-[0.16em] text-muted uppercase active:text-fg disabled:opacity-30"
        >
          Clear
        </button>
      </div>
      <div className="grid grid-cols-4 justify-items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={me.ready || c.value > me.chips - me.bet}
            onClick={() => add(c.value)}
            aria-label={`Add ${c.value}`}
            className="bj-chip grid size-[clamp(52px,16vw,62px)] place-items-center font-display text-sm tabular-nums transition-transform active:translate-y-0.5 disabled:opacity-30"
            style={{ "--chip": c.color } as CSSProperties}
          >
            {c.value}
          </button>
        ))}
      </div>
      <Button size="lg" block disabled={me.ready || me.bet < MIN_BET} onClick={() => (success(), conn.send({ type: "deal" }))}>
        {me.ready ? (waiting > 0 ? `Dealing in ${secs ?? "…"}s` : "Dealing…") : me.bet < MIN_BET ? "Place your bet" : secs !== null ? `Deal · ${secs}s` : "Deal"}
      </Button>
    </>
  );
}

function Actions({ conn, me, secs }: { conn: BjConnection; me: BjPlayer; secs: number | null }) {
  const canDouble = me.cards.length === 2 && me.chips >= me.bet;
  const go = (type: "hit" | "stand" | "double") => {
    tap();
    conn.send({ type });
  };
  return (
    <>
      <p className="text-center font-display text-sm tracking-wide">
        Your move · <span className="text-accent tabular-nums">{totalLabel(me.cards)}</span>
        {secs !== null && <span className="text-muted tabular-nums"> · {secs}s</span>}
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <Button size="lg" onClick={() => go("hit")}>
          Hit
        </Button>
        <Button size="lg" variant="secondary" onClick={() => go("stand")}>
          Stand
        </Button>
      </div>
      <Button variant="secondary" block disabled={!canDouble} onClick={() => go("double")}>
        Double {canDouble && <span className="text-muted tabular-nums">+{short(me.bet)}</span>}
      </Button>
    </>
  );
}

function MyResult({ outcome, net, secs }: { outcome: Outcome; net: number; secs: number | null }) {
  useEffect(() => {
    if (net > 0) success();
    else if (net < 0) fail();
  }, [net]);
  return (
    <div className="bj-in flex flex-col items-center gap-1 rounded-2xl border border-line bg-surface py-4">
      <p className={cx("font-display text-3xl", net > 0 ? "text-active" : net < 0 ? "text-danger" : "text-stayed")}>{outcome === "blackjack" ? "BLACKJACK!" : OUTCOME[outcome].label}</p>
      <p className="font-display text-lg tabular-nums">{net > 0 ? `+${net.toLocaleString()}` : net < 0 ? `−${(-net).toLocaleString()}` : "Bet returned"}</p>
      {secs !== null && <p className="text-xs text-muted tabular-nums">Next hand in {secs}s</p>}
    </div>
  );
}
