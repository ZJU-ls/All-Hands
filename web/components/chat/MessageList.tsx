"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";
import type { Message } from "@/lib/protocol";

type Props = { conversationId: string };

export function MessageList({ conversationId }: Props) {
  const { messages, streamingMessage } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  if (messages.length === 0 && !streamingMessage) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted text-sm">
        Send a message to get started.
      </div>
    );
  }

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
    <div className="flex flex-col gap-4 p-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {streamingAsMessage && (
        <MessageBubble message={streamingAsMessage} isStreaming />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
