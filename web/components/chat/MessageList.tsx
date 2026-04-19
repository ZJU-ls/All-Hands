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
  const { messages, streamingMessage } = useChatStore();
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
  }, [messages, streamingMessage, stickToBottom, scrollToBottom]);

  useEffect(() => {
    scrollToBottom("auto");
  }, [conversationId, scrollToBottom]);

  const hasAnything = messages.length > 0 || !!streamingMessage;

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
