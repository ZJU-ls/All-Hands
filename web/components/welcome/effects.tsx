"use client";

/**
 * Welcome-page effect primitives.
 *
 *   - <Tilt> · wraps a card; tracks the cursor and applies a subtle
 *     perspective rotateX/rotateY transform on the inner element.
 *     Resets to flat on mouseleave. Tasteful (≤6° max), not gimmicky.
 *
 *   - <CountUp> · animates a number from 0 to `value` once on mount with
 *     ease-out cubic. Honors `prefers-reduced-motion`.
 *
 * Both are local to the welcome page · no need to surface them as
 * project-wide UI primitives until a second consumer appears.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ─── Tilt ────────────────────────────────────────────────────────────────

export function Tilt({
  children,
  className,
  /** Maximum rotation in degrees on either axis. Keep ≤ 8 for taste. */
  maxDeg = 5,
  /** Perspective depth · larger = subtler tilt. */
  perspective = 1200,
}: {
  children: ReactNode;
  className?: string;
  maxDeg?: number;
  perspective?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handle(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    const ry = (x * maxDeg * 2).toFixed(2);
    const rx = (-y * maxDeg * 2).toFixed(2);
    el.style.transform = `perspective(${perspective}px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  }

  function reset() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = `perspective(${perspective}px) rotateX(0deg) rotateY(0deg)`;
  }

  return (
    <div
      ref={ref}
      onMouseMove={handle}
      onMouseLeave={reset}
      className={cn(
        "transition-transform duration-mid will-change-transform",
        className,
      )}
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
    </div>
  );
}

// ─── CountUp ─────────────────────────────────────────────────────────────

export function CountUp({
  value,
  durationMs = 1200,
  className,
  style,
}: {
  value: number;
  durationMs?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setN(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setN(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return (
    <span className={className} style={style}>
      {n}
    </span>
  );
}
