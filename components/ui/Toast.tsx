"use client";

import { useEffect } from "react";
import { cx } from "./cx";

type Tone = "neutral" | "accent" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg border border-line",
  accent: "bg-accent text-ink",
  danger: "bg-danger text-ink",
};

// Controlled: render with a message, it calls onDismiss after `duration` ms.
export function Toast({
  message,
  tone = "neutral",
  duration = 2600,
  onDismiss,
}: {
  message: string | null;
  tone?: Tone;
  duration?: number;
  onDismiss?: () => void;
}) {
  useEffect(() => {
    if (!message || !onDismiss) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-safe-3">
      {message && (
        <div
          key={message}
          className={cx(
            "toast max-w-full rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-hard",
            TONE[tone],
          )}
        >
          {message}
        </div>
      )}
    </div>
  );
}
