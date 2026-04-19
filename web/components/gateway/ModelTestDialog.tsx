"use client";

import { useEffect, useRef, useState } from "react";
import { Composer, ThinkingToggle } from "@/components/chat/Composer";
import { DotGridAvatar, initialFromName } from "@/components/ui/DotGridAvatar";
import { openStream, type StreamHandle } from "@/lib/stream-client";

export type ModelTestDialogProps = {
  model: {
    id: string;
    name: string;
    display_name: string;
  };
  onClose: () => void;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
};

type TestMetrics = {
  latencyMs?: number;
  ttftMs?: number;
  reasoningFirstMs?: number;
  tokensPerSecond?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type ErrorCategory =
  | "timeout"
  | "auth"
  | "rate_limit"
  | "model_not_found"
  | "connection"
  | "context_length"
  | "provider_error"
  | "unknown";

const ERROR_LABEL: Record<ErrorCategory, string> = {
  timeout: "超时",
  auth: "认证失败",
  rate_limit: "限流",
  model_not_found: "模型不存在",
  connection: "网络不通",
  context_length: "上下文超限",
  provider_error: "供应商错误",
  unknown: "未知错误",
};

type LastRun = {
  metrics?: TestMetrics;
  error?: { category: ErrorCategory; message: string };
  streaming: boolean;
};

const DEFAULT_SYSTEM = "";
const DEFAULT_PARAMS = {
  temperature: 0.7,
  top_p: 1.0,
  max_tokens: 512,
  enable_thinking: true,
};

export function ModelTestDialog({ model, onClose }: ModelTestDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("用一句话介绍你自己。");
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [temperature, setTemperature] = useState(DEFAULT_PARAMS.temperature);
  const [topP, setTopP] = useState(DEFAULT_PARAMS.top_p);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_PARAMS.max_tokens);
  const [enableThinking, setEnableThinking] = useState(
    DEFAULT_PARAMS.enable_thinking,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const [phase, setPhase] = useState<"idle" | "thinking" | "answering">("idle");
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const streamRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    return () => streamRef.current?.abort();
  }, []);

  function runStreaming(outbound: Message) {
    const history: Message[] = [...messages, outbound];
    setMessages(history);
    setPrompt("");
    setStreamContent("");
    setStreamReasoning("");
    setPhase("thinking");
    setLastRun({ streaming: true });
    setIsLoading(true);

    const body: Record<string, unknown> = {
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      enable_thinking: enableThinking,
    };
    if (system.trim()) body.system = system.trim();

    let acc = "";
    let accReasoning = "";
    let errored = false;

    const handle = openStream(
      `/api/models/${model.id}/test/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      {
        onTextMessageChunk: (f) => {
          acc += f.delta;
          setStreamContent(acc);
          setPhase("answering");
        },
        onReasoningMessageChunk: (f) => {
          accReasoning += f.delta;
          setStreamReasoning(accReasoning);
          setPhase("thinking");
        },
        onCustom: (name, value) => {
          if (name === "allhands.model_test_metrics") {
            const data = (value ?? {}) as {
              response?: string;
              reasoning_text?: string;
              latency_ms?: number;
              ttft_ms?: number;
              reasoning_first_ms?: number;
              tokens_per_second?: number;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                total_tokens?: number;
              };
            };
            const final = data.response ?? acc;
            const finalReasoning = data.reasoning_text ?? accReasoning;
            const usage = data.usage ?? {};
            setMessages([
              ...history,
              {
                role: "assistant",
                content: final,
                reasoning: finalReasoning || undefined,
              },
            ]);
            setStreamContent("");
            setStreamReasoning("");
            setPhase("idle");
            setLastRun({
              streaming: false,
              metrics: {
                latencyMs: data.latency_ms,
                ttftMs: data.ttft_ms,
                reasoningFirstMs: data.reasoning_first_ms,
                tokensPerSecond: data.tokens_per_second,
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                totalTokens: usage.total_tokens ?? 0,
              },
            });
          } else if (name === "allhands.model_test_error") {
            errored = true;
            const data = (value ?? {}) as {
              error?: string;
              error_category?: ErrorCategory;
              latency_ms?: number;
            };
            setStreamContent("");
            setStreamReasoning("");
            setPhase("idle");
            setLastRun({
              streaming: false,
              error: {
                category: data.error_category ?? "unknown",
                message: data.error ?? "失败",
              },
              metrics: { latencyMs: data.latency_ms },
            });
          }
        },
        onRunError: (err) => {
          if (errored) return; // error CUSTOM already populated lastRun
          setStreamContent("");
          setStreamReasoning("");
          setPhase("idle");
          setLastRun({
            streaming: false,
            error: {
              category: (err.code as ErrorCategory) ?? "unknown",
              message: err.message || "失败",
            },
          });
        },
        onDone: () => {
          setIsLoading(false);
          streamRef.current = null;
        },
        onError: (err) => {
          setLastRun({
            streaming: false,
            error: { category: "connection", message: String(err) },
          });
          setPhase("idle");
          setIsLoading(false);
          streamRef.current = null;
        },
      },
    );
    streamRef.current = handle;
  }

  function resetConversation() {
    streamRef.current?.abort();
    streamRef.current = null;
    setMessages([]);
    setStreamContent("");
    setStreamReasoning("");
    setPhase("idle");
    setLastRun(null);
  }

  function onSubmit() {
    if (!prompt.trim() || isLoading) return;
    runStreaming({ role: "user", content: prompt.trim() });
  }

  function onAbort() {
    streamRef.current?.abort();
    streamRef.current = null;
    setIsLoading(false);
    setPhase("idle");
    setLastRun({ streaming: false });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        data-testid="model-test-dialog"
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 pt-4 pb-3 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <DotGridAvatar
              initial={initialFromName(model.display_name || model.name)}
              size="md"
              testId="model-test-avatar"
            />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text truncate">
                对话测试 · {model.display_name || model.name}
              </h3>
              <p className="text-xs font-mono text-text-subtle truncate mt-0.5">
                {model.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-text-muted hover:text-text text-lg leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="mb-3">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              data-testid="model-test-advanced-toggle"
              className="text-xs text-text-muted hover:text-text transition-colors"
            >
              {showAdvanced ? "▾ 高级参数" : "▸ 高级参数"}
            </button>
            {showAdvanced && (
              <div className="mt-2 rounded-md border border-border bg-bg p-3 flex flex-col gap-3">
                <div>
                  <label className="text-xs text-text-muted block mb-1">
                    System prompt
                  </label>
                  <textarea
                    value={system}
                    onChange={(e) => setSystem(e.target.value)}
                    rows={2}
                    placeholder="例：你是简洁精确的工程师助手。"
                    className="w-full rounded-md bg-surface-2 border border-border px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-primary transition-colors"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <SliderField
                    label="temperature"
                    value={temperature}
                    min={0}
                    max={2}
                    step={0.1}
                    onChange={setTemperature}
                  />
                  <SliderField
                    label="top_p"
                    value={topP}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setTopP}
                  />
                  <NumberField
                    label="max_tokens"
                    value={maxTokens}
                    onChange={setMaxTokens}
                    min={1}
                    max={32000}
                  />
                </div>
              </div>
            )}
          </div>

          <div
            className="flex flex-col gap-2 mb-3"
            data-testid="model-test-transcript"
          >
            {messages.length === 0 && !streamContent && !streamReasoning && (
              <p className="text-xs text-text-subtle text-center py-4">
                输入消息后按 ↵ 或 ⌘↵ 发送。多轮对话会保留上下文。
              </p>
            )}
            {messages.map((m, i) => (
              <MessageRow
                key={i}
                role={m.role}
                content={m.content}
                reasoning={m.reasoning}
              />
            ))}
            {(streamContent || streamReasoning) && (
              <MessageRow
                role="assistant"
                content={streamContent}
                reasoning={streamReasoning}
                streaming
                phase={phase}
              />
            )}
          </div>

          {lastRun?.metrics && !lastRun.error && (
            <MetricsRow metrics={lastRun.metrics} />
          )}

          {lastRun?.error && (
            <div
              data-testid="model-test-error"
              className="mt-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-danger/20 text-danger uppercase tracking-wide">
                  {ERROR_LABEL[lastRun.error.category]}
                </span>
                {lastRun.metrics?.latencyMs !== undefined && (
                  <span className="font-mono text-text-muted">
                    {lastRun.metrics.latencyMs} ms
                  </span>
                )}
              </div>
              <p className="font-mono text-danger break-all">
                {lastRun.error.message}
              </p>
            </div>
          )}
        </div>

        <footer className="px-5 pb-4 pt-2 border-t border-border flex flex-col gap-2">
          <Composer
            value={prompt}
            onChange={setPrompt}
            onSend={onSubmit}
            onAbort={onAbort}
            isStreaming={isLoading}
            placeholder="输入消息..."
            rows={2}
            testId="model-test-composer"
            controls={
              <>
                <ThinkingToggle
                  enabled={enableThinking}
                  onChange={setEnableThinking}
                  label="深度思考"
                />
                <button
                  type="button"
                  onClick={resetConversation}
                  disabled={isLoading || (messages.length === 0 && !lastRun)}
                  data-testid="model-test-clear"
                  className="inline-flex h-6 items-center rounded border border-border px-2 text-[11px] text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors duration-fast"
                >
                  清空会话
                </button>
              </>
            }
            controlsTrailing={
              <>
                ↵ 发送 · ⇧↵ 换行
                {messages.length > 0 ? ` · ${messages.length} 轮` : ""}
              </>
            }
          />
        </footer>
      </div>
    </div>
  );
}

function MessageRow({
  role,
  content,
  reasoning,
  streaming,
  phase,
}: {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  streaming?: boolean;
  phase?: "idle" | "thinking" | "answering";
}) {
  const isUser = role === "user";
  const [expanded, setExpanded] = useState<boolean>(
    Boolean(streaming && phase === "thinking"),
  );
  useEffect(() => {
    if (!streaming) return;
    if (phase === "thinking") setExpanded(true);
    if (phase === "answering") setExpanded(false);
  }, [streaming, phase]);

  const hasReasoning = Boolean(reasoning && reasoning.length > 0);

  return (
    <div
      data-role={role}
      data-streaming={streaming ? "true" : undefined}
      className={`rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
        isUser
          ? "bg-surface-2 text-text ml-auto max-w-[85%]"
          : "bg-bg border border-border text-text mr-auto max-w-[85%]"
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-subtle block mb-0.5">
        {isUser
          ? "USER"
          : streaming
            ? phase === "thinking"
              ? "ASSISTANT · 思考中"
              : "ASSISTANT · 流式"
            : "ASSISTANT"}
      </span>
      {hasReasoning && !isUser && (
        <div
          data-testid="model-test-reasoning"
          className="mb-2 rounded border border-border/60 bg-surface-2/60"
        >
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-medium text-text-muted hover:text-text transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  streaming && phase === "thinking"
                    ? "bg-primary"
                    : "bg-text-subtle"
                }`}
                style={
                  streaming && phase === "thinking"
                    ? { animation: "ah-pulse 1.6s ease-in-out infinite" }
                    : undefined
                }
              />
              思考过程 · {reasoning!.length} 字
            </span>
            <span className="font-mono">{expanded ? "▾" : "▸"}</span>
          </button>
          {expanded && (
            <div className="px-2 pb-2 pt-1 text-xs font-mono text-text-muted whitespace-pre-wrap border-t border-border/60 max-h-48 overflow-y-auto">
              {reasoning}
            </div>
          )}
        </div>
      )}
      {content || (streaming && phase === "thinking" && !hasReasoning) ? (
        <>
          {content || (
            <span className="text-text-subtle italic">等待回复…</span>
          )}
          {streaming && (
            <span
              data-testid="model-test-cursor"
              aria-hidden="true"
              className="ml-0.5 inline-block align-baseline font-mono text-text"
              style={{ animation: "ah-caret 1s step-end infinite" }}
            >
              ▍
            </span>
          )}
        </>
      ) : null}
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: TestMetrics }) {
  const showReasoningMetric =
    metrics.reasoningFirstMs !== undefined && metrics.reasoningFirstMs > 0;
  return (
    <div
      data-testid="model-test-metrics"
      className="mt-2 rounded-md border border-border bg-bg p-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] font-mono"
    >
      <Metric
        label="latency"
        value={metrics.latencyMs !== undefined ? `${metrics.latencyMs} ms` : "—"}
      />
      <Metric
        label={showReasoningMetric ? "ttft·thinking" : "ttft"}
        value={
          showReasoningMetric
            ? `${metrics.reasoningFirstMs} ms`
            : metrics.ttftMs !== undefined
              ? `${metrics.ttftMs} ms`
              : "—"
        }
      />
      {showReasoningMetric ? (
        <Metric
          label="ttft·answer"
          value={metrics.ttftMs !== undefined ? `${metrics.ttftMs} ms` : "—"}
        />
      ) : (
        <Metric
          label="tok in/out/total"
          value={
            metrics.inputTokens !== undefined
              ? `${metrics.inputTokens}/${metrics.outputTokens ?? 0}/${
                  metrics.totalTokens ?? 0
                }`
              : "—"
          }
        />
      )}
      <Metric
        label="tok/s"
        value={
          metrics.tokensPerSecond !== undefined
            ? metrics.tokensPerSecond.toFixed(1)
            : "—"
        }
      />
      {showReasoningMetric && (
        <Metric
          label="tok in/out/total"
          value={
            metrics.inputTokens !== undefined
              ? `${metrics.inputTokens}/${metrics.outputTokens ?? 0}/${
                  metrics.totalTokens ?? 0
                }`
              : "—"
          }
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-subtle">{label}</span>
      <span className="text-text text-right">{value}</span>
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
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
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
        className="w-full"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
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
        className="w-full rounded-md bg-surface-2 border border-border px-2 py-1 text-xs font-mono text-text focus:outline-none focus:border-primary transition-colors"
      />
    </div>
  );
}
