"use client";

/**
 * ArtifactPeek · floating preview card on hover.
 *
 * Reference inspiration:
 *   - macOS Finder Quick Look: peek without committing to open
 *   - Notion / GitHub linked-issue hover-card: appears after a small
 *     intent delay so passing-through hovers don't flash it
 *   - Vercel deployments inline metadata popover
 *
 * Render contract:
 *   - 150ms intent delay before showing
 *   - never repositioned mid-hover (would feel jittery)
 *   - shows kind icon + name + version + size + relative time + the
 *     conversation context if available
 *   - escape-hatch: parents can pass `disabled` to skip peek (e.g. on
 *     touch devices, or while a drag is active)
 *
 * Implementation: returns a render-prop wrapper. Consumers wrap each
 * artifact item; mouseenter starts the timer, mouseleave cancels it +
 * dismisses the preview. Position is computed once when shown.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ArtifactDto, ArtifactKind } from "@/lib/artifacts-api";

const PEEK_DELAY_MS = 220;

const KIND_ICON: Record<ArtifactKind, IconName> = {
  markdown: "file",
  code: "code",
  html: "code",
  image: "eye",
  data: "database",
  mermaid: "activity",
  drawio: "layout-grid",
  pdf: "file",
  xlsx: "database",
  csv: "database",
  docx: "file",
  pptx: "file",
  video: "play-circle",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
type RelTimeT = (key: string, values?: Record<string, string | number>) => string;

function relativeTime(iso: string, t: RelTimeT): string {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("justNow");
  if (diff < 3600_000) return t("minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 24 * 3600_000) return t("hoursAgo", { n: Math.floor(diff / 3600_000) });
  if (diff < 7 * 24 * 3600_000) return t("daysAgo", { n: Math.floor(diff / (24 * 3600_000)) });
  return new Date(iso).toISOString().slice(0, 10);
}

export function ArtifactPeek({
  artifact,
  disabled = false,
  children,
}: {
  artifact: ArtifactDto;
  disabled?: boolean;
  children: (handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  }) => ReactNode;
}) {
  const tPeek = useTranslations("artifacts.peek");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  // Skip peek entirely on coarse-pointer devices (touch). Hover with no
  // mouse is a "tap-then-tap-away" exercise — the peek would just flash
  // confusingly. Same heuristic Notion + GitHub use.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const listener = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, []);

  const cancelTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    if (disabled || coarse) return;
    cancelTimer();
    if (coarse) return; // belt-and-suspenders against schedule-during-toggle
    timerRef.current = setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Position to the right of the anchor with 12px gap; if there's no
      // room on the right (within 320px of viewport edge) flip to left.
      const anchorRight = rect.right + 12;
      const peekWidth = 280;
      const flipLeft = anchorRight + peekWidth > window.innerWidth - 16;
      const left = flipLeft
        ? Math.max(8, rect.left - peekWidth - 12)
        : anchorRight;
      const top = Math.min(
        Math.max(8, rect.top + rect.height / 2 - 80),
        window.innerHeight - 200,
      );
      setPos({ left, top });
      setOpen(true);
    }, PEEK_DELAY_MS);
  }, [disabled, coarse, cancelTimer]);

  const dismiss = useCallback(() => {
    cancelTimer();
    setOpen(false);
  }, [cancelTimer]);

  useEffect(() => () => cancelTimer(), [cancelTimer]);

  return (
    <span ref={anchorRef} className="contents">
      {children({
        onMouseEnter: schedule,
        onMouseLeave: dismiss,
        onFocus: schedule,
        onBlur: dismiss,
      })}
      {open && pos
        ? (
            <div
              role="tooltip"
              aria-label={`peek ${artifact.name}`}
              className="pointer-events-none fixed z-50 w-[280px] rounded-xl border border-border bg-surface px-3 py-2.5 shadow-soft-lg animate-fade-up"
              style={{ left: pos.left, top: pos.top }}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
                  <Icon name={KIND_ICON[artifact.kind] ?? "file"} size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-text">
                    {artifact.name}
                  </div>
                  <div className="truncate font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                    {artifact.kind} · v{artifact.version}
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-y-1 font-mono text-[10px] text-text-muted">
                <span className="text-text-subtle">{tPeek("size")}</span>
                <span className="text-right tabular-nums">{formatBytes(artifact.size_bytes)}</span>
                <span className="text-text-subtle">{tPeek("updated")}</span>
                <span className="text-right">{relativeTime(artifact.updated_at, tPeek)}</span>
                <span className="text-text-subtle">{tPeek("created")}</span>
                <span className="text-right">{relativeTime(artifact.created_at, tPeek)}</span>
              </div>
              {artifact.conversation_id ? (
                <div className="mt-2 truncate border-t border-border pt-2 font-mono text-[10px] text-text-subtle">
                  ↳ {artifact.conversation_id.slice(0, 8)}
                </div>
              ) : null}
            </div>
          )
        : null}
    </span>
  );
}
