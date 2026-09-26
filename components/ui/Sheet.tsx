"use client";

import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";

// Bottom sheet on native <dialog>: showModal() gives focus trap, inert page, Escape and aria-modal for free.
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.focus(); // start on the sheet itself, not a random first button
    }
    if (!open && d.open) d.close();
  }, [open]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (drag.current) return;
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
          className="flex-none touch-none cursor-grab px-5 pt-3 pb-2"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-line" aria-hidden />
          {title && (
            <h2 id={titleId} className="mt-3 font-display text-xl uppercase tracking-wide">
              {title}
            </h2>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-safe-6">{children}</div>
      </div>
    </dialog>
  );
}
