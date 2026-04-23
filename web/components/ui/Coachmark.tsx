"use client";

/**
 * Coachmark · first-run inline tip (I-0014 · visual-upgrade §5.2).
 *
 * Anchored near a CTA. Persists dismissal in localStorage (`coachmark:seen:<id>`)
 * so a user sees each tip exactly once across sessions.
 *
 * Visual contract:
 * - rounded-md border bg-surface + 2px primary left bar (same pattern as
 *   激活色条 in 03-visual-design.md §2.1)
 * - no animation library, no scale/shadow
 * - dismiss button is a verb ("知道了"), not "OK"
 * - label chip `COACH` in mono, matches FirstRun's `first-run · 欢迎` header
 */

import { useEffect, useState } from "react";
import { hasSeenCoachmark, markCoachmarkSeen } from "@/lib/first-run";

export function Coachmark({
  id,
  title,
  description,
  dismissLabel = "知道了",
  align = "top",
  children,
}: {
  id: string;
  title: string;
  description?: string;
  dismissLabel?: string;
  align?: "top" | "bottom";
  children?: React.ReactNode;
}) {
  // Always render hidden on the first client tick so SSR + initial hydration
  // match, then reveal only if the user hasn't dismissed it yet. This avoids
  // a flash-of-coachmark on repeat visits.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!hasSeenCoachmark(id)) setVisible(true);
  }, [id]);

  function onDismiss() {
    markCoachmarkSeen(id);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-coachmark={id}
      className={`relative overflow-hidden rounded-lg border border-border bg-surface px-4 py-3 shadow-soft animate-fade-up ${
        align === "top" ? "mb-2" : "mt-2"
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r bg-primary"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(to right, var(--color-primary), transparent)",
          opacity: 0.25,
        }}
      />
      <div className="pl-2">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
              coach · {id}
            </div>
            <p className="mt-1 text-[12px] font-medium text-text">{title}</p>
            {description && (
              <p className="mt-1 text-[11px] text-text-muted">{description}</p>
            )}
            {children && <div className="mt-2">{children}</div>}
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭引导"
            className="shrink-0 rounded-md border border-border bg-surface-2/40 px-2 py-0.5 text-[11px] text-text-muted transition-colors duration-base hover:border-border-strong hover:bg-surface-2 hover:text-text"
          >
            {dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
