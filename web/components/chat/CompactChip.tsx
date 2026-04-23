"use client";

import { useCallback, useState } from "react";
import { ApiError, compactConversation } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import type { Message } from "@/lib/protocol";

type Props = {
  conversationId: string;
  /** Default tail window kept after compaction. The backend clamps this; we
   * pass the UI's preferred default. */
  keepLast?: number;
  disabled?: boolean;
};

/**
 * Manual context compaction chip — sits in the composer controls next to the
 * model chip. Posts to `POST /api/conversations/{id}/compact` which keeps the
 * last `keep_last` turns and replaces the older tail with one synthetic
 * system-role summary so subsequent turns stay inside the model's context
 * window. After the server responds we swap the in-store message list so the
 * UI reflects the new truncated history immediately.
 *
 * The button doubles as a three-state affordance: idle ("压缩上下文"), in
 * flight ("压缩中…"), and a transient "已压缩 · N 条" after success so the
 * user sees the action landed. Errors surface inline as a tooltip + danger
 * border; they don't block retry.
 */
export function CompactChip({
  conversationId,
  keepLast,
  disabled = false,
}: Props) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "done"; dropped: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const replaceMessages = useChatStore((s) => s.replaceMessages);

  const onClick = useCallback(() => {
    if (disabled || state.kind === "running") return;
    setState({ kind: "running" });
    void (async () => {
      try {
        const res = await compactConversation(conversationId, keepLast);
        const messages: Message[] = res.messages.map((m) => ({
          id: m.id,
          conversation_id: m.conversation_id,
          role: m.role,
          content: m.content,
          tool_calls: [],
          render_payloads: [],
          created_at: m.created_at,
        }));
        replaceMessages(messages);
        setState({ kind: "done", dropped: res.dropped });
        window.setTimeout(() => {
          setState((prev) =>
            prev.kind === "done" ? { kind: "idle" } : prev,
          );
        }, 2500);
      } catch (e) {
        const message =
          e instanceof ApiError || e instanceof Error
            ? e.message
            : String(e);
        setState({ kind: "error", message });
      }
    })();
  }, [conversationId, disabled, keepLast, replaceMessages, state.kind]);

  const label =
    state.kind === "running"
      ? "压缩中…"
      : state.kind === "done"
        ? `已压缩 · ${state.dropped}`
        : "压缩上下文";

  const title =
    state.kind === "error"
      ? `压缩失败 · ${state.message}`
      : "将较早的消息折叠成单条摘要,为后续对话腾出上下文窗口";

  const borderClass =
    state.kind === "error"
      ? "border-danger text-danger"
      : state.kind === "done"
        ? "border-primary text-primary"
        : "border-border text-text-muted hover:text-text hover:border-border-strong";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state.kind === "running"}
      aria-label="手动压缩对话上下文"
      data-testid="compact-chip"
      data-state={state.kind}
      title={title}
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 font-mono text-[11px] transition-colors duration-base disabled:opacity-40 ${borderClass}`}
    >
      <span aria-hidden className="font-mono">⌘</span>
      <span>{label}</span>
    </button>
  );
}
