"use client";

import { useState } from "react";
import type { Card, PhysicalEntry, ScorePlayer } from "@/lib/engine/types";
import { scorePhysical } from "@/lib/engine/score";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";
import { tap, success, fail } from "@/lib/client/haptics";
import { MicroLabel } from "./shared";

const NUMBERS = Array.from({ length: 13 }, (_, v) => v);
const PLUS = [2, 4, 6, 8, 10] as const;
const EMPTY: PhysicalEntry = { numbers: [], x2: false, plus: [], busted: false };

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

// Picker cells are real cards so the grid reads like the hand on the table.
function PickCard({
  card,
  size,
  on,
  disabled,
  onClick,
  label,
  className,
  cardClassName,
}: {
  card: Card;
  size: "sm" | "md";
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      // aria-disabled, not disabled: a blocked tap still buzzes so the user learns why nothing happened.
      aria-disabled={disabled || undefined}
      onClick={disabled ? fail : onClick}
      className={cx(
        "grid place-items-center rounded-xl py-1 transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.94] aria-disabled:cursor-not-allowed aria-disabled:active:scale-100",
        className,
      )}
    >
      <PlayingCard
        card={card}
        size={size}
        highlight={on}
        className={cx("transition-[transform,opacity] duration-150 ease-[var(--ease-out)]", on ? "-translate-y-1" : disabled ? "opacity-25 saturate-0" : "opacity-70", cardClassName)}
      />
    </button>
  );
}

export function HandPicker({
  seat,
  index,
  initial,
  onSave,
  onClear,
  onRemove,
  onClose,
}: {
  seat: ScorePlayer | null;
  index: number;
  initial: PhysicalEntry | null;
  onSave: (entry: PhysicalEntry) => void;
  onClear: () => void;
  onRemove?: () => void; // undefined when this seat can't be removed (the last one at the table)
  onClose: () => void;
}) {
  return (
    // Landscape phones get a wider sheet so 13 number cards in one row stay at a 44px+ tap target.
    <Sheet
      open={seat !== null}
      onClose={onClose}
      title={seat ? <SheetTitle seat={seat} index={index} /> : undefined}
      className="[@media(max-height:500px)]:max-w-[46rem]"
    >
      {/* key remounts the form when the seat or its server entry changes, so an open sheet never saves a stale hand */}
      {seat && (
        <PickerBody
          key={`${seat.id}:${JSON.stringify(initial)}`}
          name={seat.name}
          initial={initial}
          onSave={onSave}
          onClear={onClear}
          onRemove={onRemove}
        />
      )}
    </Sheet>
  );
}

function SheetTitle({ seat, index }: { seat: ScorePlayer; index: number }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar id={seat.id} seat={index} name={seat.name} size="md" />
      <span className="truncate">{seat.name}</span>
    </span>
  );
}

