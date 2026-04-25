"use client";

/**
 * ModelTestDialog · chat-like test console for one /gateway model
 * (ADR 0016 · V2 Azure Live polish).
 *
 * Structure (preserved from the pre-V2 revision — only visuals change):
 *   header — gradient icon tile · "Test · {model name}" · provider-style
 *            mono chip · close button
 *   advanced panel — collapsible sidebar of model params (system / temperature
 *            / top_p / max_tokens)
 *   transcript — V2 chat bubbles (user: primary pill · agent: surface-border
 *            pill with DotGridAvatar) · streaming cursor · reasoning foldout
 *   metrics — rounded-pill grid of latency / TTFT / tokens / tok·s
 *   error  — danger-soft card with alert-circle icon
 *   composer — shared <Composer> with focus ring + glow-on-focus via the
 *            global input styling
 *
 * Testids are 100% preserved:
 *   model-test-dialog · model-test-avatar · model-test-scroll ·
 *   model-test-transcript · model-test-thinking · model-test-reasoning ·
 *   model-test-cursor · model-test-metrics · model-test-error ·
 *   model-test-composer · model-test-clear · model-test-advanced-toggle ·
 *   model-test-jump-to-bottom
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { Composer, ThinkingToggle } from "@/components/chat/Composer";
import { BrandMark } from "@/components/brand/BrandMark";
import { Icon } from "@/components/ui/icon";
import { openStream, type StreamHandle } from "@/lib/stream-client";
import { useDismissOnEscape } from "@/lib/use-dismiss-on-escape";

const STICK_THRESHOLD_PX = 64;

// ---------------------------------------------------------------------------
// Friendly formatting — durations + token counts auto-pick the right unit.
// ---------------------------------------------------------------------------

/** Format milliseconds as the most natural compact unit:
 *    < 1s   → "732ms"
 *    < 60s  → "4.2s"
 *    < 60m  → "1m 23s"
 *    >= 1h  → "1h 5m"
 *  Sub-second precision matters when comparing fast models; once we're past
 *  a minute, seconds-level precision adds noise without insight.
 */
function fmtDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sr = Math.round(s - m * 60);
  if (m < 60) return sr === 0 ? `${m}m` : `${m}m ${sr}s`;
  const h = Math.floor(m / 60);
  const mr = m - h * 60;
  return mr === 0 ? `${h}h` : `${h}h ${mr}m`;
}

/** Format an integer count with k/M suffix once it crosses 4-digit threshold:
 *    < 10_000     → raw "1234"
 *    < 1_000_000  → "12.3k"
 *    >= 1M        → "1.20M"
 *  Keeps small counts readable as exact integers (token-level audits) while
 *  large counts collapse to readable order-of-magnitude.
 */
