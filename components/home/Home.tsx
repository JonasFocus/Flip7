"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@/lib/engine/types";
import { createRoom, roomCodeFrom } from "@/lib/client/rooms";
import { getLastRoom, getSavedName, saveName } from "@/lib/client/identity";
import { fail, tap } from "@/lib/client/haptics";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { JoinCode } from "./JoinCode";
import { MODE_LABEL, OpenTables, useOpenRooms } from "./OpenTables";
import { HowToPlay } from "./HowToPlay";

type Mode = "online" | "imposter" | "liarsdice" | "hotpotato" | "spyfall" | "blackjack" | "baccarat" | "roulette" | "texasholdem";

const LABEL = "text-[11px] font-bold uppercase tracking-[0.2em] text-muted";

// Archived from the picker (rooms/logic intact): liarsdice, hotpotato, spyfall.
const MODES: { id: Mode; title: string; blurb: string; cta: string; icon: ReactNode }[] = [
  { id: "online", title: "Flip 7", blurb: "One phone each, with family", cta: "Create table", icon: <PeopleIcon /> },
  { id: "imposter", title: "Imposter", blurb: "Find the faker · 3–10 players", cta: "Create room", icon: <MaskIcon /> },
  { id: "blackjack", title: "Blackjack", blurb: "Beat the dealer · 5 seats", cta: "Open table", icon: <ChipIcon /> },
  { id: "baccarat", title: "Baccarat", blurb: "Punto banco · 5 seats", cta: "Open table", icon: <BaccaratIcon /> },
  { id: "roulette", title: "Roulette", blurb: "Spin the wheel · 8 seats", cta: "Open table", icon: <RouletteIcon /> },
  { id: "texasholdem", title: "Texas Hold'em", blurb: "No-limit · 2–8 seats", cta: "Open table", icon: <HoldemIcon /> },
];

const ROOM_MODE = { online: "virtual", imposter: "imposter", liarsdice: "liarsdice", hotpotato: "hotpotato", spyfall: "spyfall", blackjack: "blackjack", baccarat: "baccarat", roulette: "roulette", texasholdem: "texasholdem" } as const;

const noopSubscribe = () => () => {};

const HERO_CARD: Card = { id: "hero-7", kind: "number", value: 7 };

const urlCode = () => roomCodeFrom(new URLSearchParams(location.search).get("code") ?? "");
const serverEmpty = () => "";

