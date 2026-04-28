"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { MessageBubble } from "./MessageBubble";
import type { Message } from "@/lib/protocol";

type Props = {
  messages: Message[];
};

/**
 * 「N 条已压缩」 fold — renders a single click-to-expand band over a run of
 * consecutive `is_compacted=true` non-system messages.
 *
 * Dual-view contract (compact-dual-view.md, 2026-04-28): compacted rows
 * stay in the transcript so the user can review render_payloads / tool
 * calls / reasoning whenever they want; the LLM context build path is the
 * one that filters them out for token-budget purposes. Default state is
 * collapsed so a freshly-compacted conversation feels shorter.
 */
export function CompactedFold({ messages }: Props) {
  const t = useTranslations("chat.messageList.compactedFold");
  const [open, setOpen] = useState(false);

  if (messages.length === 0) return null;

  return (
    <section
      data-testid="compacted-fold"
      data-open={open ? "true" : "false"}
      data-count={messages.length}
      className="rounded-lg border border-border bg-surface-2/60 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="compacted-fold-body"
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-fast hover:bg-surface-2"
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary-muted text-primary shrink-0">
          <Icon
            name={open ? "chevron-down" : "chevron-right"}
            size={13}
            strokeWidth={2.25}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-text">
            {t("heading", { n: messages.length })}
          </p>
          <p className="mt-0.5 text-[11px] text-text-subtle">
            {t("subtitle")}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle shrink-0">
          {open ? t("collapse") : t("expand")}
        </span>
      </button>
      {open && (
        <div
          id="compacted-fold-body"
          className="border-t border-border px-4 py-4 space-y-5 opacity-80"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              data-testid={`compacted-message-${m.id}`}
              className="relative"
            >
              <span
                aria-hidden="true"
                className="absolute -left-3 top-1.5 inline-flex h-4 items-center rounded-sm bg-surface-3 px-1 font-mono text-[9px] uppercase tracking-wider text-text-subtle"
              >
                {t("rowBadge")}
              </span>
              <MessageBubble message={m} isStreaming={false} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
