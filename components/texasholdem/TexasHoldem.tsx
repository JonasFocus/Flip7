"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from "react";
import "./texasholdem.css";
import { CardFace } from "@/components/casino/CardFace";
import { Chip, shortAmount } from "@/components/casino/Chip";
import { DealtCard, gapTo, reducedMotion } from "@/components/casino/motion";
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
  MAX_TX_BOTS,
  REACTION_COOLDOWN_MS,
  SEATS,
  SHOWDOWN_MS,
  SMALL_BLIND,
  TURN_MS,
  TX_REACTIONS,
  buildPots,
  canKickTx,
  isTxBotId,
  dealAnimMs,
  madeHand,
  oddsRunner,
  paidOut,
  streetAnimMs,
  wentAllIn,
  winLines,
} from "@/lib/texasholdem";
import { findBadBeat, type BadBeat } from "@/lib/texasholdem/badbeat";
import type { Odds } from "@/lib/texasholdem/equity";
import type { TxCard, TxConnection, TxPlayer, TxReaction, TxState } from "@/lib/texasholdem/types";
import { LOW_SECS, Panel } from "./Panel";

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
const ALL_IN_MS = 2600; // matches the tx-allin animation
const REACTION_SHOW_MS = 2000;
const BOARD_SIZE = "clamp(36px,10.4vw,46px)";
const STREET: Record<TxState["phase"], string> = { lobby: "", preflop: "PRE-FLOP", flop: "FLOP", turn: "TURN", river: "RIVER", showdown: "SHOWDOWN" };

const seatPos = (rel: number) => SEAT_POS[rel % SEAT_POS.length] ?? SEAT_POS[0];
const betPos = (rel: number) => BET_POS[rel % BET_POS.length] ?? BET_POS[0];

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

const MAX_WIN_ROWS = 3;

const sameCard = (a: TxCard, b: TxCard) => a.rank === b.rank && a.suit === b.suit;

const BAD_BEAT_MS = 2000; // inside the showdown beat: a callout never adds delay

// A big favorite beaten by the last card. Only a hand that ran out all-in counts, so the river was truly the final card.
function useBadBeat(game: TxState): BadBeat | null {
  const [runoutRound, setRunoutRound] = useState<number | null>(null);
  if (game.runout && runoutRound !== game.round) setRunoutRound(game.round);
  return useMemo(() => {
    if (game.phase !== "showdown" || runoutRound !== game.round) return null;
    const ranked = game.players.filter((p) => p.result?.hand != null).map((p) => ({ id: p.id, hole: p.cards.filter((c): c is TxCard => c !== null) }));
    return ranked.every((r) => r.hole.length === 2) ? findBadBeat(ranked, game.board) : null;
  }, [game.phase, game.players, game.board, game.round, runoutRound]);
}

function BadBeatCallout({ loser, you }: { loser: TxPlayer; you: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), BAD_BEAT_MS);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <p role="status" className="tx-pop absolute left-1/2 z-30 flex max-w-[84%] -translate-x-1/2 flex-col items-center rounded-2xl border border-danger/50 bg-[oklch(0.15_0.003_260/0.92)] px-4 py-1.5 text-center shadow-[0_8px_24px_-8px_oklch(0_0_0/0.8)]" style={{ top: "17%" }}>
      <span className="font-display text-2xl leading-none tracking-[0.2em] text-danger">BAD BEAT</span>
      <span className="mt-1 max-w-full truncate text-[12px] text-fg">
        {loser.id === you ? "You" : loser.name}
        {loser.result?.hand ? ` · ${loser.result.hand}` : ""}
      </span>
    </p>
  );
}

const ODDS_SLICE_MS = 8; // keep each slice of the win-odds work well under a frame

type ShownOdds = Odds & { delayMs: number }; // delayMs: wait for the street's cards to land before showing

const cardCode = (c: TxCard): string => `${c.rank}${c.suit}`;

