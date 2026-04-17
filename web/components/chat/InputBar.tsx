"use client";

import { useState, useRef, useCallback } from "react";
import { sendMessage } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import type { SSEEvent, ToolCall, RenderPayload } from "@/lib/protocol";

type Props = { conversationId: string };

export function InputBar({ conversationId }: Props) {
  const [value, setValue] = useState("");
  const abortRef = useRef<AbortController | null>(null);
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

  const handleSend = useCallback(async () => {
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

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let streamingMsgId = "";

    try {
      await sendMessage(
        conversationId,
        content,
        (eventType, rawData) => {
          let data: SSEEvent;
          try {
            data = JSON.parse(rawData) as SSEEvent;
          } catch {
            return;
          }

          const kind = (data.kind ?? eventType) as string;

          if (kind === "token") {
            const ev = data as { kind: "token"; message_id: string; delta: string };
            if (!streamingMsgId) {
              streamingMsgId = ev.message_id;
              startStreaming(ev.message_id);
            }
            appendToken(ev.message_id, ev.delta);
          } else if (kind === "tool_call_start" || kind === "tool_call_end") {
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
        ctrl.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        console.error("sendMessage error:", e);
      }
      stopStreaming();
    }
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

  return (
    <div className="border-t border-border p-3">
      <div className="flex gap-2">
        <textarea
          className="flex-1 resize-none rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          rows={3}
          placeholder="Message Lead Agent…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          disabled={isStreaming}
        />
        <button
          onClick={() => void handleSend()}
          disabled={isStreaming || !value.trim()}
          className="self-end rounded-lg bg-surface-2 hover:bg-surface disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
        >
          {isStreaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