function PickerBody({
  name,
  initial,
  onSave,
  onClear,
  onRemove,
}: {
  name: string;
  initial: PhysicalEntry | null;
  onSave: (entry: PhysicalEntry) => void;
  onClear: () => void;
  onRemove?: () => void;
}) {
  const [entry, setEntry] = useState<PhysicalEntry>(initial ?? EMPTY);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (confirmRemove && onRemove) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-muted text-pretty">
          {name} leaves the table for the rest of this game, and their scores come off the board.
        </p>
        <Button variant="danger" size="lg" block className="mt-3" onClick={onRemove}>
          Remove {name}
        </Button>
        <Button variant="ghost" block onClick={() => setConfirmRemove(false)}>
          Keep {name}
        </Button>
      </div>
    );
  }
  const count = entry.numbers.length;
  const flip7 = count >= 7 && !entry.busted;
  const score = scorePhysical(entry);
  const sum = entry.numbers.reduce((a, b) => a + b, 0);
  const plus = entry.plus.reduce((a, b) => a + b, 0);
  const breakdown = entry.busted
    ? "No points this round"
    : [count ? `${sum}${entry.x2 ? " × 2" : ""}` : null, plus ? `+${plus}` : null, flip7 ? "+15" : null].filter(Boolean).join(" ");

  function set(next: PhysicalEntry) {
    tap();
    setEntry(next);
  }

  return (
    <div className="flex flex-col gap-3 select-none [@media(max-height:500px)]:gap-1.5">
      <div className="flex items-end justify-between gap-3" aria-live="polite">
        <div className="min-w-0 [@media(max-height:500px)]:flex [@media(max-height:500px)]:items-baseline [@media(max-height:500px)]:gap-3">
          <MicroLabel>{entry.busted ? "Busted" : flip7 ? "Flip 7 bonus +15" : "Round score"}</MicroLabel>
          <p className={cx("font-display text-5xl leading-none tabular-nums [@media(max-height:500px)]:text-3xl", entry.busted ? "text-busted" : flip7 ? "text-flip7" : "text-fg")}>
            {score}
          </p>
          {breakdown && breakdown !== String(score) && (
            <p className="mt-1 truncate text-sm text-muted tabular-nums">{breakdown}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {flip7 ? (
            <span className="animate-pop rounded-lg bg-flip7 px-2 py-0.5 font-display text-lg text-ink">Flip 7!</span>
          ) : (
            <span className="font-display text-lg tabular-nums text-muted">{count}/7</span>
          )}
          <span className="flex gap-1 [@media(max-height:500px)]:hidden" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <span
                key={i}
                className={cx("size-2.5 rounded-full transition-colors duration-150", i < count ? (flip7 ? "bg-flip7" : "bg-fg") : "bg-surface-2")}
              />
            ))}
          </span>
        </div>
      </div>

      <div className={cx("transition-opacity duration-150", entry.busted && "opacity-40")}>
        <MicroLabel className="mb-1 [@media(max-height:500px)]:hidden">Numbers</MicroLabel>
        {/* flex-wrap centers the short last row; short phones go 7-wide with small cards and landscape phones
            go 13-wide so Save stays on screen */}
        <div className="flex flex-wrap justify-center">
          {NUMBERS.map((v) => {
            const on = entry.numbers.includes(v);
            return (
              <PickCard
                key={v}
                card={{ id: `pick-${v}`, kind: "number", value: v }}
                size="md"
                className="basis-1/5 [@media(orientation:landscape)_and_(min-height:701px)]:basis-1/7 [@media(min-height:501px)_and_(max-height:700px)]:basis-1/7 [@media(max-height:500px)]:basis-1/13"
                cardClassName="[@media(min-height:501px)_and_(max-height:700px)]:text-[40px] [@media(max-height:500px)]:text-[28px]"
                on={on}
                disabled={!on && count >= 7}
                label={String(v)}
                onClick={() => set({ ...entry, numbers: toggle(entry.numbers, v) })}
              />
            );
          })}
        </div>
      </div>

      <div className={cx("transition-opacity duration-150", entry.busted && "opacity-40")}>
        <MicroLabel className="mb-1 [@media(max-height:500px)]:hidden">Modifiers</MicroLabel>
        <div className="grid grid-cols-6">
          {PLUS.map((v) => (
            <PickCard
              key={v}
              card={{ id: `pick-p${v}`, kind: "plus", value: v }}
              size="sm"
              cardClassName="[@media(max-height:500px)]:text-[28px]"
              on={entry.plus.includes(v)}
              label={`Plus ${v}`}
              onClick={() => set({ ...entry, plus: toggle(entry.plus, v) })}
            />
          ))}
          <PickCard
            card={{ id: "pick-x2", kind: "x2" }}
            size="sm"
            cardClassName="[@media(max-height:500px)]:text-[28px]"
            on={entry.x2}
            label="Times 2"
            onClick={() => set({ ...entry, x2: !entry.x2 })}
          />
        </div>
      </div>

      <div className="sticky bottom-0 -mx-5 flex gap-2 bg-surface px-5 pt-2 pb-2">
        <button
          type="button"
          aria-pressed={entry.busted}
          onClick={() => {
            if (!entry.busted) fail();
            setEntry({ ...entry, busted: !entry.busted });
          }}
          className={cx(
            "flex min-h-16 flex-none items-center rounded-2xl border-2 px-4 font-display uppercase tracking-wide transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97]",
            entry.busted ? "border-busted bg-busted/15 text-busted" : "border-line text-muted",
          )}
        >
          Bust
        </button>
        <Button
          size="lg"
          block
          className="min-w-0 flex-1"
          onClick={() => {
            success();
            onSave(entry);
          }}
        >
          Save {score}
        </Button>
      </div>
      {initial && (
        <button type="button" onClick={onClear} className="-mt-1 min-h-11 text-sm font-semibold text-muted underline-offset-4 active:underline">
          Clear this hand
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          className={cx("min-h-11 text-sm font-semibold text-muted underline-offset-4 active:underline", !initial && "-mt-1")}
        >
          Remove from game
        </button>
      )}
    </div>
  );
}
