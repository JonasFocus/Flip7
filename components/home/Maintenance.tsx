export function Maintenance() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-10 px-6 pt-safe-8 pb-safe-8 text-center">
      <h1 className="font-display text-[44px] leading-[0.9] tracking-tight [text-shadow:0_4px_0_var(--color-ink)]" aria-label="Game Time">
        <span className="block text-fg">GAME</span>
        <span className="block text-accent">TIME</span>
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
