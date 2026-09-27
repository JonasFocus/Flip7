"use client";

import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

// Bottom sheet on native <dialog>: showModal() gives focus trap, inert page, Escape and aria-modal for free.
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const titleId = useId();
  const exit = useRef<Animation | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Safari < 17.4 can't transition display/overlay or use @starting-style, so the CSS alone
    // would pop the sheet in and out. There, slide it with WAAPI and close once it's off screen.
    const cssOnly = CSS.supports("transition-behavior", "allow-discrete") || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      exit.current?.cancel();
      exit.current = null;
      if (!d.open) {
        d.showModal();
        d.focus(); // start on the sheet itself, not a random first button
        if (!cssOnly) d.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 300, easing: EASE });
      }
    } else if (d.open && !exit.current) {
      if (cssOnly) return d.close();
      const from = getComputedStyle(d).transform;
      const anim = d.animate([{ transform: from === "none" ? "translateY(0)" : from }, { transform: "translateY(100%)" }], { duration: 240, easing: EASE });
      exit.current = anim;
      anim.onfinish = () => {
        exit.current = null;
        d.close();
      };
    }
  }, [open]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (drag.current || !dismissible) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = ref.current;
    if (!drag.current || !d) return;
    const raw = e.clientY - drag.current.y;
    drag.current.dy = raw > 0 ? raw : raw / 6;
    d.style.transition = "none";
    d.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onPointerUp() {
    const d = ref.current;
    const g = drag.current;
    drag.current = null;
    if (!d || !g) return;
    d.style.transition = "";
    d.style.transform = "";
    const velocity = g.dy / (performance.now() - g.t);
    if (g.dy > 90 || velocity > 0.5) onClose();
  }

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={title ? titleId : undefined}
      className={cx("sheet outline-none", className)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88dvh] flex-col">
        <div
          className={cx("flex-none px-5 pt-3 pb-2", dismissible && "touch-none cursor-grab")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {dismissible && <div className="mx-auto h-1.5 w-10 rounded-full bg-line" aria-hidden />}
          {(title || dismissible) && (
            <div className={cx("flex items-center justify-between gap-3", dismissible ? "mt-1 min-h-11" : "mt-3")}>
              {title ? (
                <h2 id={titleId} className="font-display text-xl uppercase tracking-wide">
                  {title}
                </h2>
              ) : (
                <span />
              )}
              {dismissible && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mr-3 flex-none"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onClose}
                >
                  Done
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-safe-6">{children}</div>
      </div>
    </dialog>
  );
}
