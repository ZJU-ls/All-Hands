"use client";

/**
 * RouteProgress · 2px top-of-viewport progress bar that animates while a
 * route transition is pending and the new tree starts streaming. Inspired
 * by NProgress / Vercel-style top loader, but token-only and dependency-
 * free. Uses Next 15's `usePathname` change as the "we just navigated"
 * signal and a fixed 600ms animation cycle — long enough to be visible on
 * fast routes, not long enough to feel stuck on slow ones.
 *
 * Shows on top so it never competes with sticky page headers.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function RouteProgress() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"idle" | "running">("idle");

  useEffect(() => {
    setPhase("running");
    const t = setTimeout(() => setPhase("idle"), 600);
    return () => clearTimeout(t);
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[2px] overflow-hidden"
    >
      <div
        className={
          phase === "running"
            ? "h-full origin-left animate-[ah-route-progress_600ms_var(--ease-out-quart)_forwards] bg-primary"
            : "h-full -translate-x-full bg-primary opacity-0"
        }
        style={{ width: "100%" }}
      />
    </div>
  );
}
