"use client";

/**
 * TraceChip · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Two visual variants AND two navigation behaviours:
 *
 *   - **chip / link variant (default)** opens the right-side trace drawer
 *     (`?trace=<run_id>`). The chat page keeps streaming, spawn_subagent
 *     keeps running. This is what users hit from inside an active
 *     conversation, where unmounting would kill the live SSE.
 *   - **page variant** behaves as before — a full `<Link>` navigation to
 *     `/observatory/runs/<run_id>`. Used by cockpit ActiveRunsList,
 *     observatory traces table, and other "I came here to analyse traces"
 *     surfaces where a page change is the desired outcome.
 *
 * The `traceHref` helper is exported so the drawer's "↗ 全屏看" button
 * and the variant=page renderer share one definition.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { useTraceDrawer } from "@/lib/use-trace-drawer";

export const TRACE_QUERY_KEY = "trace";

/** Single source of truth for the L3 trace href (full-screen page). */
export function traceHref(runId: string): string {
  return `/observatory/runs/${encodeURIComponent(runId)}`;
}

type Props = {
  runId: string;
  label?: string;
  /**
   * `chip` (default) and `link` open the in-place drawer; `page` performs
   * a full navigation. Pick `page` only on surfaces whose primary purpose
   * is trace analysis (cockpit, observatory tables).
   */
  variant?: "chip" | "link" | "page";
  className?: string;
};

export function TraceChip({
  runId,
  label,
  variant = "chip",
  className,
}: Props) {
  const t = useTranslations("runs.traceChip");
  const resolvedLabel = label ?? t("label");
  const { open } = useTraceDrawer();

  const baseDataAttrs = {
    "data-testid": "trace-chip",
    "data-run-id": runId,
    "data-variant": variant,
  } as const;

  if (variant === "page") {
    const href = traceHref(runId);
    return (
      <Link
        href={href}
        {...baseDataAttrs}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border border-primary/20 bg-primary-muted/60 px-2 font-mono text-[10px] text-primary transition-colors duration-base hover:bg-primary-muted hover:-translate-y-px hover:border-primary/40",
          className,
        )}
      >
        <Icon name="external-link" size={10} strokeWidth={2} aria-hidden />
        {resolvedLabel}
      </Link>
    );
  }

  const onClick = () => open(runId);

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={onClick}
        {...baseDataAttrs}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-caption text-primary transition-colors duration-base hover:text-primary-hover",
          className,
        )}
      >
        <span aria-hidden>↗</span>
        {resolvedLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      {...baseDataAttrs}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border border-primary/20 bg-primary-muted/60 px-2 font-mono text-[10px] text-primary transition-colors duration-base hover:bg-primary-muted hover:-translate-y-px hover:border-primary/40",
        className,
      )}
    >
      <Icon name="external-link" size={10} strokeWidth={2} aria-hidden />
      {resolvedLabel}
    </button>
  );
}
