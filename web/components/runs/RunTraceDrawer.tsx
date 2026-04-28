"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { RunTracePanel } from "./RunTracePanel";
import { useTraceDrawer } from "@/lib/use-trace-drawer";
import { traceHref } from "./TraceChip";

/**
 * Right-side drawer that surfaces a run's trace without unmounting the
 * page underneath. Mounted once at the AppShell level and driven entirely
 * by the `?trace=<run_id>` query param so:
 *
 *   - clicking a TraceChip in chat opens the drawer in-place — Lead's
 *     SSE stream stays alive, spawn_subagent doesn't get cancelled.
 *   - URLs are shareable: paste `/chat/abc?trace=run_xyz` and the
 *     recipient lands on the same chat with the same drawer open.
 *   - close paths (ESC / overlay click / ✕ button) all delete the query
 *     so back-button history works as expected.
 *
 * The `↗ 全屏看` button is a real `<Link>` to `/observatory/runs/<id>`
 * for users who want the full L3 trace page (deep analysis, side panels,
 * keyboard shortcuts). Drawer = quick peek, page = deep dive.
 */
export function RunTraceDrawer() {
  const t = useTranslations("runs.traceDrawer");
  const { runId, isOpen, close } = useTraceDrawer();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Skip when the user is interacting with a text field — they
        // might be editing inside the drawer's textarea (future) or in
        // an overlay above us. Defer to the bubbling default.
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen || !runId) return null;

  return (
    <>
      <button
        type="button"
        aria-label={t("overlayClose")}
        data-testid="run-trace-drawer-overlay"
        onClick={close}
        className="fixed inset-0 z-30 bg-text/10 backdrop-blur-[1px] motion-safe:animate-fade-in"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        data-testid="run-trace-drawer"
        data-run-id={runId}
        className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[720px] flex-col border-l border-border bg-surface shadow-soft-lg motion-safe:animate-slide-in-right md:w-[48vw] md:min-w-[480px]"
      >
        <header className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-muted text-primary shrink-0">
            <Icon name="activity" size={13} strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text">{t("title")}</p>
            <p className="font-mono text-[10.5px] text-text-subtle truncate">
              {runId}
            </p>
          </div>
          <Link
            href={traceHref(runId)}
            data-testid="run-trace-drawer-fullscreen"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-text-muted hover:text-text hover:border-border-strong transition-colors duration-fast"
            title={t("fullscreenHint")}
          >
            <Icon name="external-link" size={11} strokeWidth={2} />
            {t("fullscreen")}
          </Link>
          <button
            type="button"
            onClick={close}
            data-testid="run-trace-drawer-close"
            aria-label={t("close")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-fast"
          >
            <Icon name="x" size={13} strokeWidth={2.25} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <RunTracePanel runId={runId} hideHeaderTraceChip />
        </div>

        <footer className="border-t border-border bg-surface-2 px-4 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          {t("kbHint")}
        </footer>
      </aside>
    </>
  );
}
