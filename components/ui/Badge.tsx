import type { ReactNode } from "react";
import type { PlayerStatus } from "@/lib/engine/types";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "accent" | "chance" | Exclude<PlayerStatus, "waiting">;

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent text-ink",
  chance: "bg-card-chance/15 text-card-chance",
  active: "bg-active/15 text-active",
  stayed: "bg-stayed/15 text-stayed",
  frozen: "bg-frozen/15 text-frozen",
  busted: "bg-busted/15 text-busted",
  flip7: "bg-flip7 text-ink",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-bold uppercase leading-none tracking-[0.12em] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS: Record<PlayerStatus, { tone: BadgeTone; label: string }> = {
  waiting: { tone: "neutral", label: "Waiting" },
  active: { tone: "active", label: "In" },
  stayed: { tone: "stayed", label: "Stayed" },
  frozen: { tone: "frozen", label: "Frozen" },
  busted: { tone: "busted", label: "Bust" },
  flip7: { tone: "flip7", label: "Flip 7" },
};

export function StatusBadge({ status, className }: { status: PlayerStatus; className?: string }) {
  const { tone, label } = STATUS[status];
  return (
    <Badge tone={tone} className={className}>
      {label}
    </Badge>
  );
}
