"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { getSavedName, saveName } from "@/lib/client/identity";
import { useOnline } from "@/lib/client/useRoom";

const noopSubscribe = () => () => {};

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-safe-4 pb-safe-4 select-none">{children}</main>
  );
}

export function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11px] font-bold uppercase tracking-[0.2em] text-muted ${className ?? ""}`}>{children}</p>;
}

// Renders children once a name is known; asks for one inline otherwise.
export function NameGate({ children, context }: { children: (name: string) => ReactNode; context?: string }) {
  const router = useRouter();
  const saved = useSyncExternalStore(noopSubscribe, getSavedName, () => null);
  const [typed, setTyped] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const name = typed ?? saved;

  if (name === null) return <LoadingScreen />;
  if (name) return children(name);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = draft.trim().slice(0, 20);
    if (!clean) return;
    saveName(clean);
    setTyped(clean);
  }

  return (
    <Shell>
      <form onSubmit={submit} className="my-auto flex flex-col gap-6 animate-pop">
        <div>
          <MicroLabel>{context ?? "Player 1, ready?"}</MicroLabel>
          <h1 className="mt-2 font-display text-4xl uppercase leading-none">Who&apos;s playing?</h1>
        </div>
        <label className="sr-only" htmlFor="name">
          Your name
        </label>
        <input
          id="name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={20}
          autoFocus
          autoComplete="nickname"
          enterKeyHint="go"
          placeholder="Your name"
          className="h-16 w-full rounded-2xl border-2 border-line bg-surface px-5 font-display text-2xl tracking-wide text-fg placeholder:text-muted/80 focus:border-accent focus:outline-none select-text"
        />
        <Button type="submit" size="lg" block disabled={!draft.trim()}>
          Let&apos;s go
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.replace("/")}>
          Back home
        </Button>
      </form>
    </Shell>
  );
}

// `hint`: we keep failing to connect; say why and offer a way out while retries continue.
export function LoadingScreen({ hint }: { hint?: string }) {
  const router = useRouter();
  return (
    <Shell>
      <div aria-busy className="flex flex-1 flex-col gap-8 pt-14" aria-label="Connecting">
        <div className="flex justify-center gap-1.5 max-[359px]:gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="h-16 w-12 rounded-xl bg-surface max-[359px]:h-14 max-[359px]:w-10 motion-safe:animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className="h-16 rounded-2xl bg-surface/70 motion-safe:animate-pulse" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
        {hint ? (
          <p role="status" className="text-center text-sm text-muted">
            {hint}
          </p>
        ) : (
          <MicroLabel className="text-center">Connecting…</MicroLabel>
        )}
      </div>
      {hint && (
        <Button variant="ghost" size="lg" block onClick={() => router.replace("/")}>
          Back home
        </Button>
      )}
    </Shell>
  );
}

export function NoticeScreen({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  const router = useRouter();
  return (
    <Shell>
      <div className="my-auto flex flex-col items-center gap-4 text-center animate-pop">
        <p aria-hidden className="font-display text-7xl text-accent [text-shadow:0_5px_0_var(--color-accent-deep)]">
          ?!
        </p>
        <h1 className="font-display text-3xl uppercase leading-tight">{title}</h1>
        <p className="max-w-xs text-muted">{message}</p>
      </div>
      <div className="flex flex-col gap-3">
        {action && (
          <Button size="lg" block onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        <Button variant={action ? "ghost" : undefined} size="lg" block onClick={() => router.replace("/")}>
          Back home
        </Button>
      </div>
    </Shell>
  );
}

export function ReconnectBanner() {
  const online = useOnline();
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-safe-2">
      <p className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-accent shadow-hard">
        <span className="size-2 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden />
        {online ? "Reconnecting" : "Offline"}
      </p>
    </div>
  );
}
