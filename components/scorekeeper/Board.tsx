"use client";

import { useEffect, useRef, useState } from "react";
import type { PhysicalEntry, ScorePlayer } from "@/lib/engine/types";
import type { ScoreConnection } from "@/lib/client/types";
import { scorePhysical } from "@/lib/engine/score";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { cx } from "@/components/ui/cx";
import { HandPicker } from "./HandPicker";
import { CountUp, GoalBar, MicroLabel, canControl, hostName, rankOf, standings, useTapGuard } from "./shared";

export function Board({ conn, onMenu }: { conn: ScoreConnection; onMenu: () => void }) {
  const { game } = conn;
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const advance = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Board is keyed by round, so the mount-time hold also swallows the second tap of a double-tapped Finish.
  const [held, hold] = useTapGuard();
  useEffect(() => () => clearTimeout(advance.current), []);

  const sorted = standings(game.players);
  const leader = sorted[0]?.total ?? 0;
  const missing = game.players.filter((p) => !game.entries[p.id]);
  // The CTA and auto-advance only walk seats held on this phone; the host can still tap any row.
  const myMissing = missing.filter((p) => p.ownerId === conn.you);
  const entered = game.players.length - missing.length;
  const seat = game.players.find((p) => p.id === editing) ?? null;

  function edit(id: string) {
    clearTimeout(advance.current);
    setEditing(id);
  }

  function save(entry: PhysicalEntry) {
    if (!seat) return;
    conn.send({ type: "submitEntry", seatId: seat.id, entry, round: game.round });
    const wasMissing = !game.entries[seat.id];
    const next = myMissing.find((p) => p.id !== seat.id);
    // Close first and reopen for the next seat after the sheet has visibly left, so a double-tapped
    // Save can't land on the next player's fresh "Save 0".
    setEditing(null);
    hold();
    clearTimeout(advance.current);
    if (wasMissing && next) advance.current = setTimeout(() => setEditing(next.id), 350);
  }

  function finish() {
    conn.send({ type: "finishRound", round: game.round });
    setConfirmFinish(false);
  }

  return (
    <>
      <header className="flex items-center justify-between gap-3 pt-safe-4 pb-3">
        <div>
          <MicroLabel>Goal {game.goal}</MicroLabel>
          <h1 className="font-display text-3xl leading-tight">Round {game.round}</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={onMenu} aria-label="Menu">
          <MenuIcon />
        </Button>
      </header>

      <div className="flex items-center justify-between pb-2">
        <MicroLabel>Standings</MicroLabel>
        <MicroLabel>
          <span className={cx(entered === game.players.length && "text-active")}>
            {entered}/{game.players.length} in
          </span>
        </MicroLabel>
      </div>

      <ol className={cx("flex flex-col gap-2 pb-4", held && "pointer-events-none")}>
        {sorted.map((p) => (
          <li key={p.id}>
            <SeatRow
              seat={p}
              index={game.players.indexOf(p)}
              rank={rankOf(sorted, p) + 1}
              lead={p.total === leader && leader > 0}
              goal={game.goal}
              entry={game.entries[p.id] ?? null}
              you={p.id === conn.you}
              onEdit={canControl(conn, p) ? () => edit(p.id) : undefined}
            />
          </li>
        ))}
      </ol>

      <div
        className={cx(
          "sticky bottom-0 -mx-4 mt-auto bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4",
          held && "pointer-events-none",
        )}
      >
        <BottomAction
          isHost={conn.isHost}
          host={hostName(conn)}
          nextMine={myMissing[0] ?? null}
          missing={missing.length}
          round={game.round}
          onEnter={edit}
          onFinish={() => (missing.length ? setConfirmFinish(true) : finish())}
        />
      </div>

      <HandPicker
        seat={seat}
        index={seat ? game.players.indexOf(seat) : -1}
        initial={seat ? (game.entries[seat.id] ?? null) : null}
        onSave={save}
        onClear={() => {
          if (seat) conn.send({ type: "clearEntry", seatId: seat.id, round: game.round });
          setEditing(null);
          hold();
        }}
        onRemove={
          seat && game.players.length > 1
            ? () => {
                conn.send({ type: "removeSeat", seatId: seat.id });
                setEditing(null);
                hold();
              }
            : undefined
        }
        onClose={() => setEditing(null)}
      />

      <Sheet open={confirmFinish} onClose={() => setConfirmFinish(false)} title="Finish round?">
        {/* The last missing hand can arrive from another phone while this is open. */}
        <p className="text-muted">
          {missing.length === 0
            ? "Everyone's in."
            : `${missing.map((p) => p.name).join(", ")} ${missing.length === 1 ? "has" : "have"} no hand entered. They'll score 0 this round.`}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button size="lg" block onClick={() => confirmFinish && finish()}>
            {missing.length === 0 ? `Finish round ${game.round}` : "Finish anyway"}
          </Button>
          <Button variant="ghost" block onClick={() => setConfirmFinish(false)}>
            Keep entering
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function BottomAction({
  isHost,
  host,
  nextMine,
  missing,
  round,
  onEnter,
  onFinish,
}: {
  isHost: boolean;
  host: string;
  nextMine: ScorePlayer | null;
  missing: number;
  round: number;
  onEnter: (id: string) => void;
  onFinish: () => void;
}) {
  if (nextMine && !(isHost && missing === 0)) {
    return (
      <div className="flex gap-2">
        <Button size="lg" block className="min-w-0 flex-1" onClick={() => onEnter(nextMine.id)}>
          <span className="truncate">Enter {nextMine.name}</span>
        </Button>
        {isHost && (
          <Button variant="secondary" size="lg" className="flex-none px-4 text-base" onClick={onFinish}>
            Finish
          </Button>
        )}
      </div>
    );
  }
  if (isHost) {
    return (
      <Button size="lg" block onClick={onFinish} variant={missing ? "secondary" : "primary"}>
        {missing ? `Finish round · ${missing} missing` : `Finish round ${round}`}
      </Button>
    );
  }
  return (
    <p className="flex min-h-16 items-center justify-center rounded-2xl border border-line text-center text-muted">
      {missing ? `Waiting for ${missing} more…` : `Waiting for ${host} to finish the round…`}
    </p>
  );
}

function SeatRow({
  seat,
  index,
  rank,
  lead,
  goal,
  entry,
  you,
  onEdit,
}: {
  seat: ScorePlayer;
  index: number;
  rank: number;
  lead: boolean;
  goal: number;
  entry: PhysicalEntry | null;
  you: boolean;
  onEdit?: () => void;
}) {
  const last = seat.rounds.at(-1);
  const body = (
    <>
      <span className={cx("w-5 flex-none text-center font-display text-sm", lead ? "text-accent" : "text-muted")}>{rank}</span>
      <Avatar id={seat.id} seat={index} name={seat.name} size="md" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{seat.name}</span>
          {you && <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">You</span>}
        </span>
        <GoalBar total={seat.total} goal={goal} lead={lead} />
      </span>
      {/* fixed slot so every row's goal bar has the same track length */}
      <span className="flex w-16 flex-none justify-end">
        <EntryChip entry={entry} editable={!!onEdit} />
      </span>
      <span className="flex min-w-12 flex-none flex-col items-end">
        <CountUp value={seat.total} className={cx("font-display text-2xl leading-none", lead && "text-accent")} />
        {!entry && typeof last === "number" && (
          <span className="mt-1 text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-muted/80 tabular-nums">+{last} last</span>
        )}
      </span>
    </>
  );
  const cls = cx(
    "flex w-full items-center gap-3 rounded-2xl border bg-surface px-3 py-3 text-left",
    lead ? "border-accent/40" : "border-line",
  );
  return onEdit ? (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${seat.name}, ${seat.total} points. ${entry ? `Entered ${scorePhysical(entry)}, tap to edit` : "Tap to enter hand"}`}
      className={cx(cls, "transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]")}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function EntryChip({ entry, editable }: { entry: PhysicalEntry | null; editable: boolean }) {
  if (!entry) {
    return editable ? (
      <span className="flex-none rounded-full border border-accent/60 px-2.5 py-1 font-display text-xs text-accent">+ Hand</span>
    ) : (
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">Waiting</span>
    );
  }
  const pts = scorePhysical(entry);
  const flip7 = !entry.busted && entry.numbers.length >= 7;
  return (
    <span
      className={cx(
        "flex-none animate-pop rounded-full px-2.5 py-1 font-display text-xs tabular-nums",
        entry.busted ? "bg-busted/15 text-busted" : flip7 ? "bg-flip7 text-ink" : "bg-active/15 text-active",
      )}
    >
      {entry.busted ? "Bust" : `+${pts}`}
    </span>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
