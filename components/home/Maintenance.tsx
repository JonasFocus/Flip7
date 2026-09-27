import type { Card } from "@/lib/engine/types";
import { PlayingCard } from "@/components/cards/PlayingCard";

const HERO_CARD: Card = { id: "hero-7", kind: "number", value: 7 };

export function Maintenance() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-10 px-6 pt-safe-8 pb-safe-8 text-center">
      <h1 className="flex items-center gap-2" aria-label="Flip 7">
        <span className="font-display text-[56px] leading-none tracking-tight text-fg [text-shadow:0_4px_0_var(--color-ink)]">
          FLIP
        </span>
        <PlayingCard card={HERO_CARD} size="md" className="animate-hero origin-bottom rotate-[-8deg]" />
      </h1>

      <div className="flex flex-col items-center gap-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted">Taking a short break</p>
        <p className="font-display text-3xl leading-tight tracking-wide text-accent">We&rsquo;ll be right back</p>
        <p className="max-w-xs text-base leading-relaxed text-muted">
          No games are available right now. If you think this is an error, contact Jonas.
        </p>
      </div>
    </main>
  );
}
