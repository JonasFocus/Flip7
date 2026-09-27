"use client";

import type { CSSProperties } from "react";
import "@/components/table/moments/moments.css";
import { MicroLabel } from "@/components/lobby/Screens";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { success } from "@/lib/client/haptics";
import type { ImposterConnection } from "@/lib/client/types";
import { Footer, Status, hostName, nameOf } from "./Imposter";

const BIT_COLORS = [1, 3, 5, 7, 8, 9, 10, 12].map((v) => `var(--color-card-${v})`);

export function Reveal({ conn }: { conn: ImposterConnection }) {
  const result = conn.game.lastResult;
  const out = result?.votedOutId ?? null;
  return (
    <>
      <section className="m-rise flex flex-col items-center gap-3 pt-6 pb-8 text-center">
        <MicroLabel>Round {result?.round ?? conn.game.round} result</MicroLabel>
        <h1 className="font-display text-3xl leading-tight tracking-wide">
          {out ? `${nameOf(conn, out)} ${out === conn.you ? "were" : "was"} not the imposter` : "No majority — nobody is out"}
        </h1>
        <p className="text-sm text-muted">The imposter is still among you.</p>
      </section>
      {result && <Tally conn={conn} tally={result.tally} />}
      <Footer>
        {conn.isHost ? (
          <Button size="lg" block onClick={() => (success(), conn.send({ type: "nextRound" }))}>
            One more round
          </Button>
        ) : (
          <Status>Waiting for {hostName(conn)} to start the next round…</Status>
        )}
      </Footer>
    </>
  );
}

function Tally({ conn, tally }: { conn: ImposterConnection; tally: Record<string, number> }) {
  const rows = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return null;
  return (
    <section aria-label="Votes" className="flex flex-col gap-3">
      <MicroLabel>Votes</MicroLabel>
      {rows.map(([id, n]) => (
        <div key={id} className="flex items-center gap-3">
          <span className="w-24 truncate font-semibold">{nameOf(conn, id)}</span>
          <span className="h-8 flex-1 overflow-hidden rounded-lg bg-surface">
            <span className="m-bar block h-full rounded-lg bg-accent" style={{ width: `${(n / total) * 100}%` }} />
          </span>
          <span className="w-6 text-right font-display tabular-nums">{n}</span>
        </div>
      ))}
    </section>
  );
}

export function GameOver({ conn }: { conn: ImposterConnection }) {
  const { game } = conn;
  const faithful = game.winner === "faithful";
  const imposter = nameOf(conn, game.imposterId);
  return (
    <>
      {faithful && <Confetti />}
      <section className="m-rise relative flex flex-col items-center gap-4 pt-8 pb-8 text-center">
        <MicroLabel>Game over</MicroLabel>
        <h1
          className={cx(
            "font-display text-5xl leading-none tracking-tight",
            faithful ? "text-accent [text-shadow:0_4px_0_var(--color-accent-deep)]" : "text-danger [text-shadow:0_4px_0_var(--color-danger-deep)]",
          )}
        >
          {faithful ? "The faithful win" : "The imposter wins"}
        </h1>
        <div className="mt-4 w-full rounded-3xl border-2 border-line bg-surface p-5">
          <MicroLabel>The imposter was</MicroLabel>
          <p className="mt-1 font-display text-3xl tracking-wide">{imposter}</p>
          <MicroLabel className="mt-4">The word was</MicroLabel>
          <p className="mt-1 font-display text-3xl tracking-wide text-accent">{game.word ?? "?"}</p>
          {game.category && <p className="text-sm text-muted">{game.category}</p>}
        </div>
      </section>
      {game.lastResult && <Tally conn={conn} tally={game.lastResult.tally} />}
      <Footer>
        {conn.isHost ? (
          <Button size="lg" block onClick={() => (success(), conn.send({ type: "playAgain" }))}>
            Play again
          </Button>
        ) : (
          <Status>Waiting for {hostName(conn)} to play again…</Status>
        )}
        <Button variant="secondary" block onClick={conn.leave}>
          Home
        </Button>
      </Footer>
    </>
  );
}

function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none fixed top-[30%] left-1/2 z-20">
      {Array.from({ length: 40 }, (_, i) => {
        const style: CSSProperties & Record<`--${string}`, string> = {
          "--a": `${i * 9}deg`,
          "--d": `${160 + ((i * 41) % 6) * 40}px`,
          "--spin": `${(i % 2 ? 1 : -1) * (200 + i * 15)}deg`,
          "--c": BIT_COLORS[i % BIT_COLORS.length] ?? "var(--color-accent)",
          animationDelay: `${200 + (i % 5) * 40}ms`,
          animationDuration: "1600ms",
        };
        return <span key={i} className="m-bit" style={style} />;
      })}
    </div>
  );
}
