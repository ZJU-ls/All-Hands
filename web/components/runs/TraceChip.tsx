"use client";

/**
 * TraceChip · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Renders a link into the observatory L3 trace page
 * (``/observatory/runs/<run_id>``). Two visual variants:
 *
 *   - **chip** · rounded-full primary-tinted pill (default · dense lists)
 *   - **link** · inline text link with `↗` glyph (ToolCallCard expand)
 *
 * Pre-2026-04-27 this pushed ``?trace=<id>`` and a global drawer popped on
 * top of whatever page the user was on. That coupled trace viewing to chat
 * UX and produced 3 parallel trace surfaces. The integration plan
 * consolidates trace into observatory's L3 — this component is the
 * single hand-off; tests pin the href contract.
 *
 * ``TRACE_QUERY_KEY`` stays exported as ``"trace"`` because some observatory
 * sub-views (cockpit ActiveRunsList, traces page) still use it as a
 * URL-state key for selection · they navigate to /observatory/runs/<id>
 * via this chip but read the legacy query for backward-compat.
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

export const TRACE_QUERY_KEY = "trace";

/** Single source of truth for the L3 trace href. */
export function traceHref(runId: string): string {
  return `/observatory/runs/${encodeURIComponent(runId)}`;
}

type Props = {
  runId: string;
  label?: string;
  variant?: "chip" | "link";
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
  const href = traceHref(runId);

  if (variant === "link") {
    return (
      <Link
        href={href}
        data-testid="trace-chip"
        data-run-id={runId}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-caption text-primary transition-colors duration-base hover:text-primary-hover",
          className,
        )}
      >
        <span aria-hidden>↗</span>
        {resolvedLabel}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      data-testid="trace-chip"
      data-run-id={runId}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border border-primary/20 bg-primary-muted/60 px-2 font-mono text-[10px] text-primary transition-colors duration-base hover:bg-primary-muted hover:-translate-y-px hover:border-primary/40",
        className,
      )}
    >
      <Icon name="external-link" size={10} strokeWidth={2} aria-hidden />
      {label}
    </Link>
  );
}