export function Home() {
  const router = useRouter();
  const savedName = useSyncExternalStore(noopSubscribe, getSavedName, serverEmpty);
  const initialCode = useSyncExternalStore(noopSubscribe, urlCode, serverEmpty);
  const lastRoom = useSyncExternalStore(noopSubscribe, getLastRoom, serverEmpty);
  const openRooms = useOpenRooms();
  const myTable = lastRoom ? openRooms.rooms?.find((r) => r.code === lastRoom) : undefined;
  // A prefilled code that isn't a live room came back from "Try another code": put the cursor on it to fix a digit.
  const deadCode = initialCode.length === 6 && !!openRooms.rooms && !openRooms.rooms.some((r) => r.code === initialCode);
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? savedName;
  const [mode, setMode] = useState<Mode>("online");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  const [nameMissing, setNameMissing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const cta = MODES.find((m) => m.id === mode)?.cta ?? "Play";

  function requireName(): boolean {
    if (trimmed) {
      saveName(trimmed);
      return true;
    }
    fail();
    setShaking(true);
    setNameMissing(true);
    nameRef.current?.focus({ preventScroll: true });
    nameRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
  }

  async function start() {
    if (busy || !requireName()) return;
    tap();
    setBusy(true);
    try {
      const code = await createRoom(ROOM_MODE[mode], trimmed);
      router.push(`/room/${code}`);
    } catch (e) {
      fail();
      setToast(e instanceof Error ? e.message : "Could not create the table");
      setBusy(false);
    }
  }

  function join(code: string) {
    if (trimmed) saveName(trimmed);
    tap();
    router.push(`/room/${code}`);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-safe landscape:max-w-4xl">
      <Toast message={toast} tone="danger" onDismiss={() => setToast(null)} />

      <div className="grid flex-1 gap-x-10 px-4 landscape:grid-cols-2">
        <div className="flex flex-col gap-6 pt-safe-6 [@media(max-height:500px)]:gap-3 [@media(max-height:500px)]:pt-safe-4">
          <header className="flex items-center justify-between">
            <h1 className="flex items-center gap-2" aria-label="Flip 7">
              <span className="font-display text-[56px] leading-none tracking-tight text-fg [@media(max-height:500px)]:text-[36px] [text-shadow:0_4px_0_var(--color-ink)]">
                FLIP
              </span>
              <PlayingCard card={HERO_CARD} size="md" className="animate-hero origin-bottom rotate-[-8deg] [@media(max-height:500px)]:text-[40px]" />
            </h1>
            <p className={cx(LABEL, "text-right leading-relaxed [@media(max-height:500px)]:hidden")}>
              Family
              <br />
              game night
            </p>
          </header>

          <label className="flex flex-col gap-2 [@media(max-height:500px)]:gap-1.5">
            <span className={cx(LABEL, nameMissing && "text-danger")}>
              {nameMissing ? "Enter your name to play" : "Your name"}
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameMissing(false);
              }}
              onAnimationEnd={() => setShaking(false)}
              maxLength={20}
              autoComplete="nickname"
              autoCapitalize="words"
              enterKeyHint="done"
              placeholder="e.g. Mom"
              className={cx(
                "h-14 [@media(max-height:500px)]:h-12 rounded-2xl border-2 border-line bg-surface px-4 text-lg font-semibold text-fg placeholder:text-muted/80 focus:border-accent focus:outline-none transition-colors duration-150",
                shaking && "animate-shake", nameMissing && "border-danger",
              )}
            />
          </label>

          {myTable && (
            <button
              type="button"
              onClick={() => join(myTable.code)}
              className="press flex min-h-[72px] w-full items-center gap-4 rounded-2xl border border-accent/60 bg-surface px-4 py-3 text-left [--press-shadow:var(--color-accent-deep)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg leading-tight tracking-wide text-accent">Back to your table</span>
                <span className="block truncate text-sm font-semibold text-muted">
                  {myTable.hostName}&rsquo;s table · {MODE_LABEL[myTable.mode]}
                </span>
              </span>
              <span className="font-display text-xl tabular-nums tracking-wider text-fg">{myTable.code}</span>
            </button>
          )}

          <fieldset className="grid grid-cols-2 gap-2 [@media(max-height:500px)]:grid-cols-3">
            <legend className={cx(LABEL, "col-span-full mb-2 [@media(max-height:500px)]:mb-1.5")}>Choose a game</legend>
            {MODES.map((m) => (
              <label
                key={m.id}
                className="flex min-h-[116px] flex-col items-start gap-2 rounded-2xl border-2 border-line bg-surface p-3 transition-[transform,border-color,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] has-[:checked]:border-accent has-[:checked]:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent [@media(max-height:500px)]:min-h-12 [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:items-center [@media(max-height:500px)]:px-2 [@media(max-height:500px)]:py-1.5"
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.id}
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                  className="peer sr-only"
                />
                <span className="grid size-10 [@media(max-height:500px)]:size-8 flex-none place-items-center rounded-xl bg-bg text-muted transition-colors duration-150 peer-checked:bg-accent peer-checked:text-ink">
                  {m.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-base leading-tight tracking-wide [@media(max-height:500px)]:text-xs">{m.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted [@media(max-height:500px)]:hidden">{m.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-4 pb-safe-4 [@media(max-height:500px)]:pt-2">
            <Button size="lg" block loading={busy} onClick={start}>
              {cta}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-8 pt-4 pb-safe-8 landscape:pt-safe-6">
          <JoinCode key={initialCode} initialCode={initialCode} focusOnMount={deadCode} onJoin={join} />
          <OpenTables load={openRooms} exclude={myTable?.code ?? ""} onJoin={join} />
          <HowToPlay />
        </div>
      </div>
    </main>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-6">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.6.7 2.6 2.2 3 4.7" />
    </svg>
  );
}

function MaskIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-6">
      <path d="M3 7c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v4c0 4.5-3.5 8-9 8s-9-3.5-9-8V7Z" />
      <path d="M7 11.5c.8-.6 1.8-.6 2.6 0M14.4 11.5c.8-.6 1.8-.6 2.6 0M9.5 15.5c1.5.8 3.5.8 5 0" />
    </svg>
  );
}

function BaccaratIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-6">
      <rect x="3" y="5.5" width="10" height="14" rx="2" transform="rotate(-10 8 12.5)" />
      <rect x="11" y="4.5" width="10" height="14" rx="2" transform="rotate(10 16 11.5)" />
    </svg>
  );
}

function RouletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-6">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    </svg>
  );
}

function HoldemIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-6">
      <path d="M12 3c2.6 3.4 7 5.6 7 9.4a3.8 3.8 0 0 1-6.2 2.9c.2 1.6.8 2.8 1.7 3.7h-5c.9-.9 1.5-2.1 1.7-3.7A3.8 3.8 0 0 1 5 12.4C5 8.6 9.4 6.4 12 3Z" />
    </svg>
  );
}

function ChipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden className="size-6">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
    </svg>
  );
}
