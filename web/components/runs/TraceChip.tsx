"use client";

/**
 * TraceChip · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Chip variant: rounded-full primary-tinted pill with external-link glyph.
 * Link variant: inline text button with the `↗` arrow (tests pin that glyph).
 *
 * Preserves public API + data-testid.
 */

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";

export const TRACE_QUERY_KEY = "trace";

type Props = {
  runId: string;
  label?: string;
  variant?: "chip" | "link";
  className?: string;
};

export function TraceChip({
  runId,
  label = "trace",
  variant = "chip",
  className,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (ev: MouseEvent<HTMLButtonElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set(TRACE_QUERY_KEY, runId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={handleClick}
        data-testid="trace-chip"
        data-run-id={runId}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-caption text-primary transition-colors duration-base hover:text-primary-hover",
          className,
        )}
      >
        <span aria-hidden>↗</span>
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="trace-chip"
      data-run-id={runId}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border border-primary/20 bg-primary-muted/60 px-2 font-mono text-[10px] text-primary transition-colors duration-base hover:bg-primary-muted hover:-translate-y-px hover:border-primary/40",
        className,
      )}
    >
      <Icon name="external-link" size={10} strokeWidth={2} aria-hidden />
      {label}
    </button>
  );
}
