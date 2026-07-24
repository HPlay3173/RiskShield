"use client";

import { forwardRef, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

export type PressableProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  hysteresis?: number;
};

type PointerGesture = {
  pointerId: number;
  cancelled: boolean;
};

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(function Pressable(
  {
    className,
    hysteresis = 10,
    disabled,
    type = "button",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onClick,
    onKeyDown,
    onKeyUp,
    onBlur,
    ...props
  },
  forwardedRef,
) {
  const [pressed, setPressed] = useState(false);
  const gestureRef = useRef<PointerGesture | null>(null);
  const keyboardPressRef = useRef(false);
  const suppressClickRef = useRef(false);

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    suppressClickRef.current = suppressClickRef.current || cancelled || gesture.cancelled;
    gestureRef.current = null;
    setPressed(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    onPointerDown?.(event);
    if (event.defaultPrevented || disabled || event.button !== 0) return;

    suppressClickRef.current = false;
    gestureRef.current = {
      pointerId: event.pointerId,
      cancelled: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    onPointerMove?.(event);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const slop = Math.max(0, hysteresis);
    const outside = event.clientX < rect.left - slop
      || event.clientX > rect.right + slop
      || event.clientY < rect.top - slop
      || event.clientY > rect.bottom + slop;
    gesture.cancelled = outside;
    suppressClickRef.current = outside;
    setPressed(!outside);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    onPointerUp?.(event);
    finishPointer(event, false);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    onPointerCancel?.(event);
    finishPointer(event, true);
  }

  function handleLostPointerCapture(event: ReactPointerEvent<HTMLButtonElement>) {
    onLostPointerCapture?.(event);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    suppressClickRef.current = true;
    setPressed(false);
  }

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled || event.repeat) return;
    if (event.key === " " || event.key === "Enter") {
      suppressClickRef.current = false;
      keyboardPressRef.current = true;
      setPressed(true);
    }
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    onKeyUp?.(event);
    if ((event.key === " " || event.key === "Enter") && keyboardPressRef.current) {
      keyboardPressRef.current = false;
      setPressed(false);
    }
  }

  return (
    <button
      {...props}
      ref={forwardedRef}
      type={type}
      disabled={disabled}
      className={classes("pressable", className)}
      data-pressable=""
      data-pressed={pressed ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={(event) => {
        keyboardPressRef.current = false;
        setPressed(false);
        onBlur?.(event);
      }}
    />
  );
});

Pressable.displayName = "Pressable";
