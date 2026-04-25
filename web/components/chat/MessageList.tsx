"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";
import { Icon } from "@/components/ui/icon";
import type { Message } from "@/lib/protocol";

type Props = { conversationId: string };

/** How far from the bottom we still count the viewport as "at bottom". */
const STICK_THRESHOLD_PX = 64;

export function MessageList({ conversationId }: Props) {
  const t = useTranslations("chat.messageList");
  const { messages, streamingMessage, streamError, isStreaming } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const isAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.clientHeight - el.scrollTop < STICK_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    setStickToBottom(isAtBottom());
  }, [isAtBottom]);

  // Between send and first frame, `streamingMessage` is still null but the
  // user expects *some* reaction — a pending placeholder tracks that gap so
  // "像是没连接上一样" stops being the default. It also makes the pending
  // state a first-class scroll anchor so the stick-to-bottom autoscroll
  // lands the user on the breathing dots.
  const isPendingAssistant = isStreaming && !streamingMessage;

  useLayoutEffect(() => {
    if (stickToBottom) scrollToBottom("auto");
  }, [messages, streamingMessage, streamError, isPendingAssistant, stickToBottom, scrollToBottom]);

  useEffect(() => {
    scrollToBottom("auto");
  }, [conversationId, scrollToBottom]);

  const hasAnything =
    messages.length > 0 || !!streamingMessage || !!streamError || isPendingAssistant;

  // Unify historical + in-flight assistant bubbles under `message.id` keys so
  // React reconciles across the streaming → finalized transition. Previously
  // the streaming bubble was an unkeyed positional child and the finalized
  // one was keyed, which unmounted/remounted the component at finalize-time
  // and reset ReasoningBlock's `open` useState back to false — the "思考过程
  // 展示完之后会隐藏" bug.
  const renderRows: Array<{ msg: Message; streaming: boolean }> = messages.map(
    (msg) => ({ msg, streaming: false }),
  );
  if (streamingMessage) {
    renderRows.push({
      msg: {
        ...streamingMessage,
        conversation_id: conversationId,
        tool_call_id: null,
        trace_ref: null,
        parent_run_id: null,
      },
      streaming: true,
    });
  }

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list-scroll"
        className="h-full overflow-y-auto"
      >
        {!hasAnything ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5">
            {renderRows.map(({ msg, streaming }) => (
              <MessageBubble key={msg.id} message={msg} isStreaming={streaming} />
            ))}
            {isPendingAssistant && <PendingAssistantBubble />}
            {streamError && !streamingMessage && (
              <StreamErrorBanner
                message={streamError.message}
                code={streamError.code}
              />
            )}
          </div>
        )}
      </div>

      {!stickToBottom && hasAnything && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom("smooth");
            setStickToBottom(true);
          }}
          data-testid="jump-to-bottom"
          aria-label={t("jumpToLatest")}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-medium text-text-muted shadow-soft-sm transition-colors duration-fast hover:text-text hover:border-border-strong hover:bg-surface-2"
        >
          <Icon name="arrow-down" size={12} />
          {t("backToLatest")}
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("chat.messageList");
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary-muted text-primary">
          <Icon name="sparkles" size={22} />
        </div>
        <p className="text-[14px] font-medium text-text">{t("ready")}</p>
        <p className="mt-1 text-[12px] text-text-muted">{t("emptyHint")}</p>
      </div>
    </div>
  );
}

/** Pre-first-frame placeholder. Shown the moment the user hits send, kept
 * on screen until TEXT_MESSAGE_START / REASONING_MESSAGE_START arrives. The
 * three dots cycle opacity via the shared `ah-dot` keyframe; avatar tile
 * matches the live agent bubble so the transition into real tokens doesn't
 * reflow. */
function PendingAssistantBubble() {
  const t = useTranslations("chat.messageList");
  return (
    <div
      data-testid="pending-assistant-bubble"
      role="status"
      aria-label={t("modelProcessing")}
      className="flex justify-start gap-3"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-primary-fg shadow-soft-sm"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
        }}
      >
        <Icon name="sparkles" size={14} strokeWidth={2.25} />
      </span>
      <div className="rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 shadow-soft-sm">
        <span className="inline-flex items-center gap-1.5 align-middle">
          <PendingDot delay={0} />
          <PendingDot delay={160} />
          <PendingDot delay={320} />
        </span>
      </div>
    </div>
  );
}

function PendingDot({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
      style={{ animation: `ah-dot 1.2s ease-in-out ${delay}ms infinite` }}
    />
  );
}

/** Inline failure surface for a broken agent turn.
 *
 * Most "chat 没有任何反应" reports trace back to provider auth — a seed
 * provider without an API key, a typoed base_url, or a model the
 * upstream rejects. Rendering this banner inline, right where the
 * assistant reply would have appeared, makes the failure visible without
 * pushing the user off to a toast or a console they never open.
 */
function StreamErrorBanner({
  message,
  code,
}: {
  message: string;
  code?: string;
}) {
  const t = useTranslations("chat.messageList");
  const hint =
    code === "INTERNAL" || code === undefined
      ? t("internalHint")
      : null;
  return (
    <div
      data-testid="message-list-stream-error"
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3"
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-danger/15 text-danger">
        <Icon name="alert-triangle" size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-danger">{t("assistantFailed")}</div>
        <div className="mt-1 break-all font-mono text-[11px] text-danger/80">
          {message}
          {code ? <span className="ml-2 text-danger/60">[{code}]</span> : null}
        </div>
        {hint && <div className="mt-1.5 text-[11px] text-text-muted">{hint}</div>}
      </div>
    </div>
  );
}
