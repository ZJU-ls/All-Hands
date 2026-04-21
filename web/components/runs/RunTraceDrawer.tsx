"use client";

import { useCallback, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
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
      className="fixed inset-0 z-40 flex justify-end"
      style={{ animation: "ah-fade-up 160ms var(--ease-out, ease-out)" }}
    >
      <button
        type="button"
        aria-label="关闭 trace"
        onClick={close}
        className="flex-1 bg-bg/60 backdrop-blur-[2px]"
      />
      <aside
        role="dialog"
        aria-label={`Trace ${runId}`}
        className="flex h-full w-[480px] shrink-0 flex-col border-l border-border bg-surface"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
              trace
            </div>
            <div className="truncate font-mono text-[12px] text-text">{runId}</div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭"
            data-testid="run-trace-drawer-close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border font-mono text-[11px] text-text-muted transition-colors duration-base hover:text-text hover:border-border-strong"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <RunTracePanel runId={runId} />
        </div>
      </aside>
    </div>
  );
}