// Once betting is over and every live hand is face up, each contesting seat's chance to win the board so far.
// Worked out here from the cards on the table only, in slices so a preflop runout never stalls a frame.
function useRunoutOdds(game: TxState): Map<string, ShownOdds> | null {
  const contenders = game.runout ? game.players.filter((p) => p.cards.length > 0 && !p.folded) : [];
  const holes = contenders.map((p) => p.cards.filter((c): c is TxCard => c !== null));
  const faceUp = holes.length > 1 && holes.every((h) => h.length === 2);
  const key = faceUp ? `${game.round}|${contenders.map((p, i) => `${p.id}:${holes[i]?.map(cardCode).join(",")}`).join("|")}|${game.board.map(cardCode).join(",")}` : null;
  const [done, setDone] = useState<{ key: string; round: number; firstLen: number; odds: Map<string, ShownOdds> } | null>(null);
  const latest = useRef({ ids: contenders.map((p) => p.id), holes, board: game.board, round: game.round });
  useEffect(() => {
    latest.current = { ids: contenders.map((p) => p.id), holes, board: game.board, round: game.round };
  });

  useEffect(() => {
    if (!key) return;
    const { ids, holes: hands, board, round } = latest.current;
    const runner = oddsRunner(hands, board);
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (!runner.run(ODDS_SLICE_MS)) {
        timer = setTimeout(step, 0);
        return;
      }
      const result = runner.result();
      setDone((prev) => {
        const firstLen = prev?.round === round ? prev.firstLen : board.length;
        const delayMs = board.length > firstLen ? streetAnimMs(board.length === 3 ? 3 : 1) : 0;
        return { key, round, firstLen, odds: new Map(ids.map((id, i) => [id, { ...(result[i] ?? { win: 0, tie: 0 }), delayMs }])) };
      });
    };
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [key]);

  return key !== null && done?.key === key ? done.odds : null;
}

// Whole percents, but never claim a sure thing (or none) before the river has settled it.
const pct = (n: number): string => (n > 0 && n < 1 ? "<1" : n < 100 && n > 99 ? ">99" : String(Math.round(n)));

// A shove lights the table up for a moment: who went in and for how much.
function useAllInMoment(game: TxState): { key: number; id: string; name: string; amount: number } | null {
  const [prev, setPrev] = useState(game);
  const [moment, setMoment] = useState<{ key: number; id: string; name: string; amount: number } | null>(null);
  if (game !== prev) {
    const shover = wentAllIn(prev, game);
    setPrev(game);
    if (shover) setMoment({ key: game.seq, id: shover.id, name: shover.name, amount: shover.total });
  }
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), ALL_IN_MS);
    return () => clearTimeout(t);
  }, [moment]);
  return moment;
}

