"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";

export type SplitPaneProps = {
  primary: ReactNode;
  secondary: ReactNode;
  primaryLabel: string;
  secondaryLabel: string;
  separatorLabel?: string;
  orientation?: "vertical" | "horizontal";
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  onValueChange?: (value: number) => void;
  onResizeEnd?: (value: number, velocity: number) => void;
};

type DragSample = {
  at: number;
  value: number;
};

type DragGesture = {
  pointerId: number;
  grabOffset: number;
  samples: DragSample[];
};

type SplitPaneStyle = CSSProperties & {
  "--split-primary": string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function SplitPane({
  primary,
  secondary,
  primaryLabel,
  secondaryLabel,
  separatorLabel = "패널 크기 조절",
  orientation = "vertical",
  value,
  defaultValue = 44,
  min = 24,
  max = 76,
  step = 2,
  disabled = false,
  className,
  style,
  onValueChange,
  onResizeEnd,
}: SplitPaneProps) {
  const minimum = clamp(Math.min(min, max), 0, 100);
  const maximum = clamp(Math.max(min, max), minimum, 100);
  const [presentationValue, setPresentationValue] = useState(() =>
    clamp(value ?? defaultValue, minimum, maximum),
  );
  const [dragging, setDragging] = useState(false);
  const presentationRef = useRef(presentationValue);
  const containerRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<DragGesture | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const primaryId = useId();
  const secondaryId = useId();

  useEffect(() => {
    if (gestureRef.current) return;
    const next = clamp(value ?? presentationRef.current, minimum, maximum);
    presentationRef.current = next;
    setPresentationValue(next);
  }, [maximum, minimum, value]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  function stopAnimation() {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  }

  function publishValue(next: number) {
    presentationRef.current = next;
    setPresentationValue(next);
    onValueChange?.(next);
    return next;
  }

  function setValue(nextValue: number) {
    const next = clamp(nextValue, minimum, maximum);
    return publishValue(next);
  }

  function rubberBand(nextValue: number) {
    if (nextValue >= minimum && nextValue <= maximum) return nextValue;
    const boundary = nextValue < minimum ? minimum : maximum;
    const distance = nextValue - boundary;
    return boundary + (distance * 0.34) / (1 + Math.abs(distance) / 12);
  }

  function springTo(targetValue: number, releaseVelocity: number) {
    stopAnimation();
    const target = clamp(targetValue, minimum, maximum);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let position = presentationRef.current;
    let velocity = releaseVelocity;
    let previous = performance.now();
    const stiffness = 340;
    const damping = 34;
    const frame = (now: number) => {
      const elapsed = Math.min(0.032, Math.max(0.001, (now - previous) / 1_000));
      previous = now;
      const acceleration = (target - position) * stiffness - velocity * damping;
      velocity += acceleration * elapsed;
      position += velocity * elapsed;
      publishValue(position);
      if (Math.abs(target - position) < 0.02 && Math.abs(velocity) < 0.08) {
        animationFrameRef.current = null;
        setValue(target);
        return;
      }
      animationFrameRef.current = requestAnimationFrame(frame);
    };
    animationFrameRef.current = requestAnimationFrame(frame);
  }

  function pointerPosition(event: PointerEvent<HTMLDivElement>, rect: DOMRect) {
    return orientation === "vertical" ? event.clientX - rect.left : event.clientY - rect.top;
  }

  function containerSize(rect: DOMRect) {
    return orientation === "vertical" ? rect.width : rect.height;
  }

  function sample(valueAtPointer: number) {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const now = performance.now();
    gesture.samples = [...gesture.samples, { at: now, value: valueAtPointer }]
      .filter((entry) => now - entry.at <= 120)
      .slice(-6);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    stopAnimation();
    const size = containerSize(rect);
    if (size <= 0) return;
    const position = pointerPosition(event, rect);
    const boundary = (presentationRef.current / 100) * size;
    gestureRef.current = {
      pointerId: event.pointerId,
      grabOffset: position - boundary,
      samples: [{ at: performance.now(), value: presentationRef.current }],
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const size = containerSize(rect);
    if (size <= 0) return;
    const position = pointerPosition(event, rect) - gesture.grabOffset;
    const next = publishValue(rubberBand((position / size) * 100));
    sample(next);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const samples = gesture.samples;
    gestureRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) {
      springTo(clamp(presentationRef.current, minimum, maximum), 0);
      return;
    }
    const first = samples[0];
    const last = samples.at(-1);
    const elapsed = first && last ? last.at - first.at : 0;
    const velocity = first && last && elapsed > 0 ? ((last.value - first.value) / elapsed) * 1_000 : 0;
    const projectedTarget = clamp(presentationRef.current + velocity * 0.045, minimum, maximum);
    springTo(projectedTarget, velocity);
    onResizeEnd?.(projectedTarget, velocity);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const multiplier = event.shiftKey ? 5 : 1;
    const amount = Math.max(0.5, step) * multiplier;
    let next: number | null = null;

    if (event.key === "Home") next = minimum;
    if (event.key === "End") next = maximum;
    if (orientation === "vertical" && event.key === "ArrowLeft") {
      next = presentationRef.current - amount;
    }
    if (orientation === "vertical" && event.key === "ArrowRight") {
      next = presentationRef.current + amount;
    }
    if (orientation === "horizontal" && event.key === "ArrowUp") {
      next = presentationRef.current - amount;
    }
    if (orientation === "horizontal" && event.key === "ArrowDown") {
      next = presentationRef.current + amount;
    }
    if (next === null) return;

    event.preventDefault();
    const committed = setValue(next);
    onResizeEnd?.(committed, 0);
  }

  const splitStyle: SplitPaneStyle = {
    ...style,
    "--split-primary": `${presentationValue}%`,
  };

  return (
    <div
      ref={containerRef}
      className={classes("splitPane", className)}
      style={splitStyle}
      data-orientation={orientation}
      data-dragging={dragging ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
    >
      <section id={primaryId} className="splitPanePrimary" aria-label={primaryLabel}>
        {primary}
      </section>
      <div
        className="splitPaneSeparator"
        role="separator"
        aria-label={separatorLabel}
        aria-orientation={orientation}
        aria-valuemin={minimum}
        aria-valuemax={maximum}
        aria-valuenow={Math.round(clamp(presentationValue, minimum, maximum))}
        aria-controls={`${primaryId} ${secondaryId}`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => finishPointer(event, false)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => {
          if (disabled) return;
          const next = setValue(defaultValue);
          onResizeEnd?.(next, 0);
        }}
      >
        <span className="splitPaneHandle" aria-hidden="true" />
      </div>
      <section id={secondaryId} className="splitPaneSecondary" aria-label={secondaryLabel}>
        {secondary}
      </section>
    </div>
  );
}
