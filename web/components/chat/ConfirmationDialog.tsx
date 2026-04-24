"use client";

import { useState } from "react";
import { useChatStore } from "@/lib/store";
import { resolveConfirmation } from "@/lib/api";
import { Icon } from "@/components/ui/icon";

export function ConfirmationDialog() {
  const { pendingConfirmations, removeConfirmation, requestResume } = useChatStore();
  const [loading, setLoading] = useState(false);

  const current = pendingConfirmations[0];
  if (!current) return null;

  // Capture in local const so TypeScript knows it's defined inside the async closure
  const conf = current;

  async function handle(decision: "approve" | "reject") {
    setLoading(true);
    try {
      // /resolve updates the Confirmation row's status (both sources — legacy
      // polling and interrupt-sourced — keep the audit trail in the same table).
      // resolveConfirmation tolerates 404 (already resolved / never persisted)
      // so the UI doesn't crash when a stale confirmationId arrives.
      try {
        await resolveConfirmation(conf.confirmationId, decision);
      } catch (err) {
        // Non-404 errors: log but still continue the resume flow so the turn
        // doesn't hang. User can retry the action afterwards if needed.
        // eslint-disable-next-line no-console
        console.warn("[ConfirmationDialog] resolve failed · continuing resume:", err);
      }

      // ADR 0014 Phase 4e · interrupt-sourced pauses need a second call to
      // /conversations/{id}/resume so the paused LangGraph turn continues.
      // We hand that off to InputBar (which owns the chat SSE lifecycle) by
      // publishing the request; InputBar's useEffect picks it up, opens a
      // resume SSE, and pipes tokens into the same message bubble so the UI
      // experience is "one continuous turn with a pause in the middle".
      if (conf.source === "interrupt" && conf.conversationId) {
        requestResume({ conversationId: conf.conversationId, decision });
      }
    } finally {
      removeConfirmation(conf.confirmationId);
      setLoading(false);
    }
  }

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
