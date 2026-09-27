import type { ReactNode } from "react";
import type { GameState } from "@/lib/engine/types";
import { Deck, PlayingCard, cardLabel } from "@/components/cards/PlayingCard";
import { cx } from "@/components/ui/cx";
import { firstName } from "./hand";
import { STATUS_LABEL } from "./OpponentRail";
import type { Reveal } from "./useReveal";

function Prompt({
  game,
  you,
  awaitingId,
  caughtUp,
  dealing,
  beatCard,
  delayed,
}: {
  game: GameState;
  you: string;
  awaitingId: string | null;
  caughtUp: boolean;
  dealing: boolean;
  beatCard: boolean;
  delayed: boolean;
}) {
  const pending = game.pending;
  const who = game.players.find((p) => p.id === awaitingId);
  let big: string;
  let small: string | null = null;
  let mine = false;
  const next = pending?.type === "flipThree" && pending.queued.length > 0 ? ` · ${pending.queued.map(cardLabel).join(", ")} next` : "";

  if (game.phase === "roundOver") big = "Round over";
  else if (game.phase === "gameOver") big = "Game over";
  else if (!who) big = dealing ? "Dealing" : "…";
  // Pending (Flip Three count, choosing) is live state; while cards are still landing it would run ahead of them.
  else if (!caughtUp) {
    // A narration-only beat (stay, freeze, Flip 7): a lone name would read as "their turn", so say what they are now,
    // or leave the beat to the Spotlight pill.
    const quiet = !beatCard && !dealing;
    if (quiet && (who.status === "active" || who.status === "waiting")) return null;
    [big, small] = [who.id === you ? "You" : firstName(who.name), dealing ? "dealing" : quiet ? STATUS_LABEL[who.status] : null];
  }
  else if (who.id === you) {
    mine = true;
    if (pending?.type === "flipThree") [big, small] = ["Flip three", `${pending.remaining} to go${next}`];
    else if (pending?.type === "chooseTarget") [big, small] = ["Pick a target", null];
    else [big, small] = ["Your turn", "Hit or stay"];
  } else {
    big = firstName(who.name);
    small = pending?.type === "flipThree" ? `flipping three · ${pending.remaining} to go${next}` : pending ? "is choosing" : "is up";
  }

  return (
    // Not a live region: it remounts on every change, which screen readers skip. Table owns the turn announcement.
    // `delayed` waits out the leaving card's exit so the two don't overlap.
    <div
      key={`${big}-${small}`}
      className="animate-pop flex flex-col items-center gap-1 text-center"
      style={delayed ? { animationDelay: "220ms" } : undefined}
    >
      <span
        className={cx(
          "max-w-full px-2 font-display text-4xl text-balance uppercase leading-none [@media(max-height:540px)]:text-3xl",
          mine ? "text-accent [text-shadow:0_0_24px_oklch(0.89_0.18_98/0.5)]" : "text-fg",
        )}
      >
        {big}
      </span>
      {small && <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted">{small}</span>}
    </div>
  );
}

export function Stage({
  game,
  you,
  awaitingId,
  caughtUp,
  dealing,
  current,
  leaving,
  settled,
  beatCard,
  narration,
  hush = false,
}: {
  game: GameState;
  you: string;
  awaitingId: string | null;
  caughtUp: boolean;
  dealing: boolean;
  current: Reveal | null;
  leaving: boolean;
  settled: boolean; // the last beat has had its dwell
  beatCard: boolean; // the beat on stage put a card down (vs. a stay / freeze line)
  narration: ReactNode;
  hush?: boolean; // a celebration stamp is covering the stage; its prompt would read as the stamp's subject
}) {
  const owner = current ? game.players.find((p) => p.id === current.playerId) : undefined;
  const mine = current?.playerId === you;
  // Once the queue settles on someone else's turn, the last card is old news: hand the stage to their prompt.
  const stale = settled && current !== null && awaitingId !== null && awaitingId !== current.playerId;
  const gone = leaving || stale;
  const showCard = current !== null && !gone;
  const saved = current?.outcome === "saved";

  return (
    <section aria-label="Table" className="flex min-h-0 flex-1 flex-col items-center gap-1 px-4 py-2 short-land:py-1">
      <div className="grid min-h-0 w-full flex-1 place-items-center [container-type:size] [grid-template-areas:'stage']">
        {!showCard && (
          <div className={cx("[grid-area:stage]", hush ? "opacity-0" : "transition-opacity duration-200")}>
            <Prompt game={game} you={you} awaitingId={awaitingId} caughtUp={caughtUp} dealing={dealing} beatCard={beatCard} delayed={current !== null} />
          </div>
        )}
        {current && (
          <div
            key={current.key}
            // A save draws an outline ring around the card; the extra gap keeps it off the owner / "Saved!" labels.
            className={cx("flex flex-col items-center [grid-area:stage] motion-reduce:!transform-none", saved ? "gap-3.5" : "gap-1.5")}
            style={{
              transition: "transform 280ms cubic-bezier(0.77, 0, 0.175, 1), opacity 240ms ease",
              transform: gone ? `translateY(${mine ? 70 : -70}%) scale(0.3)` : "none",
              opacity: gone ? 0 : 1,
            }}
            aria-hidden={gone || undefined}
          >
            <span className="text-[10px] leading-none font-bold uppercase tracking-[0.18em] text-muted">
              {mine ? "You" : firstName(owner?.name ?? "")}
            </span>
            <PlayingCard
              card={current.card}
              size="xl"
              highlight={saved}
              className={cx(
                saved && "[outline-color:var(--color-card-chance)]",
                current.outcome === "bust" ? "animate-shake" : "animate-flip",
                current.outcome === "bust" && "ring-4 ring-busted",
                // fit the card (1.4em tall) to the card area, leaving room for the owner and "Saved!" labels
                saved ? "text-[length:clamp(40px,calc((100cqh_-_64px)_/_1.4),132px)]!" : "text-[length:clamp(40px,calc((100cqh_-_48px)_/_1.4),132px)]!",
              )}
            />
            {/* Bust is owned by the Celebration stamp; only a save needs words here. */}
            {saved && <span className="animate-pop font-display text-sm leading-none uppercase text-card-chance">Saved!</span>}
          </div>
        )}
      </div>

      {/* Fixed deck slot: only the narration pill changes width, so the deck never slides. */}
      <div className="grid w-full flex-none grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Deck count={game.deckCount} size="xs" />
        {narration}
      </div>
    </section>
  );
}
