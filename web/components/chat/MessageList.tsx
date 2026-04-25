"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/store";
import { MessageBubble } from "./MessageBubble";
import { Icon } from "@/components/ui/icon";
import type { Message } from "@/lib/protocol";

type Props = { conversationId: string };

/** How far from the bottom we still count the viewport as "at bottom". */
const STICK_THRESHOLD_PX = 64;

export function MessageList({ conversationId }: Props) {
  const { messages, streamingMessage, streamError, isStreaming } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Stream liveness state — drives the "处理中 · Xs" chip so users know the
  // model isn't dead even when nothing visible has changed in a while.
  // Resets on each new turn (isStreaming flip false → true).
  const [streamStartAt, setStreamStartAt] = useState<number | null>(null);
  const [lastProgressAt, setLastProgressAt] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());
  const lastSignatureRef = useRef<string>("");

  // Build a cheap "did anything change?" signature from streamingMessage.
  // Token deltas / reasoning deltas / tool-call updates all bump it; while
  // it's stable, we treat the stream as silent (likely buffering or paused
  // between tool calls) and the chip can shift to a "still waiting" tone.
  const progressSignature = streamingMessage
    ? `${streamingMessage.content.length}|${streamingMessage.reasoning?.length ?? 0}|${streamingMessage.tool_calls.length}|${streamingMessage.render_payloads.length}`
    : "";

  useEffect(() => {
    if (!isStreaming) {
      setStreamStartAt(null);
      lastSignatureRef.current = "";
      return;
    }
    if (streamStartAt === null) {
      setStreamStartAt(Date.now());
      setLastProgressAt(Date.now());
      lastSignatureRef.current = progressSignature;
    }
  }, [isStreaming, streamStartAt, progressSignature]);

  useEffect(() => {
    if (!isStreaming) return;
    if (progressSignature !== lastSignatureRef.current) {
      lastSignatureRef.current = progressSignature;
      setLastProgressAt(Date.now());
    }
  }, [progressSignature, isStreaming]);

  // 200ms ticker drives the chip's elapsed counter. Cheap (a single setState
  // per tick · no DOM thrash), and only runs while a stream is in flight.
  useEffect(() => {
    if (!isStreaming) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [isStreaming]);

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

  // Between send and first frame, `streamingMessage` is still null but the
  // user expects *some* reaction — a pending placeholder tracks that gap so
  // "像是没连接上一样" stops being the default. It also makes the pending
  // state a first-class scroll anchor so the stick-to-bottom autoscroll
  // lands the user on the breathing dots.
  const isPendingAssistant = isStreaming && !streamingMessage;

  useLayoutEffect(() => {
    if (stickToBottom) scrollToBottom("auto");
  }, [messages, streamingMessage, streamError, isPendingAssistant, stickToBottom, scrollToBottom]);

  useEffect(() => {
    scrollToBottom("auto");
  }, [conversationId, scrollToBottom]);

  const hasAnything =
    messages.length > 0 || !!streamingMessage || !!streamError || isPendingAssistant;

  // Unify historical + in-flight assistant bubbles under `message.id` keys so
  // React reconciles across the streaming → finalized transition. Previously
  // the streaming bubble was an unkeyed positional child and the finalized
  // one was keyed, which unmounted/remounted the component at finalize-time
  // and reset ReasoningBlock's `open` useState back to false — the "思考过程
  // 展示完之后会隐藏" bug.
  const renderRows: Array<{ msg: Message; streaming: boolean }> = messages.map(
    (msg) => ({ msg, streaming: false }),
  );
  if (streamingMessage) {
    renderRows.push({
      msg: {
        ...streamingMessage,
        conversation_id: conversationId,
        tool_call_id: null,
        trace_ref: null,
        parent_run_id: null,
      },
      streaming: true,
    });
  }

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="message-list-scroll"
        className="h-full overflow-y-auto"
      >
        {!hasAnything ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5">
            {renderRows.map(({ msg, streaming }) => (
              <MessageBubble key={msg.id} message={msg} isStreaming={streaming} />
            ))}
            {isPendingAssistant && <PendingAssistantBubble />}
            {streamError && !streamingMessage && (
              <StreamErrorBanner
                message={streamError.message}
                code={streamError.code}
              />
            )}
          </div>
        )}
      </div>

      {/* Stream liveness chip · always visible during a turn so the user
          can see we're alive, with elapsed seconds + a stalled-state warning
          after 8s of no new tokens. Sits above 回到最新 so they don't fight
          for the same anchor. */}
      {isStreaming && streamStartAt !== null ? (
        <StreamStatusChip
          elapsedMs={now - streamStartAt}
          silentMs={now - lastProgressAt}
        />
      ) : null}
      {!stickToBottom && hasAnything && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom("smooth");
            setStickToBottom(true);
          }}
          data-testid="jump-to-bottom"
          aria-label="回到最新消息"
          className={`absolute left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-medium text-text-muted shadow-soft-sm transition-colors duration-fast hover:text-text hover:border-border-strong hover:bg-surface-2 ${
            isStreaming ? "bottom-14" : "bottom-4"
          }`}
        >
          <Icon name="arrow-down" size={12} />
          回到最新
        </button>
      )}
    </div>
  );
}

