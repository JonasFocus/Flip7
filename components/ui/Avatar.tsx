import { BotIcon } from "@/components/cards/icons";
import { cx } from "./cx";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-lg",
};

// Number-card hues ~45° apart so two players never land on neighbouring pinks.
const HUES = [1, 3, 5, 7, 9, 11, 4, 12];

// Seat order gives the first 8 players distinct colours; the id hash is only a fallback.
function hueVar(id: string, seat: number | undefined): string {
  let h = 0;
  if (seat !== undefined && seat >= 0) h = seat;
  else for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `var(--color-card-${HUES[h % HUES.length]})`;
}

export function Avatar({
  id,
  seat,
  name,
  isBot = false,
  size = "md",
  className,
}: {
  id: string;
  /** Index in the table's player list; keeps colours distinct and stable for the whole game. */
  seat?: number;
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
      style={{ backgroundColor: hueVar(id, seat), boxShadow: "inset 0 -2px 0 oklch(0 0 0 / 0.18)" }}
    >
      <span className={cx(isBot && "pr-[6%] pb-[4%]")}>{initial}</span>
      {isBot && (
        <span className="absolute -right-1.5 -bottom-1.5 grid size-[42%] place-items-center rounded-full bg-ink text-fg ring-[1.5px] ring-bg">
          <BotIcon className="size-[75%]" strokeWidth={2.8} />
        </span>
      )}
    </span>
  );
}
