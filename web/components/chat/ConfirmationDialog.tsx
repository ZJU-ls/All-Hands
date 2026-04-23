"use client";

import { useState } from "react";
import { useChatStore } from "@/lib/store";
import { resolveConfirmation } from "@/lib/api";

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
      await resolveConfirmation(conf.confirmationId, decision);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl bg-surface border border-border p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-text mb-1">
          Confirmation Required
        </h2>
        {current.rationale && (
          <p className="text-sm text-text-muted mb-3">{current.rationale}</p>
        )}
        <div className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-text mb-4">
          {current.summary || "An action requires your approval."}
        </div>
        {current.diff && (
          <pre className="text-xs text-text-muted bg-bg rounded p-3 mb-4 overflow-auto max-h-40">
            {JSON.stringify(current.diff, null, 2)}
          </pre>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => void handle("reject")}
            disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            Reject
          </button>
          <button
            onClick={() => void handle("approve")}
            disabled={loading}
            className="rounded-lg bg-primary hover:opacity-90 disabled:opacity-40 px-4 py-2 text-sm font-medium text-primary-fg transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
