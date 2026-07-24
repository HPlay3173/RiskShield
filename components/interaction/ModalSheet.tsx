"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";

export type ModalSheetProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

type Drag = {
  pointerId: number;
  startY: number;
  startOffset: number;
  samples: Array<{ at: number; value: number }>;
};

export function ModalSheet({ open, title, children, onClose }: ModalSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const animationRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const closingRef = useRef(false);
  const [offset, setOffset] = useState(0);
  const titleId = useId();

  function publishOffset(next: number) {
    offsetRef.current = next;
    setOffset(next);
  }

  function stopAnimation() {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closingRef.current = false;
      publishOffset(0);
      dialog.showModal();
      requestAnimationFrame(() => dialog.querySelector<HTMLElement>("[data-sheet-close]")?.focus());
    } else if (!open && dialog.open) {
      stopAnimation();
      closingRef.current = false;
      dialog.close();
      publishOffset(0);
    }
  }, [open]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
  }, []);

  function finishClose() {
    stopAnimation();
    closingRef.current = false;
    dragRef.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    publishOffset(0);
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function springBack(releaseVelocity: number) {
    stopAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      publishOffset(0);
      return;
    }
    let position = offsetRef.current;
    let velocity = releaseVelocity;
    let previous = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.032, Math.max(0.001, (now - previous) / 1_000));
      previous = now;
      velocity += (-position * 360 - velocity * 36) * dt;
      position += velocity * dt;
      publishOffset(position);
      if (Math.abs(position) < 0.4 && Math.abs(velocity) < 4) {
        animationRef.current = null;
        publishOffset(0);
        return;
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  }

  function closeWithMotion(releaseVelocity = 0) {
    if (closingRef.current) return;
    closingRef.current = true;
    stopAnimation();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClose();
      return;
    }
    const height = dialogRef.current?.querySelector<HTMLElement>(".modalSheetSurface")?.offsetHeight ?? 600;
    const target = height + 48;
    let position = offsetRef.current;
    let velocity = Math.max(0, releaseVelocity);
    let previous = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.032, Math.max(0.001, (now - previous) / 1_000));
      previous = now;
      velocity += ((target - position) * 300 - velocity * 34) * dt;
      position += velocity * dt;
      publishOffset(position);
      if (Math.abs(target - position) < 1 && Math.abs(velocity) < 12) {
        finishClose();
        return;
      }
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || closingRef.current) return;
    stopAnimation();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offsetRef.current,
      samples: [{ at: performance.now(), value: offsetRef.current }],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const raw = drag.startOffset + event.clientY - drag.startY;
    const next = raw < 0 ? (raw * 0.28) / (1 + Math.abs(raw) / 120) : raw;
    publishOffset(next);
    const now = performance.now();
    drag.samples = [...drag.samples, { at: now, value: next }].filter((sample) => now - sample.at < 120).slice(-6);
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) {
      springBack(0);
      return;
    }
    const first = drag.samples[0];
    const last = drag.samples.at(-1);
    const elapsed = first && last ? last.at - first.at : 0;
    const velocity = first && last && elapsed > 0 ? ((last.value - first.value) / elapsed) * 1_000 : 0;
    const height = dialogRef.current?.querySelector<HTMLElement>(".modalSheetSurface")?.offsetHeight ?? 600;
    if (offsetRef.current > height * 0.3 || velocity > 850) closeWithMotion(velocity);
    else springBack(velocity);
  }

  return (
    <dialog
      ref={dialogRef}
      className="modalSheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeWithMotion();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeWithMotion();
      }}
    >
      <section className="modalSheetSurface" style={{ transform: `translateY(${offset}px)` }}>
        <div
          className="modalSheetHandle"
          aria-hidden="true"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={(event) => pointerEnd(event, false)}
          onPointerCancel={(event) => pointerEnd(event, true)}
          onLostPointerCapture={(event) => pointerEnd(event, true)}
        ><span aria-hidden="true" /></div>
        <header className="modalSheetHeader">
          <h2 id={titleId}>{title}</h2>
          <button className="pressable secondaryButton" type="button" data-sheet-close onClick={() => closeWithMotion()}>닫기</button>
        </header>
        <div className="modalSheetBody">{children}</div>
      </section>
    </dialog>
  );
}
