"use client";

import { useEffect, useState, type ReactNode } from "react";
import "./hotpotato.css";
import { InviteHero } from "@/components/lobby/Lobby";
import { MicroLabel } from "@/components/lobby/Screens";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Toast } from "@/components/ui/Toast";
import { fail, success, tap } from "@/lib/client/haptics";
import {
  MAX_POTATO_PLAYERS,
  MIN_POTATO_PLAYERS,
  PASS_COOLDOWN_MS,
  POTATO_CATEGORIES,
  type PotatoConnection,
  type PotatoLives,
  type PotatoPlayer,
} from "@/lib/hotpotato";

const LIVES: PotatoLives[] = [1, 2, 3, 5];

export function HotPotato({ conn }: { conn: PotatoConnection }) {
  const [toast, setToast] = useState<string | null>(null);
  const { phase, round } = conn.game;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-safe-2 select-none">
      <Toast message={toast ?? conn.error} tone={toast ? "accent" : "danger"} onDismiss={() => setToast(null)} />
      <header className="flex items-center justify-between py-2">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={conn.leave}>
          <span aria-hidden>←</span> Leave
        </Button>
        <p className="rounded-full border border-line px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Hot Potato</p>
      </header>
      {phase === "lobby" && <Lobby conn={conn} onToast={setToast} />}
      {phase === "playing" && <Play key={round} conn={conn} />}
      {phase === "boom" && <Boom conn={conn} />}
      {phase === "gameOver" && <GameOver conn={conn} />}
    </main>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function nameOf(conn: PotatoConnection, id: string | null): string {
  if (id === conn.you) return "You";
  return conn.game.players.find((p) => p.id === id)?.name ?? "Someone";
}

const hostName = (conn: PotatoConnection) => conn.game.players.find((p) => p.id === conn.hostId)?.name ?? "the host";

function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-6 pb-safe-4">
      {children}
    </footer>
  );
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="min-h-5 text-center text-sm text-muted">
      {children}
    </p>
  );
}

function Hearts({ lives, max }: { lives: number; max: number }) {
  return (
    <span aria-label={`${lives} ${lives === 1 ? "life" : "lives"}`} className="flex gap-0.5 text-sm leading-none">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} aria-hidden className={cx(i >= lives && "opacity-25 grayscale")}>
          ❤️
        </span>
      ))}
    </span>
  );
}

