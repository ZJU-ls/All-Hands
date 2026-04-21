"use client";

import { useCallback, useRef, useState } from "react";
import { openStream, type StreamHandle } from "@/lib/stream-client";
import { useChatStore } from "@/lib/store";
import type { RenderPayload, ToolCall, ToolCallStatus } from "@/lib/protocol";
import type { ConversationDto, EmployeeDto } from "@/lib/api";
import { Composer, ThinkingToggle } from "./Composer";
import { UsageChip } from "./UsageChip";
import { ModelOverrideChip } from "./ModelOverrideChip";
import { CompactChip } from "./CompactChip";

type Props = {
  conversationId: string;
  /** The employee's default model ref, used to resolve the context window
   * size for the usage chip. Omit to hide the chip. */
  employeeModelRef?: string;
  /** Conversation + employee passed through so the Composer controls can
   * host the per-conversation model override directly (picker next to the
   * thinking toggle, same surface as ChatGPT / DeepSeek). Omit to hide. */
  conversation?: ConversationDto | null;
  employee?: EmployeeDto | null;
  onConversationChange?: (next: ConversationDto) => void;
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type ToolCallAccumulator = {
  id: string;
  name: string;
  argsBuf: string;
  started: boolean;
};

export function InputBar({
  conversationId,
  employeeModelRef,
  conversation,
  employee,
  onConversationChange,
}: Props) {
  const [value, setValue] = useState("");
  const [thinking, setThinking] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);
  const {
    isStreaming,
    beginTurn,
    startStreaming,
    appendToken,
    appendReasoning,
    updateToolCall,
    addRenderPayload,
    addConfirmation,
    addMessage,
    finalizeStreaming,
    cancelStreaming,
    setStreamError,
  } = useChatStore();

  const handleSend = useCallback(() => {
    if (!value.trim() || isStreaming) return;
    const content = value.trim();
    setValue("");

    // Flip `isStreaming` now so the MessageList can paint a pending bubble
    // before the first token lands — otherwise the UI sits silent for the
    // POST round-trip + provider cold-start latency and looks broken.
    beginTurn();
    addMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      tool_calls: [],
      render_payloads: [],
      created_at: new Date().toISOString(),
    });

    // Model params (temperature / top_p / max_tokens / system override) are
    // deliberately not configurable per-turn from the chat surface — those
    // belong on the employee design page and are inherited here. The chat
    // only carries `thinking` (a per-turn user action) forward.
    const body: Record<string, unknown> = { content };
    if (thinking) body.thinking = true;

    const toolCalls = new Map<string, ToolCallAccumulator>();

    const handle = openStream(
      `${BASE}/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      {
        onTextMessageStart: (f) => {
          startStreaming(f.messageId);
        },
        onTextMessageContent: (f) => {
          appendToken(f.messageId, f.delta);
        },
        onReasoningMessageChunk: (f) => {
          appendReasoning(f.messageId, f.delta);
        },
        onToolCallStart: (f) => {
          toolCalls.set(f.toolCallId, {
            id: f.toolCallId,
            name: f.toolCallName,
            argsBuf: "",
            started: false,
          });
        },
        onToolCallArgs: (f) => {
          const acc = toolCalls.get(f.toolCallId);
          if (!acc) return;
          acc.argsBuf += f.delta;
          if (!acc.started) {
            acc.started = true;
            updateToolCall(materializeToolCall(acc, "pending"));
          }
        },
        onToolCallEnd: (f) => {
          const acc = toolCalls.get(f.toolCallId);
          if (!acc) return;
          updateToolCall(materializeToolCall(acc, "succeeded"));
        },
        onToolCallResult: (f) => {
          const acc = toolCalls.get(f.toolCallId);
          if (!acc) return;
          updateToolCall(materializeToolCall(acc, "succeeded", f.content));
        },
        onCustom: (name, value) => {
          if (name === "allhands.confirm_required") {
            const ev = (value ?? {}) as {
              confirmation_id?: string;
              tool_call_id?: string;
              summary?: string;
              rationale?: string;
              diff?: Record<string, unknown> | null;
            };
            if (!ev.confirmation_id || !ev.tool_call_id) return;
            addConfirmation({
              confirmationId: ev.confirmation_id,
              toolCallId: ev.tool_call_id,
              summary: ev.summary ?? "",
              rationale: ev.rationale ?? "",
              diff: ev.diff,
            });
          } else if (name === "allhands.render") {
            const ev = (value ?? {}) as {
              message_id?: string;
              payload?: RenderPayload;
            };
            if (!ev.message_id || !ev.payload) return;
            addRenderPayload(ev.message_id, ev.payload);
          }
        },
        onRunError: (err) => {
          // Surface the failure inline so "没有任何反应" stops being the
          // default when provider creds are missing / upstream 401s.
          // Preserve whatever the assistant managed to stream before the
          // failure — the user wants to see partial progress next to the
          // banner, not lose both signals.
          setStreamError({
            message: err.message || "助手没能完成这次回复。",
            code: err.code,
          });
          finalizeStreaming(conversationId);
        },
        onRunFinished: () => {
          finalizeStreaming(conversationId);
        },
        onDone: () => {
          // Transport EOF (happy or graceful). If RUN_FINISHED already
          // fired, finalizeStreaming is a no-op; if the server closed
          // without an explicit RUN_FINISHED (older backends), this
          // promotes the in-flight message so nothing is lost.
          finalizeStreaming(conversationId);
          streamRef.current = null;
        },
        onError: (err) => {
          setStreamError({ message: err.message || String(err) });
          cancelStreaming();
          streamRef.current = null;
        },
      },
    );
    streamRef.current = handle;
  }, [
    value,
    isStreaming,
    thinking,
    conversationId,
    addMessage,
    beginTurn,
    startStreaming,
    appendToken,
    appendReasoning,
    updateToolCall,
    addRenderPayload,
    addConfirmation,
    finalizeStreaming,
    cancelStreaming,
    setStreamError,
  ]);

  const handleAbort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    cancelStreaming();
  }, [cancelStreaming]);

  return (
    <div className="border-t border-border p-3 flex flex-col gap-2">
      <Composer
        value={value}
        onChange={setValue}
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        placeholder="输入消息…"
        rows={3}
        controls={
          <div className="flex items-center gap-2">
            <ThinkingToggle
              enabled={thinking}
              onChange={setThinking}
              disabled={isStreaming}
            />
            {conversation && employee && onConversationChange && (
              <ModelOverrideChip
                conversation={conversation}
                employee={employee}
                onConversationChange={onConversationChange}
              />
            )}
            {employeeModelRef && (
              <UsageChip
                conversationId={conversationId}
                employeeModelRef={employeeModelRef}
                disabled={isStreaming}
              />
            )}
            <CompactChip
              conversationId={conversationId}
              disabled={isStreaming}
            />
          </div>
        }
        controlsTrailing={<span className="font-mono">↵ 发送 · ⇧↵ 换行</span>}
      />
    </div>
  );
}

/** Flatten an accumulator into the canonical ToolCall shape expected by the
 * chat store. TOOL_CALL_ARGS frames ship JSON fragments; we only parse when
 * we have the whole buffer so partial deltas don't crash on malformed JSON.
 */
function materializeToolCall(
  acc: ToolCallAccumulator,
  status: ToolCallStatus,
  resultContent?: string,
): ToolCall {
  let args: Record<string, unknown> = {};
  if (acc.argsBuf) {
    try {
      args = JSON.parse(acc.argsBuf) as Record<string, unknown>;
    } catch {
      args = { _raw: acc.argsBuf };
    }
  }
  let result: unknown;
  if (resultContent !== undefined) {
    try {
      result = JSON.parse(resultContent);
    } catch {
      result = resultContent;
    }
  }
  return {
    id: acc.id,
    tool_id: acc.name,
    args,
    status,
    result,
  };
}
