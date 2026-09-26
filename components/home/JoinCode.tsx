"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

const LENGTH = 6;

export function JoinCode({ initialCode, onJoin }: { initialCode: string; onJoin: (code: string) => void }) {
  const [code, setCode] = useState(initialCode);
  const [focused, setFocused] = useState(false);

  function change(raw: string) {
    const next = raw.replace(/\D/g, "").slice(0, LENGTH);
    setCode(next);
    if (next.length === LENGTH && next !== code) onJoin(next);
  }

  return (
    <section aria-labelledby="join-title" className="flex flex-col gap-3">
      <h2 id="join-title" className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">
        Join with a code
      </h2>
      <label className="relative block">
        <input
          value={code}
          onChange={(e) => change(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="6-digit room code"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="go"
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === LENGTH) onJoin(code);
          }}
          className="absolute inset-0 z-10 w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0"
        />
        <span aria-hidden className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: LENGTH }, (_, i) => {
            const digit = code[i];
            const isCaret = focused && i === Math.min(code.length, LENGTH - 1);
            return (
              <span
                key={i}
                className={cx(
                  "grid h-16 place-items-center rounded-xl border-2 font-display text-3xl tabular-nums transition-colors duration-150",
                  digit ? "border-line bg-surface-2 text-fg" : "border-line/70 bg-surface text-muted/40",
                  isCaret && "border-accent",
                )}
              >
                {digit ? <span className="animate-pop">{digit}</span> : "·"}
              </span>
            );
          })}
        </span>
      </label>
      {code.length === LENGTH && (
        <Button variant="secondary" block onClick={() => onJoin(code)}>
          Join table {code}
        </Button>
      )}
    </section>
  );
}
