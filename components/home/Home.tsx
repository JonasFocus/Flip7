"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Card } from "@/lib/engine/types";
import { createRoom } from "@/lib/client/rooms";
import { getSavedName, saveName } from "@/lib/client/identity";
import { fail, tap } from "@/lib/client/haptics";
import { PlayingCard } from "@/components/cards/PlayingCard";
import { BotIcon } from "@/components/cards/icons";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { JoinCode } from "./JoinCode";
import { OpenTables } from "./OpenTables";
import { HowToPlay } from "./HowToPlay";

type Mode = "online" | "bots" | "physical";

const LABEL = "text-[11px] font-bold uppercase tracking-[0.2em] text-muted";

const MODES: { id: Mode; title: string; blurb: string; cta: string; icon: ReactNode }[] = [
  { id: "online", title: "Play online", blurb: "One phone each, with family", cta: "Create table", icon: <PeopleIcon /> },
  { id: "bots", title: "Play vs bots", blurb: "Solo, right on this phone", cta: "Deal me in", icon: <BotIcon className="size-6" /> },
  { id: "physical", title: "Scorekeeper", blurb: "Real cards, we do the math", cta: "Start scoring", icon: <TallyIcon /> },
];

const noopSubscribe = () => () => {};

const HERO_CARD: Card = { id: "hero-7", kind: "number", value: 7 };

export function Home({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const savedName = useSyncExternalStore(noopSubscribe, getSavedName, () => "");
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
    if (mode === "bots") {
      router.push("/solo");
      return;
    }
    setBusy(true);
    try {
      const code = await createRoom(mode === "online" ? "virtual" : "physical", trimmed);
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
        <div className="flex flex-col gap-6 pt-safe-6 [@media(max-height:500px)]:gap-4 [@media(max-height:500px)]:pt-safe-4">
          <header className="flex items-center justify-between">
            <h1 className="flex items-center gap-2" aria-label="Flip 7">
              <span className="font-display text-[56px] leading-none tracking-tight text-fg [text-shadow:0_4px_0_var(--color-ink)]">
                FLIP
              </span>
              <PlayingCard card={HERO_CARD} size="md" className="animate-deal rotate-[-8deg]" />
            </h1>
            <p className={cx(LABEL, "text-right leading-relaxed")}>
              Family
              <br />
              game night
            </p>
          </header>

          <label className="flex flex-col gap-2">
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
                "h-14 rounded-2xl border-2 border-line bg-surface px-4 text-lg font-semibold text-fg placeholder:text-muted/50 focus:border-accent focus:outline-none transition-colors duration-150",
                shaking && "animate-shake", nameMissing && "border-danger",
              )}
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className={cx(LABEL, "mb-2")}>Choose a game</legend>
            {MODES.map((m) => (
              <label
                key={m.id}
                className="flex min-h-[72px] [@media(max-height:500px)]:min-h-14 [@media(max-height:500px)]:py-2 items-center gap-4 rounded-2xl border-2 border-line bg-surface px-4 py-3 transition-[transform,border-color,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.98] has-[:checked]:border-accent has-[:checked]:bg-surface-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.id}
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                  className="peer sr-only"
                />
                <span className="grid size-11 flex-none place-items-center rounded-xl bg-bg text-muted transition-colors duration-150 peer-checked:bg-accent peer-checked:text-ink">
                  {m.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg leading-tight tracking-wide">{m.title}</span>
                  <span className="block text-sm text-muted [@media(max-height:500px)]:hidden">{m.blurb}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-bg from-70% to-transparent px-4 pt-4 pb-safe-4">
            <Button size="lg" block loading={busy} onClick={start}>
              {cta}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-8 pt-4 pb-safe-8 landscape:pt-safe-6">
          <JoinCode initialCode={initialCode} onJoin={join} />
          <OpenTables onJoin={join} />
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

function TallyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden className="size-6">
      <path d="M5 5v14M9.5 5v14M14 5v14M18.5 5v14M3 16 21 8" />
    </svg>
  );
}
