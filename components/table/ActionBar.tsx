import type { GameState, Intent, Player } from "@/lib/engine/types";
import { tap } from "@/lib/client/haptics";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { firstName, roundScore } from "./hand";

function Waiting({ player, text }: { player?: Player; text: string }) {
  return (
    <div className="flex min-h-16 items-center justify-center gap-3 rounded-2xl border border-dashed border-line px-4 text-muted">
      {player && <Avatar id={player.id} name={player.name} isBot={player.isBot} size="sm" />}
      <span className="truncate font-semibold">{text}</span>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </span>
    </div>
  );
}

export function ActionBar({
  game,
  you,
  awaitingId,
  send,
}: {
  game: GameState;
  you: string;
  awaitingId: string | null;
  send: (intent: Intent) => void;
}) {
  const me = game.players.find((p) => p.id === you);
  const pending = game.pending;
  const hit = () => {
    tap();
    send({ type: "hit" });
  };

  // RoundSummary / GameOver overlays own the host's continue buttons.
  if (game.phase !== "playing") return <Waiting text={game.phase === "gameOver" ? "Game over" : "Round over"} />;

  if (awaitingId === you && me) {
    if (pending?.type === "flipThree") {
      return (
        <Button size="lg" block onClick={hit} className="animate-pop">
          Flip · {pending.remaining} left
        </Button>
      );
    }
    if (pending?.type === "chooseTarget") return <Waiting text="Pick a target" />;
    const points = roundScore(me).total;
    return (
      <div className="flex gap-3">
        <Button size="lg" onClick={hit} className="flex-[1.4] text-2xl">
          Hit
        </Button>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => {
            tap();
            send({ type: "stay" });
          }}
          className="flex-1"
        >
          <span className="flex flex-col items-center gap-1 leading-none">
            <span className="text-xl">Stay</span>
            <span className="font-sans text-xs font-bold tracking-normal text-muted normal-case tabular-nums">+{points} pts</span>
          </span>
        </Button>
      </div>
    );
  }

  const who = game.players.find((p) => p.id === awaitingId);
  if (!who) return <Waiting text={game.dealing ? "Dealing" : "Waiting"} />;
  const name = firstName(who.name);
  const text =
    pending?.type === "chooseTarget"
      ? `${name} is picking a target`
      : pending?.type === "flipThree"
        ? `${name} is flipping three`
        : `${name} is deciding`;
  return <Waiting player={who} text={text} />;
}
