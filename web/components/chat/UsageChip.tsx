"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  compactConversation,
  listModels,
  listProviders,
  type ChatMessageDto,
  type ModelDto,
  type ProviderDto,
} from "@/lib/api";
import { useChatStore } from "@/lib/store";
import type { Message } from "@/lib/protocol";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * UsageChip · context accounting for the chat composer (Track ε).
 *
 * Why this exists: without a visible budget, users discover they've overrun
 * the model window when a turn silently truncates. The chip surfaces a
 * `used/window` glyph and nudges toward the manual 整理 button once the
 * ratio crosses the soft threshold.
 *
 * Accounting is intentionally in-house and approximate:
 *   - sum of message character lengths / 4 ≈ token count (Claude/OpenAI rule
 *     of thumb; accuracy within ±15% on prose, plenty for a progress bar).
 *   - context window resolved by matching employee.model_ref against the
 *     gateway's model list. Falls back to 128_000 tokens so a misconfigured
 *     model still renders a usable bar instead of vanishing.
 *
 * Thresholds track the user's mental model more than any LLM rule:
 *   - <70%: muted — "you have room"
 *   - 70-90%: warning — "consider compacting" + 整理 button surfaces
 *   - ≥90%: danger — "compact now or next turn may truncate"
 */

const FALLBACK_CONTEXT_WINDOW = 128_000;
const CHARS_PER_TOKEN = 4;
const WARN_THRESHOLD = 0.7;
const DANGER_THRESHOLD = 0.9;

type Props = {
  conversationId: string;
  employeeModelRef: string;
  disabled?: boolean;
};

function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    for (const tc of m.tool_calls) {
      chars += JSON.stringify(tc.args).length;
      if (tc.result !== undefined && tc.result !== null) {
        chars += JSON.stringify(tc.result).length;
      }
    }
  }
  return Math.round(chars / CHARS_PER_TOKEN);
}

function formatK(n: number): string {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

function resolveContextWindow(
  modelRef: string,
  providers: ProviderDto[],
  models: ModelDto[],
): number {
  if (!modelRef) return FALLBACK_CONTEXT_WINDOW;
  const idx = modelRef.indexOf("/");
  if (idx < 0) return FALLBACK_CONTEXT_WINDOW;
  const providerName = modelRef.slice(0, idx);
  const modelName = modelRef.slice(idx + 1);
  const provider = providers.find((p) => p.name === providerName);
  if (!provider) return FALLBACK_CONTEXT_WINDOW;
  const model = models.find(
    (m) => m.provider_id === provider.id && m.name === modelName,
  );
  if (!model) return FALLBACK_CONTEXT_WINDOW;
  // Priority: explicit max_input_tokens (user's "real prompt budget") wins
  // over the conflated context_window total. context_window is fallback when
  // the user only set the total. Both null/0 → FALLBACK so the bar still
  // renders something usable instead of vanishing.
  if (model.max_input_tokens && model.max_input_tokens > 0) return model.max_input_tokens;
  if (model.context_window > 0) return model.context_window;
  return FALLBACK_CONTEXT_WINDOW;
}

function toMessage(dto: ChatMessageDto): Message {
  return {
    id: dto.id,
    conversation_id: dto.conversation_id,
    role: dto.role,
    content: dto.content,
    tool_calls: [],
    render_payloads: [],
    created_at: dto.created_at,
  };
}

export function UsageChip({ conversationId, employeeModelRef, disabled }: Props) {
  const t = useTranslations("chat.usageChip");
  const messages = useChatStore((s) => s.messages);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const replaceMessages = useChatStore((s) => s.replaceMessages);

  const [window, setWindow] = useState<number>(FALLBACK_CONTEXT_WINDOW);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [providers, models] = await Promise.all([listProviders(), listModels()]);
        if (cancelled) return;
        setWindow(resolveContextWindow(employeeModelRef, providers, models));
      } catch {
        // fallback is already set; silent failure is fine for a non-critical chip
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeModelRef]);

  const usedTokens = useMemo(() => {
    const all: Message[] = streamingMessage
      ? [
          ...messages,
          {
            id: streamingMessage.id,
            conversation_id: conversationId,
            role: "assistant",
            content: streamingMessage.content,
            tool_calls: streamingMessage.tool_calls,
            render_payloads: streamingMessage.render_payloads,
            created_at: streamingMessage.created_at,
          } as Message,
        ]
      : messages;
    return estimateTokens(all);
  }, [messages, streamingMessage, conversationId]);

  const ratio = window > 0 ? usedTokens / window : 0;
  const tier: "ok" | "warn" | "danger" =
    ratio >= DANGER_THRESHOLD ? "danger" : ratio >= WARN_THRESHOLD ? "warn" : "ok";

  const tierTextClass =
    tier === "danger"
      ? "text-danger"
      : tier === "warn"
        ? "text-warning"
        : "text-text-muted";

  const tierIconBg =
    tier === "danger"
      ? "bg-danger-soft text-danger"
      : tier === "warn"
        ? "bg-warning-soft text-warning"
        : "bg-surface-2 text-text-subtle";

  const handleCompact = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await compactConversation(conversationId);
      replaceMessages(result.messages.map(toMessage));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [conversationId, busy, replaceMessages]);

  const showCompact = tier !== "ok";

  return (
    <div
      className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2 font-mono text-[10px] tabular-nums"
      data-testid="usage-chip"
      data-tier={tier}
      title={err ?? t("tooltip", { used: usedTokens, total: window })}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-4 w-4 shrink-0 place-items-center rounded-sm",
          tierIconBg,
        )}
      >
        <Icon name="activity" size={10} />
      </span>
      <span className={tierTextClass}>
        {formatK(usedTokens)}/{formatK(window)}
      </span>
      {showCompact && (
        <button
          type="button"
          onClick={handleCompact}
          disabled={busy || disabled}
          data-testid="usage-chip-compact"
          className="ml-0.5 inline-flex h-5 items-center gap-1 rounded border border-border bg-surface-2 px-1.5 text-[10px] text-text-muted hover:text-text hover:border-border-strong hover:bg-surface-3 transition-colors duration-fast disabled:opacity-50"
        >
          {busy ? (
            <Icon name="loader" size={10} className="animate-spin" />
          ) : (
            <Icon name="sparkles" size={10} />
          )}
          {busy ? t("compacting") : t("compact")}
        </button>
      )}
    </div>
  );
}
