import { BotIcon } from "@/components/cards/icons";
import { cx } from "./cx";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-lg",
};

// Uses the number-card hues so players share the deck's palette.
function hueVar(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `var(--color-card-${(h % 12) + 1})`;
}

export function Avatar({
  id,
  name,
  isBot = false,
  size = "md",
  className,
}: {
  id: string;
  name: string;
  isBot?: boolean;
  size?: Size;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cx("relative inline-grid flex-none place-items-center rounded-full font-display text-ink", SIZE[size], className)}
      style={{ backgroundColor: hueVar(id), boxShadow: "inset 0 -2px 0 oklch(0 0 0 / 0.18)" }}
    >
      {initial}
      {isBot && (
        <span className="absolute -right-1 -bottom-1 grid size-[55%] place-items-center rounded-full bg-ink text-fg ring-2 ring-bg">
          <BotIcon className="size-[75%]" strokeWidth={2.8} />
        </span>
      )}
    </span>
  );
}