function Lobby({ conn, onToast }: { conn: PotatoConnection; onToast: (m: string) => void }) {
  const { game, isHost } = conn;
  const [armedId, setArmedId] = useState<string | null>(null);

  useEffect(() => {
    if (!armedId) return;
    const t = setTimeout(() => setArmedId(null), 3000);
    return () => clearTimeout(t);
  }, [armedId]);

  const categoryName = POTATO_CATEGORIES.find((c) => c.id === game.categoryId)?.prompt ?? "Random every round";
  const missing = MIN_POTATO_PLAYERS - game.players.length;

  function remove(id: string) {
    tap();
    if (armedId !== id) return setArmedId(id);
    setArmedId(null);
    conn.removePlayer(id);
  }

  return (
    <>
      <section className="flex flex-col items-center gap-4 pt-4 pb-6">
        <InviteHero code={conn.code} onToast={onToast} />
      </section>

      <p className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
        A bomb with a <span className="font-semibold text-fg">secret fuse</span> goes around. When it&apos;s yours, shout a word that fits the
        category, then hit <span className="font-semibold text-fg">PASS</span>. Holding it when it blows costs a life. Last one standing wins.
      </p>

      <section aria-label="Settings" className="mt-6 flex flex-col gap-4">
        <div>
          <MicroLabel className="mb-2">Lives</MicroLabel>
          {isHost ? (
            <div className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-surface p-1">
              {LIVES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={game.startLives === n}
                  onClick={() => (tap(), conn.send({ type: "setLives", lives: n }))}
                  className={cx(
                    "min-h-11 rounded-xl font-display text-lg tracking-wide transition-colors duration-150",
                    game.startLives === n ? "bg-accent text-ink" : "text-muted active:bg-surface-2",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : (
            <Hearts lives={game.startLives} max={game.startLives} />
          )}
        </div>
        <div>
          <MicroLabel className="mb-2">Category</MicroLabel>
          {isHost ? (
            <div className="flex flex-wrap gap-2">
              {[{ id: "random", prompt: "Random every round" }, ...POTATO_CATEGORIES].map((c) => (
                <Chip key={c.id} selected={game.categoryId === c.id} onClick={() => conn.send({ type: "setCategory", categoryId: c.id })}>
                  {c.prompt}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="font-display text-lg tracking-wide">{categoryName}</p>
          )}
        </div>
      </section>

      <section aria-labelledby="hp-players" className="mt-6">
        <MicroLabel className="mb-2">
          <span id="hp-players">Players</span>{" "}
          <span className="tabular-nums">
            {game.players.length}/{MAX_POTATO_PLAYERS}
          </span>
        </MicroLabel>
        <ol className="flex flex-col gap-2">
          {game.players.map((p, seat) => (
            <li key={p.id} className="animate-pop">
              <span
                className={cx(
                  "flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-surface px-3",
                  p.id === conn.you ? "border-accent/60" : "border-line",
                )}
              >
                <PlayerAvatar player={p} seat={seat} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{p.name}</span>
                    {p.id === conn.hostId && <CrownIcon />}
                  </span>
                  <span className="block text-xs text-muted">
                    {[p.id === conn.you && "You", p.id === conn.hostId && "Host", !p.connected && "Offline"].filter(Boolean).join(" · ") ||
                      "Player"}
                  </span>
                </span>
                {isHost && p.id !== conn.you && (
                  <button
                    type="button"
                    aria-label={armedId === p.id ? `Confirm remove ${p.name}` : `Remove ${p.name}`}
                    onClick={() => remove(p.id)}
                    className={cx(
                      "-mr-1 grid h-11 min-w-11 place-items-center rounded-xl transition-colors",
                      armedId === p.id
                        ? "bg-danger px-3 text-xs font-bold uppercase tracking-[0.14em] text-ink"
                        : "text-xl text-muted active:bg-surface-2 active:text-danger",
                    )}
                  >
                    {armedId === p.id ? "Remove?" : "×"}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Footer>
        {isHost ? (
          <>
            <Status>{missing > 0 ? `Need ${missing} more ${missing === 1 ? "player" : "players"} to start` : "Light the fuse!"}</Status>
            <Button size="lg" block disabled={missing > 0} onClick={() => (success(), conn.send({ type: "start" }))}>
              Start game
            </Button>
          </>
        ) : (
          <Status>Waiting for {hostName(conn)} to start…</Status>
        )}
      </Footer>
    </>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => (tap(), onClick())}
      className={cx(
        "min-h-11 rounded-full border-2 px-4 text-sm font-semibold transition-colors duration-150",
        selected ? "border-accent bg-accent text-ink" : "border-line bg-surface text-fg active:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function PlayerAvatar({ player, seat }: { player: PotatoPlayer; seat: number }) {
  return (
    <span className="relative">
      <Avatar id={player.id} seat={seat} name={player.name} />
      <span
        aria-hidden
        className={cx("absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface", player.connected ? "bg-active" : "bg-muted/60")}
      />
    </span>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 flex-none text-accent" fill="currentColor" role="img" aria-label="Host">
      <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5L3 8.5Z" />
    </svg>
  );
}

function Players({ conn }: { conn: PotatoConnection }) {
  const { game } = conn;
  return (
    <ul aria-label="Players" className="grid grid-cols-2 gap-2">
      {game.players.map((p, seat) => {
        const holding = p.id === game.holderId;
        return (
          <li
            key={p.id}
            className={cx(
              "flex min-h-14 items-center gap-2 rounded-2xl border-2 bg-surface px-2 transition-colors",
              holding ? "border-danger" : p.id === conn.you ? "border-accent/60" : "border-line",
              p.lives === 0 && "opacity-40 grayscale",
            )}
          >
            <PlayerAvatar player={p} seat={seat} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-sm font-semibold">{p.id === conn.you ? "You" : p.name}</span>
                {holding && <span aria-label="has the bomb">💣</span>}
              </span>
              {p.lives > 0 ? <Hearts lives={p.lives} max={game.startLives} /> : <span className="text-xs font-bold text-danger uppercase">Out</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function heatOf(elapsedMs: number): number {
  return elapsedMs < 8000 ? 0 : elapsedMs < 16_000 ? 1 : elapsedMs < 26_000 ? 2 : 3;
}

function Bomb({ heat, size = "size-44" }: { heat: number; size?: string }) {
  return (
    <div aria-hidden className={cx("hp-shake relative grid place-items-center", size)} data-heat={heat}>
      <div className="hp-pulse relative size-full">
        <div className="absolute inset-[8%] rounded-full bg-ink shadow-[inset_-14px_-18px_0_oklch(0_0_0/0.35),0_0_60px_-6px_var(--color-danger)] ring-4 ring-line" />
        <div className="absolute top-[14%] left-[28%] size-[16%] rounded-full bg-fg/25" />
        <div className="absolute -top-[2%] right-[18%] h-[18%] w-[14%] rotate-[35deg] rounded-sm bg-line" />
        <div className="absolute -top-[14%] right-[4%] h-[18%] w-[4%] rotate-[35deg] rounded-full bg-accent-deep" />
        <div className="hp-spark absolute -top-[22%] right-[-4%] text-3xl">✨</div>
      </div>
    </div>
  );
}

function Play({ conn }: { conn: PotatoConnection }) {
  const { game } = conn;
  const [roundStart] = useState(() => Date.now());
  const now = useNow(500);
  const heat = heatOf(now - roundStart);
  const mine = game.holderId === conn.you;
  const meOut = (game.players.find((p) => p.id === conn.you)?.lives ?? 0) === 0;

  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-2 text-center">
        <MicroLabel>Round {game.round}</MicroLabel>
        <h1 className="font-display text-3xl leading-tight tracking-wide text-accent text-balance">{game.category}</h1>
      </section>
      <section className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
        <Bomb heat={heat} />
        <p aria-live="polite" className="font-display text-2xl tracking-wide">
          {nameOf(conn, game.holderId)} {mine ? "have" : "has"} it!
        </p>
        {meOut && <p className="text-sm text-muted">You&apos;re out. Enjoy the chaos.</p>}
      </section>
      <div className="pb-safe-4">
        <Players conn={conn} />
      </div>
      {mine && <Urgent key={game.heldSince} conn={conn} heat={heat} />}
    </>
  );
}

function Urgent({ conn, heat }: { conn: PotatoConnection; heat: number }) {
  const [ready, setReady] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fail();
    const t = setTimeout(() => setReady(true), PASS_COOLDOWN_MS);
    return () => clearTimeout(t);
  }, []);

  function pass() {
    success();
    setSent(true);
    conn.send({ type: "pass" });
    // Still mounted after this means the pass didn't land (dropped or rejected); let them retry.
    setTimeout(() => setSent(false), 1500);
  }

  return (
    <div role="alertdialog" aria-label="You have the bomb" className="hp-urgent fixed inset-0 z-30 flex flex-col items-center bg-danger-deep px-4 pt-safe-6 pb-safe-6">
      <p className="text-center font-display text-lg tracking-wide text-fg/80 text-balance">{conn.game.category}</p>
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <Bomb heat={Math.max(heat, 1)} size="size-36" />
        <h2 className="font-display text-5xl leading-none tracking-tight text-fg [text-shadow:0_4px_0_oklch(0_0_0/0.35)]">YOU HAVE IT!</h2>
        <p className="text-center text-fg/80">Shout a word, then pass!</p>
      </div>
      <Button size="lg" block disabled={!ready || sent} onClick={pass} className="min-h-28! text-5xl!">
        {sent ? "Passing…" : "Pass"}
      </Button>
    </div>
  );
}

function Countdown({ at }: { at: number | undefined }) {
  const now = useNow(250);
  if (at === undefined) return null;
  const secs = Math.max(0, Math.ceil((at - now) / 1000));
  return <Status>{secs > 0 ? `Next round in ${secs}…` : "Here it comes…"}</Status>;
}

function Boom({ conn }: { conn: PotatoConnection }) {
  const { game } = conn;
  const loser = game.players.find((p) => p.id === game.lastBoom?.playerId);
  const you = loser?.id === conn.you;
  useEffect(() => {
    if (you) fail();
  }, [you]);

  return (
    <>
      <div aria-hidden className="hp-flash pointer-events-none fixed inset-0 z-30 bg-accent" />
      <section className="animate-pop flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
        <p aria-hidden className="text-8xl">💥</p>
        <h1 className="font-display text-4xl leading-tight tracking-wide text-danger [text-shadow:0_4px_0_var(--color-danger-deep)]">
          {you ? "You blew up!" : `${loser?.name ?? "Someone"} blew up!`}
        </h1>
        {game.lastBoom && <p className="text-sm text-muted">on “{game.lastBoom.category}”</p>}
        {loser && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <Hearts lives={loser.lives} max={game.startLives} />
            <p className="font-display tracking-wide">
              {loser.lives === 0 ? "OUT!" : `${loser.lives} ${loser.lives === 1 ? "life" : "lives"} left`}
            </p>
          </div>
        )}
      </section>
      <div className="flex flex-col gap-4 pb-safe-4">
        <Countdown at={conn.deadlineAt} />
        <Players conn={conn} />
      </div>
    </>
  );
}

function GameOver({ conn }: { conn: PotatoConnection }) {
  const { game } = conn;
  const winner = game.players.find((p) => p.id === game.winnerId);
  return (
    <>
      <section className="animate-pop flex flex-col items-center gap-4 pt-8 pb-8 text-center">
        <MicroLabel>Game over</MicroLabel>
        <p aria-hidden className="text-7xl">🏆</p>
        <h1 className="font-display text-5xl leading-none tracking-tight text-accent [text-shadow:0_4px_0_var(--color-accent-deep)]">
          {winner ? (winner.id === conn.you ? "You win!" : `${winner.name} wins!`) : "Nobody survived"}
        </h1>
        {winner && <p className="text-sm text-muted">Last one standing</p>}
        {game.lastBoom && (
          <p className="text-sm text-muted">
            💥 {nameOf(conn, game.lastBoom.playerId)} blew up on “{game.lastBoom.category}”
          </p>
        )}
      </section>
      <Players conn={conn} />
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
