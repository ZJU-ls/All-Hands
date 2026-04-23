"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openStream, type AgUiCallbacks, type StreamHandle } from "@/lib/stream-client";
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
    pendingResumeRequest,
    clearResumeRequest,
  } = useChatStore();

  // ADR 0014 Phase 4e · build the AG-UI stream callbacks once per render so
  // both /messages and /resume SSE consumers get the same token / tool_call
  // / render / confirmation dispatch. Extracted from the send handler so the
  // resume path (triggered by ConfirmationDialog) reuses it unchanged.
  const buildStreamCallbacks = useCallback((): AgUiCallbacks => {
    const toolCalls = new Map<string, ToolCallAccumulator>();
    return {
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
            conversationId,
            source: "polling",
          });
        } else if (name === "allhands.interrupt_required") {
          // ADR 0014 Phase 4e · LangGraph interrupt() surfaced as CUSTOM.
          // Payload shape: { interrupt_id, value: { kind, tool_call_id,
          // summary, rationale, diff? } }. We unwrap the nested value so
          // the ConfirmationDialog sees the same fields it gets for the
          // legacy polling path and can stay largely source-agnostic.
          const ev = (value ?? {}) as {
            interrupt_id?: string;
            value?: {
              tool_call_id?: string;
              summary?: string;
              rationale?: string;
              diff?: Record<string, unknown> | null;
            };
          };
          if (!ev.interrupt_id) return;
          const inner = ev.value ?? {};
          addConfirmation({
            confirmationId: ev.interrupt_id,
            toolCallId: inner.tool_call_id ?? "",
            summary: inner.summary ?? "",
            rationale: inner.rationale ?? "",
            diff: inner.diff,
            conversationId,
            source: "interrupt",
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
        finalizeStreaming(conversationId);
        streamRef.current = null;
      },
      onError: (err) => {
        setStreamError({ message: err.message || String(err) });
        cancelStreaming();
        streamRef.current = null;
      },
    };
  }, [
    conversationId,
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
    //
    // IMPORTANT (E17): always send the boolean, never omit. Omitting leaves
    // `SendMessageRequest.thinking = None` on the backend, which the runner
    // reads as "inherit provider default" — and DashScope/Qwen3 defaults to
    // `enable_thinking=true`. Result: grayed toggle, reasoning still streams.
    // Explicit `false` hits `extra_body={"enable_thinking": false}` downstream
    // and the model stops thinking for real.
    const body: Record<string, unknown> = { content, thinking };

    const handle = openStream(
      `${BASE}/api/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      buildStreamCallbacks(),
    );
    streamRef.current = handle;
  }, [
    value,
    isStreaming,
    thinking,
    conversationId,
    addMessage,
    beginTurn,
    buildStreamCallbacks,
  ]);

  // ADR 0014 Phase 4e · subscribe to resume requests from the
  // ConfirmationDialog. When the user approves/rejects an interrupt-sourced
  // confirmation, the Dialog publishes to the store; this effect opens a
  // /resume SSE and pipes it through the same callbacks as the original
  // turn so the UI sees "one continuous turn with a pause in the middle".
  useEffect(() => {
    if (!pendingResumeRequest) return;
    if (pendingResumeRequest.conversationId !== conversationId) {
      // A resume for a different conversation — not ours to handle; leave
      // the request in the store so the matching InputBar picks it up.
      return;
    }
    // beginTurn re-flips isStreaming so the user sees the pending-bubble
    // state during the resume leg (otherwise the UI looks frozen between
    // dialog close and the first continuation token).
    beginTurn();
    const handle = openStream(
      `${BASE}/api/conversations/${conversationId}/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_value: pendingResumeRequest.decision }),
      },
      buildStreamCallbacks(),
    );
    streamRef.current = handle;
    // Clear the request so the same decision doesn't double-fire on next
    // render (e.g. after a store update that isn't related to this flow).
    clearResumeRequest();
  }, [pendingResumeRequest, conversationId, beginTurn, buildStreamCallbacks, clearResumeRequest]);

  const handleAbort = useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    cancelStreaming();
  }, [cancelStreaming]);

  return (
    <div className="border-t border-border bg-bg px-4 pb-4 pt-3 flex flex-col gap-2">
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
