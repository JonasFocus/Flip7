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
}: {
  card: Card;
  size: "sm" | "md";
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid place-items-center rounded-xl py-1 transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.94] disabled:cursor-not-allowed"
    >
      <PlayingCard
        card={card}
        size={size}
        dim={!on}
        className={cx("transition-[transform,opacity,filter] duration-150 ease-[var(--ease-out)]", on && "-translate-y-1")}
      />
    </button>
  );
}

export function HandPicker({
  seat,
  initial,
  onSave,
  onClear,
  onClose,
}: {
  seat: ScorePlayer | null;
  initial: PhysicalEntry | null;
  onSave: (entry: PhysicalEntry) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={seat !== null} onClose={onClose} title={seat ? <SheetTitle seat={seat} /> : undefined}>
      {/* key remounts the form per seat so state starts from that seat's entry */}
      {seat && <PickerBody key={seat.id} initial={initial} onSave={onSave} onClear={onClear} />}
    </Sheet>
  );
}

function SheetTitle({ seat }: { seat: ScorePlayer }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar id={seat.id} name={seat.name} size="md" />
      <span className="truncate">{seat.name}</span>
    </span>
  );
}

function PickerBody({
  initial,
  onSave,
  onClear,
}: {
  initial: PhysicalEntry | null;
  onSave: (entry: PhysicalEntry) => void;
  onClear: () => void;
}) {
  const [entry, setEntry] = useState<PhysicalEntry>(initial ?? EMPTY);
  const count = entry.numbers.length;
  const flip7 = count >= 7 && !entry.busted;
  const score = scorePhysical(entry);
  const sum = entry.numbers.reduce((a, b) => a + b, 0);
  const plus = entry.plus.reduce((a, b) => a + b, 0);

  function set(next: PhysicalEntry) {
    tap();
    setEntry(next);
  }

  return (
    <div className="flex flex-col gap-3 select-none">
      <div className="flex items-end justify-between gap-3" aria-live="polite">
        <div className="min-w-0">
          <MicroLabel>{entry.busted ? "Busted" : flip7 ? "Flip 7 bonus +15" : "Round score"}</MicroLabel>
          <p className={cx("font-display text-5xl leading-none tabular-nums", entry.busted ? "text-busted" : flip7 ? "text-flip7" : "text-fg")}>
            {score}
          </p>
          <p className="mt-1 truncate text-sm text-muted tabular-nums">
            {entry.busted ? "No points this round" : `${sum}${entry.x2 ? " × 2" : ""}${plus ? ` + ${plus}` : ""}${flip7 ? " + 15" : ""}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {flip7 ? (
            <span className="animate-pop rounded-lg bg-flip7 px-2 py-0.5 font-display text-lg text-ink">Flip 7!</span>
          ) : (
            <span className="font-display text-lg tabular-nums text-muted">{count}/7</span>
          )}
          <span className="flex gap-1" aria-hidden>
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
        <MicroLabel className="mb-1">Numbers</MicroLabel>
        <div className="grid grid-cols-5 gap-x-1 landscape:grid-cols-7">
          {NUMBERS.map((v) => {
            const on = entry.numbers.includes(v);
            return (
              <PickCard
                key={v}
                card={{ id: `pick-${v}`, kind: "number", value: v }}
                size="md"
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
        <MicroLabel className="mb-1">Modifiers</MicroLabel>
        <div className="grid grid-cols-6">
          {PLUS.map((v) => (
            <PickCard
              key={v}
              card={{ id: `pick-p${v}`, kind: "plus", value: v }}
              size="sm"
              on={entry.plus.includes(v)}
              label={`Plus ${v}`}
              onClick={() => set({ ...entry, plus: toggle(entry.plus, v) })}
            />
          ))}
          <PickCard
            card={{ id: "pick-x2", kind: "x2" }}
            size="sm"
            on={entry.x2}
            label="Times 2"
            onClick={() => set({ ...entry, x2: !entry.x2 })}
          />
        </div>
      </div>

      <div className="flex gap-2">
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
    </div>
  );
}
