"use client";

import { useEffect, useRef, useState } from "react";

export type ModelTestDialogProps = {
  model: {
    id: string;
    name: string;
    display_name: string;
  };
  onClose: () => void;
};

type Message = { role: "user" | "assistant"; content: string };

type TestMetrics = {
  latencyMs?: number;
  ttftMs?: number;
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
};

export function ModelTestDialog({ model, onClose }: ModelTestDialogProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("用一句话介绍你自己。");
  const [system, setSystem] = useState(DEFAULT_SYSTEM);
  const [temperature, setTemperature] = useState(DEFAULT_PARAMS.temperature);
  const [topP, setTopP] = useState(DEFAULT_PARAMS.top_p);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_PARAMS.max_tokens);
  const [isLoading, setIsLoading] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function runStreaming(outbound: Message) {
    const history: Message[] = [...messages, outbound];
    setMessages(history);
    setPrompt("");
    setStreamBuffer("");
    setLastRun({ streaming: true });
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const body: Record<string, unknown> = {
      messages: history,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
    };
    if (system.trim()) body.system = system.trim();

    try {
      const res = await fetch(`/api/models/${model.id}/test/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIdx: number;
        while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const { event, data } = parseSseFrame(frame);
          if (!event) continue;
          if (event === "delta") {
            acc += (data.text as string) ?? "";
            setStreamBuffer(acc);
          } else if (event === "done") {
            const final = (data.response as string) ?? acc;
            const usage = (data.usage ?? {}) as {
              input_tokens?: number;
              output_tokens?: number;
              total_tokens?: number;
            };
            setMessages([...history, { role: "assistant", content: final }]);
            setStreamBuffer("");
            setLastRun({
              streaming: false,
              metrics: {
                latencyMs: data.latency_ms as number,
                ttftMs: data.ttft_ms as number,
                tokensPerSecond: data.tokens_per_second as number,
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                totalTokens: usage.total_tokens ?? 0,
              },
            });
          } else if (event === "error") {
            setStreamBuffer("");
            setLastRun({
              streaming: false,
              error: {
                category: (data.error_category as ErrorCategory) ?? "unknown",
                message: (data.error as string) ?? "失败",
              },
              metrics: { latencyMs: data.latency_ms as number },
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setLastRun({ streaming: false });
      } else {
        setLastRun({
          streaming: false,
          error: { category: "connection", message: String(err) },
        });
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }

  function resetConversation() {
    abortRef.current?.abort();
    setMessages([]);
    setStreamBuffer("");
    setLastRun(null);
  }

  function onSubmit() {
    if (!prompt.trim() || isLoading) return;
    void runStreaming({ role: "user", content: prompt.trim() });
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
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text truncate">
              对话测试 · {model.display_name || model.name}
            </h3>
            <p className="text-xs font-mono text-text-subtle truncate mt-0.5">
              {model.name}
            </p>
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
            {messages.length === 0 && !streamBuffer && (
              <p className="text-xs text-text-subtle text-center py-4">
                输入消息后按 ⌘↵ 发送。多轮对话会保留上下文。
              </p>
            )}
            {messages.map((m, i) => (
              <MessageRow key={i} role={m.role} content={m.content} />
            ))}
            {streamBuffer && (
              <MessageRow role="assistant" content={streamBuffer} streaming />
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
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            placeholder="输入消息..."
            disabled={isLoading}
            className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary transition-colors resize-none disabled:opacity-60"
          />
          <div className="flex gap-2 items-center">
            <button
              onClick={onSubmit}
              disabled={isLoading || !prompt.trim()}
              data-testid="model-test-send"
              className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 text-sm font-medium transition-colors"
            >
              {isLoading ? "请求中…" : "发送 ⌘↵"}
            </button>
            <button
              onClick={() => abortRef.current?.abort()}
              disabled={!isLoading}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              中止
            </button>
            <button
              onClick={resetConversation}
              disabled={messages.length === 0 && !lastRun}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40 transition-colors"
            >
              清空会话
            </button>
            <span className="ml-auto text-[10px] text-text-subtle font-mono">
              {messages.length > 0 && `${messages.length} 轮`}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function MessageRow({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  const isUser = role === "user";
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
        {isUser ? "USER" : streaming ? "ASSISTANT · 流式" : "ASSISTANT"}
      </span>
      {content}
      {streaming && (
        <span className="inline-block w-1 h-3 ml-0.5 align-middle bg-primary animate-pulse" />
      )}
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: TestMetrics }) {
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
        label="ttft"
        value={metrics.ttftMs !== undefined ? `${metrics.ttftMs} ms` : "—"}
      />
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
      <Metric
        label="tok/s"
        value={
          metrics.tokensPerSecond !== undefined
            ? metrics.tokensPerSecond.toFixed(1)
            : "—"
        }
      />
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

function parseSseFrame(frame: string): {
  event: string | null;
  data: Record<string, unknown>;
} {
  let event: string | null = null;
  const dataParts: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataParts.push(line.slice(5).trim());
    }
  }
  const raw = dataParts.join("\n");
  if (!raw) return { event, data: {} };
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: { _raw: raw } };
  }
}
