import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "press bg-accent text-ink [--press-shadow:var(--color-accent-deep)]",
  secondary: "press bg-surface-2 text-fg border border-line [--press-shadow:oklch(0.1_0.02_275)]",
  ghost: "bg-transparent text-fg hover:bg-surface-2 active:bg-surface-2 transition-colors",
  danger: "press bg-danger text-ink [--press-shadow:var(--color-danger-deep)]",
};

const SIZE: Record<Size, string> = {
  sm: "min-h-11 px-4 text-sm rounded-xl",
  md: "min-h-12 px-5 text-base rounded-2xl",
  lg: "min-h-16 px-6 text-xl rounded-2xl",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  block = false,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "relative inline-flex select-none items-center justify-center gap-2 font-display uppercase tracking-wide",
        disabled && !loading
          ? cx("cursor-not-allowed text-muted/60", variant !== "ghost" && "bg-surface border border-line")
          : VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      <span className={cx("inline-flex items-center gap-2", loading && "opacity-0")}>{children}</span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center" aria-hidden>
          <span className="size-5 animate-spin rounded-full border-[3px] border-current border-t-transparent" />
        </span>
      )}
    </button>
  );
}