/**
 * StreamStatusChip · always-on liveness beacon during a streaming turn.
 *
 * Shows elapsed seconds since the user hit send, with a pulsing primary
 * dot. After 8s with no new tokens / tool-call activity / render payload,
 * shifts to a warning tone + "等待响应" label so users distinguish "model
 * is thinking" from "stuck / network silent".
 *
 * Floats fixed bottom-center over the message list — visible regardless
 * of where the user is scrolled.
 */
function StreamStatusChip({
  elapsedMs,
  silentMs,
}: {
  elapsedMs: number;
  silentMs: number;
}) {
  const SILENT_WARN_MS = 8000;
  const stalled = silentMs >= SILENT_WARN_MS;
  const seconds = Math.max(0, Math.floor(elapsedMs / 100) / 10).toFixed(1);
  const silentSeconds = Math.max(0, Math.round(silentMs / 1000));
  const tone = stalled
    ? "border-warning/30 bg-warning-soft text-warning"
    : "border-primary/25 bg-primary-muted text-primary";
  const dot = stalled ? "bg-warning" : "bg-primary";
  return (
    <div
      data-testid="stream-status-chip"
      role="status"
      aria-live="polite"
      className={`absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-mono shadow-soft-sm tabular-nums transition-colors duration-base ${tone}`}
    >
      <span className="relative inline-flex h-2 w-2">
        <span className={`absolute inset-0 rounded-full ${dot} animate-pulse-ring`} />
        <span className={`absolute inset-0 rounded-full ${dot}`} />
      </span>
      <span>{stalled ? "等待响应" : "处理中"}</span>
      <span className="text-[11px] opacity-70">·</span>
      <span>{seconds}s</span>
      {stalled ? (
        <span className="ml-1 text-[10px] opacity-80">无响应 {silentSeconds}s</span>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary-muted text-primary">
          <Icon name="sparkles" size={22} />
        </div>
        <p className="text-[14px] font-medium text-text">准备就绪</p>
        <p className="mt-1 text-[12px] text-text-muted">发一条消息,开始这次对话。</p>
      </div>
    </div>
  );
}

/** Pre-first-frame placeholder. Shown the moment the user hits send, kept
 * on screen until TEXT_MESSAGE_START / REASONING_MESSAGE_START arrives. The
 * three dots cycle opacity via the shared `ah-dot` keyframe; avatar tile
 * matches the live agent bubble so the transition into real tokens doesn't
 * reflow. */
function PendingAssistantBubble() {
  return (
    <div
      data-testid="pending-assistant-bubble"
      role="status"
      aria-label="模型正在处理"
      className="flex justify-start gap-3"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-primary-fg shadow-soft-sm"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
        }}
      >
        <Icon name="sparkles" size={14} strokeWidth={2.25} />
      </span>
      <div className="rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 shadow-soft-sm">
        <span className="inline-flex items-center gap-1.5 align-middle">
          <PendingDot delay={0} />
          <PendingDot delay={160} />
          <PendingDot delay={320} />
        </span>
      </div>
    </div>
  );
}

function PendingDot({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
      style={{ animation: `ah-dot 1.2s ease-in-out ${delay}ms infinite` }}
    />
  );
}

/** Inline failure surface for a broken agent turn.
 *
 * Most "chat 没有任何反应" reports trace back to provider auth — a seed
 * provider without an API key, a typoed base_url, or a model the
 * upstream rejects. Rendering this banner inline, right where the
 * assistant reply would have appeared, makes the failure visible without
 * pushing the user off to a toast or a console they never open.
 */
function StreamErrorBanner({
  message,
  code,
}: {
  message: string;
  code?: string;
}) {
  const hint =
    code === "INTERNAL" || code === undefined
      ? "多半是模型凭证没配好或上游拒绝。去 /gateway 核对 provider 的 API Key 与 base_url。"
      : null;
  return (
    <div
      data-testid="message-list-stream-error"
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3"
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-danger/15 text-danger">
        <Icon name="alert-triangle" size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-danger">助手没能完成这次回复。</div>
        <div className="mt-1 break-all font-mono text-[11px] text-danger/80">
          {message}
          {code ? <span className="ml-2 text-danger/60">[{code}]</span> : null}
        </div>
        {hint && <div className="mt-1.5 text-[11px] text-text-muted">{hint}</div>}
      </div>
    </div>
  );
}
