import type { ReactNode } from "react";
import type { GameState } from "@/lib/engine/types";
import { Deck, PlayingCard } from "@/components/cards/PlayingCard";
import { cx } from "@/components/ui/cx";
import { firstName } from "./hand";
import type { Reveal } from "./useReveal";

function Prompt({ game, you, awaitingId }: { game: GameState; you: string; awaitingId: string | null }) {
  const pending = game.pending;
  const who = game.players.find((p) => p.id === awaitingId);
  let big: string;
  let small: string | null = null;
  let mine = false;

  if (game.phase === "roundOver") big = "Round over";
  else if (game.phase === "gameOver") big = "Game over";
  else if (!who) big = game.dealing ? "Dealing" : "…";
  else if (who.id === you) {
    mine = true;
    if (pending?.type === "flipThree") [big, small] = ["Flip three", `${pending.remaining} to go`];
    else if (pending?.type === "chooseTarget") [big, small] = ["Pick a target", null];
    else [big, small] = ["Your turn", "Hit or stay"];
  } else {
    big = firstName(who.name);
    small = pending?.type === "flipThree" ? `flipping three · ${pending.remaining} to go` : pending ? "is choosing" : "is up";
  }

  return (
    <div key={`${big}-${small}`} className="animate-pop flex flex-col items-center gap-1 text-center" aria-live="polite">
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
  current,
  leaving,
  narration,
}: {
  game: GameState;
  you: string;
  awaitingId: string | null;
  current: Reveal | null;
  leaving: boolean;
  narration: ReactNode;
}) {
  const owner = current ? game.players.find((p) => p.id === current.playerId) : undefined;
  const mine = current?.playerId === you;
  const showCard = current !== null && !leaving;

  return (
    <section aria-label="Table" className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-2 [container-type:size]">
      <Deck count={game.deckCount} size="sm" className="absolute top-2 left-4 opacity-80" />

      <div className="grid min-h-0 place-items-center [grid-template-areas:'stage']">
        {!showCard && (
          <div className="[grid-area:stage]">
            <Prompt game={game} you={you} awaitingId={awaitingId} />
          </div>
        )}
        {current && (
          <div
            key={current.key}
            className="flex flex-col items-center gap-2 [grid-area:stage] motion-reduce:!transform-none"
            style={{
              transition: "transform 280ms cubic-bezier(0.77, 0, 0.175, 1), opacity 240ms ease",
              transform: leaving ? `translateY(${mine ? 70 : -70}%) scale(0.3)` : "none",
              opacity: leaving ? 0 : 1,
            }}
            aria-hidden={leaving || undefined}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              {mine ? "You" : firstName(owner?.name ?? "")}
            </span>
            <PlayingCard
              card={current.card}
              size="xl"
              highlight={current.outcome === "saved"}
              className={cx(
                current.outcome === "bust" ? "animate-shake" : "animate-flip",
                current.outcome === "bust" && "ring-4 ring-busted",
                // fit the card to whatever height the stage has left
                "text-[length:clamp(56px,calc((100cqh_-_104px)_/_1.4),132px)]!",
              )}
            />
            {current.outcome !== "ok" && (
              <span className={cx("animate-pop font-display text-sm uppercase", current.outcome === "bust" ? "text-busted" : "text-card-chance")}>
                {current.outcome === "bust" ? "Bust!" : "Saved!"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="min-h-6 w-full">{narration}</div>
    </section>
  );
}
