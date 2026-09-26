const RULES: [string, string][] = [
  ["Hit or stay", "Draw cards one at a time. Stay to bank the sum of your numbers."],
  ["Don't double up", "Draw a number you already have and you bust: zero this round."],
  ["Flip 7", "Seven different numbers ends the round instantly, plus 15 bonus."],
  ["Action cards", "Freeze banks someone out. Flip Three forces three draws. Second Chance saves one bust."],
  ["Modifiers", "+2 to +10 add on top; ×2 doubles your numbers. They never bust you."],
  ["Win", "First to 200 points at the end of a round takes the game."],
];

export function HowToPlay() {
  return (
    <details className="group rounded-2xl border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 font-display tracking-wide select-none [&::-webkit-details-marker]:hidden">
        How to play
        <span aria-hidden className="inline-block text-xl text-muted transition-[rotate] duration-200 ease-[var(--ease-out)] group-open:rotate-45">
          +
        </span>
      </summary>
      <ol className="flex flex-col gap-3 px-4 pb-4">
        {RULES.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="font-display text-sm tabular-nums text-accent">{i + 1}</span>
            <p className="text-sm leading-snug text-muted">
              <strong className="font-semibold text-fg">{title}.</strong> {body}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}