export function TexasHoldem({ conn }: { conn: TxConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  const { game } = conn;
  const me = game.players.find((p) => p.id === conn.you);
  const seated = me?.seat != null;
  const { revealed, clearing } = useShowdown(conn);
  const street = game.phase !== "lobby" && game.phase !== "showdown";
  const myTurn = street && !game.runout && game.turnId === conn.you;
  const left = useSecondsLeft(conn.deadlineAt);
  // While the deal is still landing the turn clock hasn't started: hold the buttons and the countdown.
  const dealing = street && !game.runout && left !== null && left > TURN_MS / 1000;
  const secs = dealing ? null : left;

  // Winnings are already in the stack at showdown; hold them back until the winner is called.
  const stack = me ? me.chips - (game.phase === "showdown" && !revealed ? paidOut(me) : 0) : 0;
  const offline = conn.status !== "open";

  async function share() {
    tap();
    const msg = await shareInvite(conn.code);
    if (msg) setToast(msg);
  }

  return (
    <main className="tx-room mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-safe pt-safe select-none">
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
        {seated && (
          <button
            type="button"
            onClick={() => setReacting((v) => !v)}
            aria-label="Reactions"
            aria-expanded={reacting}
            className={cx("min-h-11 min-w-11 rounded-full border border-line text-base active:bg-surface-2", reacting && "bg-surface")}
          >
            <span aria-hidden>😊</span>
          </button>
        )}
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

      {seated && reacting && <ReactionStrip send={conn.send} />}

      <Felt conn={conn} me={me} revealed={revealed} clearing={clearing} secs={secs} />

      <Panel conn={conn} me={me} myTurn={myTurn} dealing={dealing} revealed={revealed} secs={secs} />
    </main>
  );
}

// Greys out for the server's cooldown after each tap, so the "Slow down" backstop never reaches a toast.
function ReactionStrip({ send }: { send: TxConnection["send"] }) {
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => setCooling(false), REACTION_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, [cooling]);

  function react(emoji: TxReaction) {
    tap();
    send({ type: "react", emoji });
    setCooling(true);
  }

  return (
    <div role="group" aria-label="Send a reaction" className="flex px-1">
      {TX_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          disabled={cooling}
          onClick={() => react(emoji)}
          className="min-h-11 min-w-0 flex-1 rounded-full text-xl transition-opacity active:bg-surface-2 disabled:opacity-40"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// Shows each new reaction for a couple of seconds. The first value seen on mount is marked seen, so joining or reloading never replays an old one.
function useReactionBubble(reaction: TxPlayer["reaction"]): { emoji: TxReaction; at: number } | null {
  const seen = useRef(reaction?.at);
  const [shown, setShown] = useState<{ emoji: TxReaction; at: number } | null>(null);
  const at = reaction?.at;
  const emoji = reaction?.emoji;
  useEffect(() => {
    if (at === undefined || emoji === undefined || at === seen.current) return;
    seen.current = at;
    setShown({ emoji, at });
    const t = setTimeout(() => setShown(null), REACTION_SHOW_MS);
    return () => clearTimeout(t);
  }, [at, emoji]);
  return shown;
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
  const odds = useRunoutOdds(game);
  const badBeat = useBadBeat(game);
  const badBeatLoser = badBeat && revealed ? game.players.find((p) => p.id === badBeat.loserId) : undefined;
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
  const lines = winLines(payees, conn.you);
  const shownLines = lines.slice(0, MAX_WIN_ROWS);
  const allIn = useAllInMoment(game);

  const bots = game.players.filter((p) => isTxBotId(p.id) && !p.gone).length;
  const canAddBot = bots < MAX_TX_BOTS && game.players.filter((p) => p.seat !== null).length < SEATS;

  function sit(seat: number) {
    if (!canSit) return;
    tap();
    conn.send({ type: "sit", seat });
  }

  return (
    <section aria-label="Table" data-table className="tx-table relative mx-2 min-h-0 flex-1">
      <div aria-hidden className="tx-felt absolute inset-x-0 top-[3%] bottom-[3%]" />
      {allIn && <div key={allIn.key} aria-hidden className="tx-allin pointer-events-none absolute inset-x-0 top-[3%] bottom-[3%]" />}

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
            <span key={i} aria-hidden className="rounded-[0.075em] border border-white/10 bg-black/20 shadow-[inset_0_1px_4px_oklch(0_0_0/0.35)]" style={{ fontSize: BOARD_SIZE, width: "1em", aspectRatio: "5 / 7" }} />
          );
        })}
      </div>

      {badBeatLoser && <BadBeatCallout key={game.round} loser={badBeatLoser} you={conn.you} />}

      <div className="absolute left-1/2 flex w-[84%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ top: "62%" }}>
        {lines.length > 0 ? (
          <div key={`${game.round}-banner`} role="status" className="tx-pop flex max-w-full flex-col items-center gap-1 rounded-2xl border border-active/50 bg-[oklch(0.15_0.003_260/0.92)] px-4 py-1.5 text-center shadow-[0_8px_24px_-8px_oklch(0_0_0/0.8)]">
            {shownLines.map((line) => (
              <p key={line.key} className="flex max-w-full flex-col items-center">
                <span className="max-w-full truncate font-display text-sm tracking-wide text-active">{line.text}</span>
                {line.hand && <span className="max-w-full truncate text-[11px] text-fg/70">{line.hand}</span>}
                {badBeat?.winnerIds.includes(line.key) && <span className="mt-0.5 rounded-full bg-danger/20 px-2 text-[11px] font-bold tracking-[0.12em] text-danger">RIVERED</span>}
              </p>
            ))}
            {lines.length > shownLines.length && <span className="text-[11px] text-fg/70">+{lines.length - shownLines.length} more</span>}
          </div>
        ) : allIn ? (
          <p key={allIn.key} role="status" className="tx-allin-call flex flex-col items-center text-center">
            <span className="font-display text-xl leading-none tracking-[0.18em] tabular-nums">
              <span className="text-[oklch(0.7_0.24_25)]">ALL IN</span> <span className="text-fg">{allIn.amount.toLocaleString()}</span>
            </span>
            <span className="mt-1 max-w-full truncate font-display text-[11px] tracking-[0.14em] text-fg/80">{allIn.id === conn.you ? "YOU" : allIn.name.toUpperCase()}</span>
          </p>
        ) : pots.length > 1 && game.players.some((p) => p.allIn && p.total > 0) ? (
          <p className="font-display text-[11px] tracking-[0.1em] text-fg/85 tabular-nums">
            {pots.map((p, i) => (
              <span key={i} className="mx-1">
                {i === 0 ? "MAIN" : `SIDE ${i}`} {shortAmount(p.amount)}
              </span>
            ))}
          </p>
        ) : (
          <p className="font-display text-[11px] tracking-[0.26em] text-fg/80">{STREET[game.phase]}</p>
        )}
        {conn.isHost && game.phase === "lobby" && (
          <button type="button" disabled={!canAddBot} onClick={() => (tap(), conn.addBot())} className="pointer-events-auto min-h-11 rounded-full border border-white/20 px-3 font-display text-[11px] tracking-[0.14em] text-fg/85 active:bg-white/10 disabled:opacity-30">
            + BOT
          </button>
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
              <Seat key={p.id} conn={conn} player={p} below={pos.y < 35} order={dealOrder(p)} handSize={hand.length} revealed={revealed} clearing={clearing} secs={secs} odds={odds?.get(p.id)} />
            ) : (
              <button
                type="button"
                disabled={!canSit}
                onClick={() => sit(seat)}
                aria-label={`Sit in seat ${seat + 1}`}
                className={cx(
                  "grid size-11 place-items-center rounded-full border bg-black/25 shadow-[inset_0_1px_3px_oklch(0_0_0/0.45)] transition-[scale,border-color,color] active:scale-95",
                  canSit && me?.seat === null ? "border-white/30 text-fg/85 hover:border-white/50 hover:text-fg" : canSit ? "border-white/20 text-fg/75" : "border-white/[0.06] text-transparent",
                )}
              >
                <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
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

// The shared deal animation, dealt out of the deck and swept back into it.
function Dealt({ dim = false, className, ...props }: Omit<ComponentProps<typeof DealtCard>, "slideMs" | "sweepMs" | "from" | "to" | "pips"> & { dim?: boolean }) {
  return (
    <DealtCard
      {...props}
      pips
      from="[data-deck]"
      to="[data-deck]"
      slideMs={CARD_SLIDE_MS}
      sweepMs={SWEEP_MS}
      className={cx("transition-[filter,opacity,font-size] duration-500 motion-reduce:transition-none", dim && "opacity-40 brightness-75", className)}
    />
  );
}

// The panel's turn clock, drawn round the acting seat so everyone can see whose time is running.
function TurnRing({ secs }: { secs: number }) {
  const low = secs <= LOW_SECS;
  const left = Math.min(1, secs / (TURN_MS / 1000));
  return (
    <svg aria-hidden viewBox="0 0 36 36" className="pointer-events-none absolute -top-[7px] -left-[7px] size-[calc(100%+14px)] -rotate-90">
      <circle
        cx="18"
        cy="18"
        r="17"
        fill="none"
        strokeWidth="1.5"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - left}
        className={cx("transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none", low ? "tx-low stroke-danger" : "stroke-accent")}
      />
    </svg>
  );
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
  odds,
}: {
  conn: TxConnection;
  player: TxPlayer;
  below: boolean; // upper seats show their showdown hand under the plate, there is no room above
  order: number;
  handSize: number;
  revealed: boolean;
  clearing: boolean;
  secs: number | null;
  odds: ShownOdds | undefined; // all-in runout only: this seat's chance to win the board so far
}) {
  const { game } = conn;
  const mine = player.id === conn.you;
  const street = game.phase !== "lobby" && game.phase !== "showdown";
  const turn = street && !game.runout && game.turnId === player.id && secs !== null; // secs is null while the deal lands
  const result = revealed ? player.result : null;
  const won = (result?.won ?? 0) > 0;
  const inHand = player.cards.length > 0;
  const ranked = game.phase === "showdown" && player.result?.hand != null; // a hand shown at a contested showdown stays up after its owner leaves
  const showCards = inHand && (mine || !player.folded || ranked);
  const busted = !inHand && player.chips < BIG_BLIND;
  const awardRef = useRef<HTMLSpanElement>(null);
  useFly(awardRef, won ? "[data-pot]" : undefined, "from", 150);
  const bubble = useReactionBubble(player.reaction);
  const [armed, setArmed] = useState(false);
  const canKick = conn.isHost && !mine && !player.gone && canKickTx(game, player.id);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const bestOf = player.result?.best ?? [];
  const dimCard = (c: TxCard | null) => revealed && won && bestOf.length > 0 && c !== null && !bestOf.some((b) => sameCard(b, c));

  // Winnings are in the stack already at showdown; hold them back until the winner is called.
  const shownStack = player.chips - (game.phase === "showdown" && !revealed ? paidOut(player) : 0);
  const faceUp = !mine && player.cards.some((c) => c !== null); // an opponent's hand only arrives face up at showdown
  const size = mine ? "clamp(44px,13vw,54px)" : faceUp ? "clamp(30px,9vw,36px)" : "clamp(22px,6.4vw,28px)";

  // Hand helper over your own cards while the hand is live; it waits for the cards that change it to land.
  const known = player.cards.filter((c): c is TxCard => c !== null);
  const helper = mine && street && !player.folded && known.length === 2 ? madeHand([...known, ...game.board]) : null;
  const helperDelay = game.board.length === 0 ? dealAnimMs(handSize) : streetAnimMs(game.board.length === 3 ? 3 : 1);

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
      {bubble && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-30 -translate-x-1/2">
          <span key={bubble.at} aria-hidden className="tx-react block text-3xl leading-none drop-shadow-[0_2px_6px_oklch(0_0_0/0.7)]">
            {bubble.emoji}
          </span>
          <span role="status" className="sr-only">{`${player.name} reacted ${bubble.emoji}`}</span>
        </span>
      )}
      {showCards && (
        <div className={cx("absolute left-1/2 flex -translate-x-1/2", mine ? "bottom-full z-10 mb-0.5 gap-1" : faceUp ? cx("z-10 gap-0.5", below ? "top-full mt-6" : "bottom-full mb-1") : "bottom-[58%]")}>
          {helper && (
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
              <span
                key={helper}
                role="status"
                aria-label={`You have ${helper}`}
                className="tx-pop block rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-ink shadow-[0_4px_12px_-2px_oklch(0_0_0/0.6)]"
                style={{ animationDelay: `${helperDelay}ms` }}
              >
                {helper}
              </span>
            </span>
          )}
          {player.cards.map((c, i) => (
            <Dealt
              key={`${game.round}-${i}`}
              card={c}
              delay={(i * handSize + order) * DEAL_STAGGER_MS}
              sweep={clearing}
              dim={(player.folded && !ranked) || dimCard(c)}
              size={size}
              className={cx(mine ? (i === 0 ? "-rotate-3" : "rotate-3") : faceUp ? (i === 0 ? "-rotate-3" : "rotate-3") : i === 0 ? "-rotate-6" : "rotate-6 -ml-[0.5em]", c && won && !dimCard(c) && "ring-2 ring-active", "rounded-[0.12em]")}
            />
          ))}
        </div>
      )}

      <span
        data-seat={player.seat}
        className={cx(
          "relative z-[1] grid place-items-center rounded-full bg-surface shadow-[0_6px_14px_-4px_oklch(0_0_0/0.7)] ring-2 ring-offset-2 ring-offset-[oklch(0.35_0.004_260)]",
          mine ? "size-[clamp(44px,12.5vw,50px)]" : "size-[clamp(38px,11vw,44px)]",
          turn ? "tx-glow ring-accent" : mine ? "ring-accent/60" : "ring-white/15",
          won && "tx-win ring-active",
          player.folded && inHand && "opacity-55",
        )}
      >
        <Avatar id={player.id} seat={player.seat ?? undefined} name={player.name} />
        {turn && secs !== null && <TurnRing secs={secs} />}
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
        {isTxBotId(player.id) && (
          <span aria-label="Bot" className="absolute -top-1.5 -left-3 z-10 rounded-full bg-fg px-1 font-display text-[9px] leading-4 text-ink shadow-[0_2px_6px_oklch(0_0_0/0.6)]">
            BOT
          </span>
        )}
        {won && result && <Chip ref={awardRef} amount={result.won} size="sm" className="absolute -top-4 -right-6 z-20" />}
      </span>

      <span
        className={cx(
          "-mt-2 w-[clamp(58px,17vw,66px)] rounded-lg border px-1 pt-2.5 pb-[3px] text-center leading-tight shadow-[0_6px_14px_-6px_oklch(0_0_0/0.8)]",
          mine ? "border-accent/80 bg-accent" : "border-white/10 bg-[oklch(0.15_0.003_260/0.92)]",
        )}
      >
        <span className={cx("block truncate text-[11px] font-semibold", mine ? "text-ink" : "text-fg/85")}>{mine ? "You" : player.name}</span>
        <span className={cx("block truncate font-display text-xs tabular-nums", mine ? "text-ink/80" : line.tone)}>{line.text}</span>
      </span>
      {canKick && (
        <button
          type="button"
          aria-label={armed ? `Confirm removing ${player.name}` : `Remove ${player.name}`}
          onClick={() => {
            tap();
            if (!armed) return setArmed(true);
            setArmed(false);
            conn.removePlayer(player.id);
          }}
          className={cx(
            "absolute -top-1 -right-3 z-20 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold shadow-[0_2px_6px_oklch(0_0_0/0.6)]",
            armed ? "bg-danger text-ink" : "bg-[oklch(0.15_0.003_260/0.92)] text-fg/80",
          )}
        >
          {armed ? "Remove?" : "×"}
        </button>
      )}
      {odds && (
        <span
          key={game.board.length}
          className="tx-pop absolute top-full z-20 mt-1 rounded-full bg-[oklch(0.15_0.003_260/0.92)] px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-fg tabular-nums"
          style={{ animationDelay: `${odds.delayMs}ms` }}
        >
          {pct(odds.win)}%{odds.tie > 0 && <span className="ml-1 text-[11px] font-normal text-fg/80">tie {pct(odds.tie)}%</span>}
        </span>
      )}
      {result?.hand && !mine && (
        <span className={cx("tx-in absolute top-full mt-1 max-w-[96px] truncate rounded-full bg-[oklch(0.15_0.003_260/0.92)] px-2 py-0.5 text-[10px] font-semibold", won ? "text-active" : "text-fg/65")}>{result.hand}</span>
      )}
    </div>
  );
}
