"use client";

import { useCallback, useRef, useState } from "react";
import { openStream, type StreamHandle } from "@/lib/stream-client";
import { useChatStore } from "@/lib/store";
import type { RenderPayload, SSEEvent, ToolCall } from "@/lib/protocol";
import { Composer, ThinkingToggle } from "./Composer";

type Props = { conversationId: string };

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function InputBar({ conversationId }: Props) {
  const [value, setValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);
  const {
    isStreaming,
    startStreaming,
    appendToken,
    updateToolCall,
    addRenderPayload,
    addConfirmation,
    addMessage,
    stopStreaming,
  } = useChatStore();

  const handleSend = useCallback(() => {
    if (!value.trim() || isStreaming) return;
    const content = value.trim();
    setValue("");

    addMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      tool_calls: [],
      render_payloads: [],
      created_at: new Date().toISOString(),
    });

    let streamingMsgId = "";

    const handle = openStream(
      `${BASE}/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
      {
        tokenEvents: { token: "delta" },
        onToken: (_delta, frame) => {
          const ev = frame.data as { message_id?: string; delta?: string };
          if (!ev.message_id) return;
          if (!streamingMsgId) {
            streamingMsgId = ev.message_id;
            startStreaming(ev.message_id);
          }
          appendToken(ev.message_id, ev.delta ?? "");
        },
        onMetaEvent: (frame) => {
          const kind = (frame.data.kind as string | undefined) ?? frame.event;
          if (!kind) return;
          if (kind === "token") return;
          const data = frame.data as SSEEvent;

          if (kind === "tool_call_start" || kind === "tool_call_end") {
            const ev = data as { kind: string; tool_call: ToolCall };
            updateToolCall(ev.tool_call);
          } else if (kind === "confirm_required") {
            const ev = data as {
              kind: string;
              confirmation_id: string;
              tool_call_id: string;
              summary: string;
              rationale: string;
              diff?: Record<string, unknown> | null;
            };
            addConfirmation({
              confirmationId: ev.confirmation_id,
              toolCallId: ev.tool_call_id,
              summary: ev.summary ?? "",
              rationale: ev.rationale ?? "",
              diff: ev.diff,
            });
          } else if (kind === "render") {
            const ev = data as { kind: string; message_id: string; payload: RenderPayload };
            addRenderPayload(ev.message_id, ev.payload);
          } else if (kind === "done" || kind === "error") {
            stopStreaming();
            streamingMsgId = "";
          }
        },
        onDone: () => {
          stopStreaming();
          streamRef.current = null;
        },
        onError: (err) => {
          console.error("sendMessage error:", err);
          stopStreaming();
          streamRef.current = null;
        },
      },
    );
    streamRef.current = handle;
  }, [
    value,
    isStreaming,
    conversationId,
    addMessage,
    startStreaming,
    appendToken,
    updateToolCall,
    addRenderPayload,
    addConfirmation,
    stopStreaming,
  ]);

  const handleAbort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    stopStreaming();
  }, [stopStreaming]);

  return (
    <div className="border-t border-border p-3">
      <Composer
        value={value}
        onChange={setValue}
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        placeholder="输入消息…"
        rows={3}
        controls={
          <ThinkingToggle
            enabled={thinking}
            onChange={setThinking}
            disabled={isStreaming}
          />
        }
        controlsTrailing={<span className="font-mono">↵ 发送 · ⇧↵ 换行</span>}
      />
    </div>
  );
}
