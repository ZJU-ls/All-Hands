"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";
import { ArrowDownIcon } from "@/components/icons";
import type { Message } from "@/lib/protocol";

type Props = { conversationId: string };

/** How far from the bottom we still count the viewport as "at bottom". */
const STICK_THRESHOLD_PX = 64;

export function MessageList({ conversationId }: Props) {
  const { messages, streamingMessage, streamError } = useChatStore();
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

  useLayoutEffect(() => {
    if (stickToBottom) scrollToBottom("auto");
  }, [messages, streamingMessage, streamError, stickToBottom, scrollToBottom]);

  useEffect(() => {
    scrollToBottom("auto");
  }, [conversationId, scrollToBottom]);

  const hasAnything = messages.length > 0 || !!streamingMessage || !!streamError;

  const streamingAsMessage: Message | null = streamingMessage
    ? {
        ...streamingMessage,
        conversation_id: conversationId,
        tool_call_id: null,
        trace_ref: null,
        parent_run_id: null,
      }
    : null;

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list-scroll"
        className="h-full overflow-y-auto"
      >
        {!hasAnything ? (
          <div className="flex h-full items-center justify-center text-text-muted text-sm">
            Send a message to get started.
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {streamingAsMessage && (
              <MessageBubble message={streamingAsMessage} isStreaming />
            )}
            {streamError && !streamingAsMessage && (
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
          aria-label="回到最新消息"
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-[11px] text-text-muted transition-colors duration-fast hover:text-text hover:border-border-strong"
        >
          <ArrowDownIcon size={12} />
          回到最新
        </button>
      )}
    </div>
  );
}

/** Inline failure surface for a broken agent turn.
 *
 * Most "chat 没有任何反应" reports trace back to provider auth — a seed
 * provider without an API key, a typoed base_url, or a model the
 * upstream rejects. The previous failure mode was a silent `console.error`
 * inside `openStream`'s `onRunError` handler, which meant the user saw
 * their own message echoed and then nothing. Rendering this banner inline,
 * right where the assistant reply would have appeared, makes the failure
 * visible without pushing the user off to a toast or a console they never
 * open.
 */
function StreamErrorBanner({
  message,
  code,
}: {
  message: string;
  code?: string;
}) {
  const hint =
    code === "INTERNAL" || code === undefined
      ? "多半是模型凭证没配好或上游拒绝。去 /gateway 核对 provider 的 API Key 与 base_url。"
      : null;
  return (
    <div
      data-testid="message-list-stream-error"
      role="alert"
      className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger"
    >
      <div className="font-medium">助手没能完成这次回复。</div>
      <div className="mt-1 font-mono text-[11px] text-danger/80 break-all">
        {message}
        {code ? (
          <span className="ml-2 text-danger/60">[{code}]</span>
        ) : null}
      </div>
      {hint && <div className="mt-1 text-[11px] text-text-muted">{hint}</div>}
    </div>
  );
}
