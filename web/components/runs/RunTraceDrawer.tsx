"use client";

/**
 * RunTraceDrawer · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Fixed right-side drawer (420px) that opens whenever ?trace=<run_id> is in
 * the URL. Scrim dims + blurs the page; Escape closes; close button + scrim
 * click both strip the query param.
 */

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { RunTracePanel } from "./RunTracePanel";
import { TRACE_QUERY_KEY } from "./TraceChip";

export function RunTraceDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const runId = searchParams?.get(TRACE_QUERY_KEY) ?? null;

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete(TRACE_QUERY_KEY);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!runId) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [runId, close]);

  if (!runId) return null;

  return (
    <div
      data-testid="run-trace-drawer"
      className="fixed inset-0 z-40 flex justify-end animate-fade-up"
    >
      <button
        type="button"
        aria-label="关闭 trace"
        onClick={close}
        className="flex-1 bg-black/60 backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-label={`Trace ${runId}`}
        className="flex h-full w-[420px] shrink-0 flex-col border-l border-border bg-surface shadow-soft-lg"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface-2/40 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary-muted text-primary"
            >
              <Icon name="activity" size={14} />
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                trace
              </div>
              <div className="truncate font-mono text-caption text-text">
                {runId}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            data-testid="run-trace-drawer-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-text-muted transition-colors duration-base hover:border-border-strong hover:bg-surface-2 hover:text-text"
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <RunTracePanel runId={runId} />
        </div>
      </aside>
    </div>
  );
}
