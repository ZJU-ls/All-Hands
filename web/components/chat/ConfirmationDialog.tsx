"use client";

import { useCallback, useState } from "react";
import { useChatStore } from "@/lib/store";
import { resolveConfirmation } from "@/lib/api";
import { Icon } from "@/components/ui/icon";
import { useDismissOnEscape } from "@/lib/use-dismiss-on-escape";

export function ConfirmationDialog() {
  const { pendingConfirmations, removeConfirmation } = useChatStore();
  const [loading, setLoading] = useState(false);

  const current = pendingConfirmations[0];

  // Capture in local const so TypeScript knows it's defined inside the async closure
  const conf = current;

  async function handle(decision: "approve" | "reject") {
    if (!conf) return;
    setLoading(true);
    try {
      // ADR 0018 · single round-trip resume.
      // POST /api/confirmations/{id}/resolve flips the row status. The
      // backend agent loop is awaiting a polling DeferredSignal that
      // sees the new status on its next tick and unblocks the tool —
      // the original /messages SSE keeps streaming the rest of the
      // turn. No second SSE. No graph replay.
      try {
        await resolveConfirmation(conf.confirmationId, decision);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ConfirmationDialog] resolve failed:", err);
      }
    } finally {
      removeConfirmation(conf.confirmationId);
      setLoading(false);
    }
  }

  // ESC = 显式 reject — 跟全局对话框契约对齐(ConfirmDialog / Modal 都是 ESC 取消)。
  // 这里把 ESC 视作"我不同意",而非简单关闭,因为 confirmation gate 必须有
  // 明确决策才能让挂起的 turn 继续。loading 中(请求飞着)则忽略。
  const handleEscape = useCallback(() => {
    if (loading) return;
    void handle("reject");
    // handle 是稳定的闭包,但 React 不会知道;依赖列表加 conf 即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, conf]);
  useDismissOnEscape(Boolean(current), handleEscape);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-surface border border-border shadow-soft-lg p-6">
        <div className="mb-3 flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warning-soft text-warning">
            <Icon name="shield-check" size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-text">
              Confirmation Required
            </h2>
            {current.rationale && (
              <p className="mt-0.5 text-[12px] text-text-muted">{current.rationale}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-text mb-4">
          {current.summary || "An action requires your approval."}
        </div>

        {current.diff && (
          <pre className="mb-4 max-h-40 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text-muted">
            {JSON.stringify(current.diff, null, 2)}
          </pre>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => void handle("reject")}
            disabled={loading}
            className="h-9 rounded-md border border-border bg-surface px-4 text-[13px] text-text hover:bg-surface-2 hover:border-border-strong disabled:opacity-50 transition-colors duration-fast"
          >
            Reject
          </button>
          <button
            onClick={() => void handle("approve")}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-fg shadow-soft-sm hover:bg-primary-hover disabled:opacity-50 transition-colors duration-fast"
          >
            {loading ? (
              <Icon name="loader" size={14} className="animate-spin" />
            ) : (
              <Icon name="check" size={14} strokeWidth={2.25} />
            )}
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
