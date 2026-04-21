"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";

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
          "inline-flex items-center gap-1 font-mono text-[10px] text-text-muted hover:text-text transition-colors duration-base",
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
        "inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-muted hover:text-text hover:border-border-strong transition-colors duration-base",
        className,
      )}
    >
      <span aria-hidden className="text-[9px]">▸</span>
      {label}
    </button>
  );
}
