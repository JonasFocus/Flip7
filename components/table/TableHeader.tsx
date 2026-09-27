"use client";

import { useState } from "react";
import type { GameState, Intent } from "@/lib/engine/types";
import type { ConnectionStatus } from "@/lib/client/types";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { useOnline } from "@/lib/client/useRoom";

export function TableHeader({
  game,
  code,
  status,
  isHost,
  send,
  onScores,
  onLeave,
}: {
  game: GameState;
  code: string | null;
  status: ConnectionStatus;
  isHost: boolean;
  send: (intent: Intent) => void;
  onScores: () => void;
  onLeave: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "restart" | "endGame" | null>(null);
  const leader = Math.max(0, ...game.players.map((p) => p.total));
  const pct = Math.min(100, (leader / game.goal) * 100);
  const offline = status === "reconnecting" || status === "connecting";
  const online = useOnline();

  function close() {
    setMenu(false);
    setConfirm(null);
  }

  const hostAction = confirm === "restart" || confirm === "endGame" ? HOST_ACTIONS[confirm] : null;

  return (
    <header className="flex h-14 flex-none items-center gap-3 px-4">
      <h1 className="sr-only">Flip 7 · Round {game.round}</h1>
      <div className="flex flex-col leading-none">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">Round</span>
        <span className="font-display text-xl tabular-nums">{game.round}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
          <span>{offline ? <span className="text-busted">{online ? "Reconnecting…" : "Offline"}</span> : <>First to <span className="font-display tracking-normal text-fg">{game.goal}</span></>}</span>
          <span>
            Leader <span className="font-display text-xs tracking-normal tabular-nums text-fg">{leader}</span>
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label="Leader's progress to goal"
          aria-valuemin={0}
          aria-valuemax={game.goal}
          aria-valuenow={leader}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMenu(true)}
        aria-label="Menu"
        className="grid size-11 flex-none place-items-center rounded-xl bg-surface text-fg transition-transform active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden>
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      </button>

      <Sheet open={menu} onClose={close} title={hostAction ? hostAction.question : confirm === "leave" ? "Leave the game?" : "Menu"}>
        {hostAction ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted">{hostAction.warning}</p>
            <Button
              variant="danger"
              size="lg"
              block
              onClick={() => {
                close();
                send(hostAction.intent);
              }}
            >
              {hostAction.label}
            </Button>
            <Button variant="ghost" block onClick={() => setConfirm(null)}>
              Keep playing
            </Button>
          </div>
        ) : confirm === "leave" ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted">
              Your seat is given up and the table plays on without you.
            </p>
            <Button variant="danger" size="lg" block onClick={onLeave}>
              Leave
            </Button>
            <Button variant="ghost" block onClick={() => setConfirm(null)}>
              Stay at the table
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {code && (
              <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Room</span>
                <span className="font-display text-xl tracking-[0.2em] tabular-nums">{code}</span>
              </div>
            )}
            <Button
              variant="secondary"
              size="lg"
              block
              onClick={() => {
                close();
                onScores();
              }}
            >
              Scores
            </Button>
            {isHost &&
              (["restart", "endGame"] as const).map((key) => (
                <Button key={key} variant="secondary" size="lg" block onClick={() => setConfirm(key)}>
                  <span className="flex flex-col items-center gap-1 leading-none">
                    <span>{HOST_ACTIONS[key].label}</span>
                    <span className="font-sans text-xs font-bold tracking-normal text-muted normal-case">{HOST_ACTIONS[key].subtitle}</span>
                  </span>
                </Button>
              ))}
            <Button variant="ghost" block className="text-busted" onClick={() => setConfirm("leave")}>
              Leave game
            </Button>
          </div>
        )}
      </Sheet>
    </header>
  );
}

const HOST_ACTIONS = {
  restart: {
    label: "Restart game",
    subtitle: "Everyone back to 0, round 1",
    question: "Restart the game?",
    warning: "All scores reset to 0 and a fresh round 1 is dealt right away.",
    intent: { type: "restart" },
  },
  endGame: {
    label: "End game",
    subtitle: "Show final standings",
    question: "End the game?",
    warning: "The game ends on the current totals. This round is not scored.",
    intent: { type: "endGame" },
  },
} satisfies Record<string, { label: string; subtitle: string; question: string; warning: string; intent: Intent }>;
