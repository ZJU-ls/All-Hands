"use client";

import { useCallback, useRef, useState } from "react";
import { openStream, type StreamHandle } from "@/lib/stream-client";
import { useChatStore } from "@/lib/store";
import type { RenderPayload, ToolCall, ToolCallStatus } from "@/lib/protocol";
import type { ConversationDto, EmployeeDto } from "@/lib/api";
import { Composer, ThinkingToggle } from "./Composer";
import { UsageChip } from "./UsageChip";
import { ModelOverrideChip } from "./ModelOverrideChip";

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

/**
 * Sentinel values for the per-turn override drawer. `null` means "don't
 * send this field — let the backend inherit from the employee / provider
 * default" (contract on the server-side RunOverrides: None ≡ inherit).
 * The user only ever sees numeric state in the sliders; the null state
 * lives behind the drawer's open/closed gate.
 */
type AdvancedState = {
  system: string;
  temperature: number;
  topP: number;
  maxTokens: number;
};

const DEFAULT_ADVANCED: AdvancedState = {
  system: "",
  temperature: 0.7,
  topP: 1.0,
  maxTokens: 2048,
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  // `advancedDirty` flips the first time the user edits any advanced field.
  // Before that, the drawer just displays defaults *for reference* and we
  // don't send anything — matches the server's "inherit default" contract.
  const [advancedDirty, setAdvancedDirty] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedState>(DEFAULT_ADVANCED);
  const streamRef = useRef<StreamHandle | null>(null);
  const {
    isStreaming,
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

  const patchAdvanced = useCallback((patch: Partial<AdvancedState>) => {
    setAdvancedDirty(true);
    setAdvanced((a) => ({ ...a, ...patch }));
  }, []);

  const handleSend = useCallback(() => {
    if (!value.trim() || isStreaming) return;
    const content = value.trim();
    setValue("");

    setStreamError(null);
    addMessage({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: "user",
      content,
      tool_calls: [],
      render_payloads: [],
      created_at: new Date().toISOString(),
    });

    // Build the POST body. Always include `thinking` when the toggle is on
    // (it's a per-turn action the user explicitly chose); only include
    // temperature / top_p / max_tokens / system_override when the user has
    // actively touched the advanced drawer. Bare-default fields stay
    // omitted so the backend inherits the employee's defaults.
    const body: Record<string, unknown> = { content };
    if (thinking) body.thinking = true;
    if (advancedDirty) {
      body.temperature = advanced.temperature;
      body.top_p = advanced.topP;
      body.max_tokens = advanced.maxTokens;
      if (advanced.system.trim()) body.system_override = advanced.system.trim();
    }

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
    advancedDirty,
    advanced,
    conversationId,
    addMessage,
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
      {showAdvanced && (
        <AdvancedDrawer
          value={advanced}
          onChange={patchAdvanced}
          onReset={() => {
            setAdvanced(DEFAULT_ADVANCED);
            setAdvancedDirty(false);
          }}
          dirty={advancedDirty}
          disabled={isStreaming}
        />
      )}
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
            <AdvancedToggle
              open={showAdvanced}
              onToggle={() => setShowAdvanced((v) => !v)}
              dirty={advancedDirty}
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
          </div>
        }
        controlsTrailing={<span className="font-mono">↵ 发送 · ⇧↵ 换行</span>}
      />
    </div>
  );
}

function AdvancedToggle({
  open,
  onToggle,
  dirty,
  disabled,
}: {
  open: boolean;
  onToggle: () => void;
  dirty: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      data-testid="composer-advanced-toggle"
      data-state={open ? "open" : "closed"}
      aria-pressed={open}
      className={`inline-flex h-6 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors duration-fast disabled:opacity-40 ${
        open
          ? "border-primary/60 bg-primary/10 text-primary"
          : "border-border bg-transparent text-text-muted hover:text-text hover:border-border-strong"
      }`}
    >
      <span aria-hidden className="font-mono">{open ? "▾" : "▸"}</span>
      高级参数{dirty ? " ·" : ""}
    </button>
  );
}

function AdvancedDrawer({
  value,
  onChange,
  onReset,
  dirty,
  disabled,
}: {
  value: AdvancedState;
  onChange: (patch: Partial<AdvancedState>) => void;
  onReset: () => void;
  dirty: boolean;
  disabled: boolean;
}) {
  return (
    <div
      data-testid="composer-advanced-drawer"
      className="rounded-md border border-border bg-bg p-3 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted">
          每次发送生效 · 未修改则沿用员工默认
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={disabled || !dirty}
          data-testid="composer-advanced-reset"
          className="text-[11px] text-text-muted hover:text-text disabled:opacity-40"
        >
          恢复默认
        </button>
      </div>
      <div>
        <label className="text-[11px] text-text-muted block mb-1">
          System prompt 覆盖（可选）
        </label>
        <textarea
          value={value.system}
          onChange={(e) => onChange({ system: e.target.value })}
          disabled={disabled}
          rows={2}
          placeholder="例：你是简洁精确的工程师助手。"
          data-testid="composer-advanced-system"
          className="w-full rounded-md bg-surface-2 border border-border px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SliderField
          label="temperature"
          value={value.temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={(v) => onChange({ temperature: v })}
          disabled={disabled}
          testId="composer-advanced-temperature"
        />
        <SliderField
          label="top_p"
          value={value.topP}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => onChange({ topP: v })}
          disabled={disabled}
          testId="composer-advanced-top-p"
        />
        <NumberField
          label="max_tokens"
          value={value.maxTokens}
          min={1}
          max={32000}
          onChange={(v) => onChange({ maxTokens: v })}
          disabled={disabled}
          testId="composer-advanced-max-tokens"
        />
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
        <span>{label}</span>
        <span className="font-mono text-text">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        data-testid={testId}
        className="w-full"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-text-muted block mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        disabled={disabled}
        data-testid={testId}
        className="w-full rounded-md bg-surface-2 border border-border px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
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
