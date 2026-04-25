"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, compactConversation } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import type { Message } from "@/lib/protocol";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

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
 * The chip cycles through three states: idle ("压缩上下文"), in-flight
 * ("压缩中…"), and a transient "已压缩 · N 条" success state so the user
 * sees the action landed. Errors light the chip danger + surface inline via
 * the title attribute; the chip stays retryable.
 *
 * Visual follows the Brand Blue token chip language (ADR 0016):
 *   · resting = border + muted text, mono label
 *   · success = primary-muted fill + primary text
 *   · error   = danger-soft fill + danger text
 */
export function CompactChip({
  conversationId,
  keepLast,
  disabled = false,
}: Props) {
  const t = useTranslations("chat.compactChip");
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
      ? t("running")
      : state.kind === "done"
        ? t("done", { n: state.dropped })
        : t("idle");

  const title =
    state.kind === "error"
      ? t("errorTitle", { message: state.message })
      : t("tooltip");

  const tone =
    state.kind === "error"
      ? "border-danger/40 bg-danger-soft text-danger"
      : state.kind === "done"
        ? "border-primary/40 bg-primary-muted text-primary"
        : state.kind === "running"
          ? "border-border bg-surface-2 text-text-muted"
          : "border-border bg-surface text-text-muted hover:text-text hover:border-border-strong hover:bg-surface-2";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state.kind === "running"}
      aria-label={t("ariaLabel")}
      data-testid="compact-chip"
      data-state={state.kind}
      title={title}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 font-mono text-[11px] transition-colors duration-base disabled:opacity-50",
        tone,
      )}
    >
      {state.kind === "running" ? (
        <Icon name="loader" size={12} className="animate-spin" />
      ) : state.kind === "done" ? (
        <Icon name="check" size={12} />
      ) : state.kind === "error" ? (
        <Icon name="alert-circle" size={12} />
      ) : (
        <Icon name="sparkles" size={12} className="text-text-subtle" />
      )}
      <span>{label}</span>
    </button>
  );
}