function fmtCount(n: number | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  if (v < 10_000) return v.toLocaleString();
  if (v < 1_000_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${(v / 1_000_000).toFixed(2)}M`;
}

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

const ERROR_KEYS: Record<ErrorCategory, string> = {
  timeout: "errorTimeout",
  auth: "errorAuth",
  rate_limit: "errorRateLimit",
  model_not_found: "errorModelNotFound",
  connection: "errorConnection",
  context_length: "errorContextLength",
  provider_error: "errorProviderError",
  unknown: "errorUnknown",
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
  const t = useTranslations("gateway.modelTest");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState(t("defaultPrompt"));
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
  const [elapsedMs, setElapsedMs] = useState(0);
  const startAtRef = useRef<number | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Reasoning-heavy models (Qwen3, DeepSeek-R1, o1…) can sit silent for 10–60s
  // before their first chunk lands. Tick an elapsed counter while loading so
  // the waiting state has visible progress — the composer alone flipping to
  // "stop" isn't enough feedback (P03/P04 long-op affordance).
  useEffect(() => {
    if (!isLoading) {
      startAtRef.current = null;
      return;
    }
    startAtRef.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      if (startAtRef.current !== null) {
        setElapsedMs(Date.now() - startAtRef.current);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [isLoading]);

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
  }, [messages, streamContent, streamReasoning, stickToBottom, scrollToBottom]);

  // 测试结束的下降沿:把滚动条拉到最底,让 metrics 卡片(latency / ttft / tokens)
  // 出现在视野中。流式过程中用户可能向上滚去看 reasoning,我们尊重那个意图;
  // 但一旦本次测试落地(metrics 或 error 到达),就视为"用户希望看到结果",
  // 哪怕 stickToBottom 已被翻成 false 也强制拉一次 —— 这是产品语义而非滚动状态机。
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    const justFinished = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;
    if (!justFinished) return;
    if (!lastRun || lastRun.streaming) return;
    // 等下一帧让 metrics / error 卡片完成挂载,再滚动 —— 否则 scrollHeight 还没把
    // 新增的 80px 算进去,会差一截。
    requestAnimationFrame(() => {
      scrollToBottom("smooth");
      setStickToBottom(true);
    });
  }, [isLoading, lastRun, scrollToBottom]);

  useEffect(() => {
    return () => streamRef.current?.abort();
  }, []);

  // ESC = 关闭对话框(测试中也允许直接关 — abort 由 unmount cleanup 接管)
  useDismissOnEscape(true, onClose);

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
                message: data.error ?? t("failure"),
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
              message: err.message || t("failure"),
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

  const modelTitle = model.display_name || model.name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        data-testid="model-test-dialog"
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-surface shadow-soft-lg overflow-hidden"
        style={{ animation: "ah-fade-up var(--dur-slow) var(--ease-out-expo) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* top primary hairline */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
        />

        <header className="px-5 pt-5 pb-4 border-b border-border flex items-start gap-3">
          <div
            aria-hidden="true"
            className="shrink-0 grid h-10 w-10 place-items-center rounded-xl text-primary-fg shadow-soft-sm"
            style={{
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
            }}
          >
            <Icon name="message-square" size={18} strokeWidth={1.75} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle shrink-0">
                {t("headerTest")}
              </span>
              <span aria-hidden="true" className="text-text-subtle shrink-0">
                ·
              </span>
              <h3
                className="text-[15px] font-semibold text-text tracking-tight truncate"
                data-testid="model-test-title"
              >
                {modelTitle}
              </h3>
            </div>
            <div className="mt-0.5 flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-sm bg-surface-2 border border-border font-mono text-[10.5px] text-text-muted truncate">
                <Icon name="terminal" size={10} className="shrink-0" />
                <span className="truncate">{model.name}</span>
              </span>
              {/* Brand glyph · resolved from model.name (qwen → qwen-color.svg,
                  kimi → moonshot-color.svg, …). Falls back to dot-grid initials
                  for unknown brands. */}
              <BrandMark
                name={modelTitle}
                size="sm"
                testId="model-test-avatar"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="shrink-0 grid h-8 w-8 place-items-center rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-fast"
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            data-testid="model-test-scroll"
            className="flex-1 overflow-y-auto px-5 py-4"
          >
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="model-test-advanced-toggle"
                aria-expanded={showAdvanced}
                className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium text-text-muted hover:text-text hover:bg-surface-2 transition-colors duration-fast"
              >
                <Icon name="settings" size={12} />
                {t("advancedToggle")}
                <Icon
                  name="chevron-down"
                  size={12}
                  className={`transition-transform duration-base ${
                    showAdvanced ? "rotate-180" : "rotate-0"
                  }`}
                />
              </button>
              {showAdvanced && (
                <div
                  className="mt-2 rounded-xl border border-border bg-surface-2/50 p-4 flex flex-col gap-3 animate-fade-up"
                  style={{ animationDuration: "var(--dur-base)" }}
                >
                  <div>
                    <label className="font-mono text-[10px] uppercase tracking-wider text-text-subtle block mb-1">
                      {t("systemPrompt")}
                    </label>
                    <textarea
                      value={system}
                      onChange={(e) => setSystem(e.target.value)}
                      rows={2}
                      placeholder={t("systemPlaceholder")}
                      className="w-full rounded-md bg-surface border border-border px-3 py-2 text-[12.5px] text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-fast"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
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
              className="flex flex-col gap-3"
              data-testid="model-test-transcript"
            >
              {messages.length === 0 && !streamContent && !streamReasoning && (
                <EmptyTranscript />
              )}
              {messages.map((m, i) => (
                <MessageRow
                  key={i}
                  role={m.role}
                  content={m.content}
                  reasoning={m.reasoning}
                />
              ))}
              {isLoading &&
                phase === "thinking" &&
                !streamContent &&
                !streamReasoning && <ThinkingPlaceholder elapsedMs={elapsedMs} />}
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
                className="mt-3 rounded-xl border border-danger/25 bg-danger-soft p-3.5 text-[12px]"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-danger/15 text-danger shrink-0">
                    <Icon name="alert-circle" size={12} strokeWidth={2} />
                  </span>
                  <span className="inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold bg-danger/15 text-danger uppercase tracking-wide">
                    {t(ERROR_KEYS[lastRun.error.category])}
                  </span>
                  {lastRun.metrics?.latencyMs !== undefined && (
                    <span className="font-mono text-[11px] text-text-muted tabular-nums">
                      {fmtDuration(lastRun.metrics.latencyMs)}
                    </span>
                  )}
                </div>
                <p className="font-mono text-[11.5px] text-danger break-all leading-relaxed">
                  {lastRun.error.message}
                </p>
              </div>
            )}
          </div>
          {!stickToBottom &&
            (messages.length > 0 || streamContent || streamReasoning) && (
              <button
                type="button"
                onClick={() => {
                  scrollToBottom("smooth");
                  setStickToBottom(true);
                }}
                data-testid="model-test-jump-to-bottom"
                aria-label={t("jumpToLatest")}
                className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 h-7 text-[11px] font-medium text-text-muted shadow-soft-sm hover:text-primary hover:border-primary/40 transition-colors duration-fast"
              >
                <Icon name="arrow-down" size={12} />
                {t("jumpToLatest")}
              </button>
            )}
        </div>

        <footer className="px-5 pb-4 pt-3 border-t border-border bg-surface flex flex-col gap-2">
          <Composer
            value={prompt}
            onChange={setPrompt}
            onSend={onSubmit}
            onAbort={onAbort}
            isStreaming={isLoading}
            placeholder={t("composerPlaceholder")}
            rows={2}
            testId="model-test-composer"
            controls={
              <>
                <ThinkingToggle
                  enabled={enableThinking}
                  onChange={setEnableThinking}
                  label={t("thinking")}
                />
                <button
                  type="button"
                  onClick={resetConversation}
                  disabled={isLoading || (messages.length === 0 && !lastRun)}
                  data-testid="model-test-clear"
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] font-medium text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition-colors duration-fast"
                >
                  <Icon name="refresh" size={11} />
                  {t("clear")}
                </button>
              </>
            }
            controlsTrailing={
              <span className="inline-flex items-center gap-1 font-mono text-text-subtle">
                <span className="px-1 py-0.5 rounded-sm bg-surface-2 border border-border text-[10px] text-text-muted">
                  ↵
                </span>
                {t("kbdSend")}
                <span aria-hidden="true" className="mx-1">
                  ·
                </span>
                <span className="px-1 py-0.5 rounded-sm bg-surface-2 border border-border text-[10px] text-text-muted">
                  ⇧↵
                </span>
                {t("kbdNewline")}
                {messages.length > 0 && (
                  <>
                    <span aria-hidden="true" className="mx-1">
                      ·
                    </span>
                    <span className="tabular-nums">{t("rounds", { n: messages.length })}</span>
                  </>
                )}
              </span>
            }
          />
        </footer>
      </div>
    </div>
  );
}

function EmptyTranscript() {
  const t = useTranslations("gateway.modelTest");
  return (
    <div className="relative rounded-xl border border-dashed border-border bg-surface-2/30 px-6 py-8 text-center overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative">
        <div
          aria-hidden="true"
          className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary mb-2"
        >
          <Icon name="sparkles" size={16} />
        </div>
        <p className="text-[12.5px] text-text">{t("emptyTitle")}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">{t("emptyHint")}</p>
      </div>
    </div>
  );
}

function ThinkingPlaceholder({ elapsedMs }: { elapsedMs: number }) {
  const t = useTranslations("gateway.modelTest");
  return (
    <div
      data-testid="model-test-thinking"
      data-role="assistant"
      data-streaming="true"
      className="flex items-start gap-2.5 mr-auto max-w-[85%]"
    >
      <div
        aria-hidden="true"
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-primary-fg shadow-soft-sm"
        style={{
          background:
            "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
        }}
      >
        <Icon name="sparkles" size={12} strokeWidth={2} />
      </div>
      <div className="flex-1 rounded-2xl rounded-tl-md border border-border bg-surface px-3.5 py-2.5 shadow-soft-sm">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle block mb-1">
          {t("assistantThinking")}
        </span>
        <span className="inline-flex items-center gap-2 text-[12.5px] text-text-muted">
          <span
            aria-hidden="true"
            className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse-ring"
          />
          <span className="italic">{t("processing")}</span>
          {elapsedMs >= 1000 && (
            <span className="ml-1 font-mono not-italic text-[10.5px] tabular-nums text-text">
              {fmtDuration(elapsedMs)}
            </span>
          )}
        </span>
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
  const t = useTranslations("gateway.modelTest");
  const isUser = role === "user";
  const hasReasoning = Boolean(reasoning && reasoning.length > 0);
  // 思考过程是否仍在生成 — 与主聊天 ReasoningBlock 对齐:仅 streaming + thinking 阶段视为"活跃"
  const reasoningStreaming = Boolean(streaming && phase === "thinking");

  if (isUser) {
    return (
      <div
        data-role={role}
        data-streaming={streaming ? "true" : undefined}
        className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-primary text-primary-fg px-4 py-2.5 text-[13px] leading-[1.55] whitespace-pre-wrap shadow-soft-sm"
      >
        {content}
      </div>
    );
  }

  return (
    <div
      data-role={role}
      data-streaming={streaming ? "true" : undefined}
      className="flex items-start gap-2.5 mr-auto max-w-[85%]"
    >
      <div
        aria-hidden="true"
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-primary-fg shadow-soft-sm"
        style={{
          background:
            "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
        }}
      >
        <Icon name="sparkles" size={12} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0 rounded-2xl rounded-tl-md border border-border bg-surface px-3.5 py-2.5 text-[13px] leading-[1.6] text-text shadow-soft-sm">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle block mb-1">
          {streaming
            ? phase === "thinking"
              ? t("assistantThinking")
              : t("assistantStreaming")
            : t("assistant")}
        </span>
        {hasReasoning && (
          <ReasoningBlock text={reasoning!} isStreaming={reasoningStreaming} />
        )}
        {content || (streaming && phase === "thinking" && !hasReasoning) ? (
          <>
            {content ? (
              <AgentMarkdown content={content} />
            ) : (
              <span className="text-text-subtle italic">{t("waitingReply")}</span>
            )}
            {streaming && (
              <span
                data-testid="model-test-cursor"
                aria-hidden="true"
                className="ml-0.5 inline-block align-baseline font-mono text-primary"
                style={{ animation: "ah-caret 1s step-end infinite" }}
              >
                ▍
              </span>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Reasoning 块视觉契约对齐主聊天 `MessageBubble.ReasoningBlock`(ADR 0016 V2 §3.19):
 *   - 容器 primary-tinted (`border-primary/20 bg-primary-muted`) 而非 surface-2
 *   - 标题用 `Icon name="brain"` + "思考过程…"(streaming 时带省略号)
 *   - 计数显示 `tokens` 而非"字"
 *   - 折叠箭头切换 `chevron-up` ↔ `chevron-down`,不用 rotate
 *   - streaming 时 240px 固定窗口 + MutationObserver 自动 pin 到底
 *   - 流式结束的下降沿自动折叠,除非用户点过(userTouched)
 *
 * 一份代码而不是 import — `MessageBubble.ReasoningBlock` 没 export,且后续这两个
 * 上下文可能各自微调,所以局部克隆比强行解耦更便宜,代价是注释里说清楚就好。
 */
function ReasoningBlock({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const t = useTranslations("gateway.modelTest");
  const [open, setOpen] = useState(isStreaming);
  const userTouched = useRef(false);
  const prevStreamingRef = useRef(isStreaming);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && !userTouched.current) {
      setOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!open || !isStreaming) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => {
      body.scrollTop = body.scrollHeight;
    });
    mo.observe(body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [open, isStreaming]);

  return (
    <div
      data-testid="model-test-reasoning"
      className="mb-2.5 rounded-lg border border-primary/20 bg-primary-muted"
    >
      <button
        type="button"
        onClick={() => {
          userTouched.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-[11px] text-primary transition-colors duration-fast hover:text-primary-hover"
        aria-expanded={open}
        data-testid="model-test-reasoning-toggle"
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon name="brain" size={12} />
          <span className="font-medium">{t("reasoningLabel")}{isStreaming ? "…" : ""}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-primary/80">
          {text.length} {t("tokensSuffix")}
          <Icon name={open ? "chevron-up" : "chevron-down"} size={10} />
        </span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          data-testid="model-test-reasoning-body"
          className={`border-t border-primary/15 px-3 py-2 text-[12px] leading-relaxed text-text-muted ${
            isStreaming ? "max-h-60 overflow-y-auto" : ""
          }`}
        >
          <AgentMarkdown
            content={text}
            className="prose prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:text-[11px] [&_code]:text-[11px]"
          />
        </div>
      )}
    </div>
  );
}

function MetricsRow({ metrics }: { metrics: TestMetrics }) {
  const t = useTranslations("modelTestMetrics");
  const showReasoningMetric =
    metrics.reasoningFirstMs !== undefined && metrics.reasoningFirstMs > 0;
  // tok i/o/t 三个数都走 fmtCount,但格式串本身要紧凑(占 1 个 chip 宽),
  // 所以小数据保留原始数字,k/M 截断只在 ≥ 10000 时启动。
  const tokIO =
    metrics.inputTokens !== undefined
      ? `${fmtCount(metrics.inputTokens)} / ${fmtCount(metrics.outputTokens ?? 0)} / ${fmtCount(metrics.totalTokens ?? 0)}`
      : "—";
  return (
    <div
      data-testid="model-test-metrics"
      className="mt-3 rounded-xl border border-border bg-surface-2/50 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2"
    >
      <MetricChip
        icon="clock"
        label={t("latency")}
        value={fmtDuration(metrics.latencyMs)}
      />
      <MetricChip
        icon="zap"
        label={showReasoningMetric ? t("ttftThinking") : t("ttft")}
        value={fmtDuration(
          showReasoningMetric ? metrics.reasoningFirstMs : metrics.ttftMs,
        )}
      />
      {showReasoningMetric ? (
        <MetricChip
          icon="zap"
          label={t("ttftAnswer")}
          value={fmtDuration(metrics.ttftMs)}
        />
      ) : (
        <MetricChip icon="database" label={t("tokIO")} value={tokIO} />
      )}
      <MetricChip
        icon="activity"
        label={t("tokPerSec")}
        value={
          metrics.tokensPerSecond !== undefined
            ? metrics.tokensPerSecond.toFixed(1)
            : "—"
        }
      />
      {showReasoningMetric && (
        <MetricChip icon="database" label={t("tokIO")} value={tokIO} />
      )}
    </div>
  );
}

function MetricChip({
  icon,
  label,
  value,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface border border-border px-2.5 py-1.5">
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded bg-primary/10 text-primary shrink-0"
      >
        <Icon name={icon} size={11} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[9px] uppercase tracking-wider text-text-subtle leading-none">
          {label}
        </div>
        <div className="mt-0.5 font-mono text-[11.5px] text-text tabular-nums truncate">
          {value}
        </div>
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
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          {label}
        </span>
        <span className="font-mono text-[11px] text-text tabular-nums">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
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
      <label className="font-mono text-[10px] uppercase tracking-wider text-text-subtle block mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-full rounded-md bg-surface border border-border px-2 h-7 font-mono text-[11.5px] text-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-fast"
      />
    </div>
  );
}
