"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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

  // Conversation switch · reset to bottom + force-stick. Without resetting
  // stickToBottom, an inherited `false` from the previous conversation (e.g.
  // user scrolled up before navigating away) would leave the new chat
  // anchored at the top, which is the bug reported 2026-04-25.
  useEffect(() => {
    setStickToBottom(true);
    scrollToBottom("auto");
  }, [conversationId, scrollToBottom]);

  // Initial-load settle · markdown / images / mermaid render async after
  // mount and grow the container. While we're still meant to be stuck to
  // the bottom, observe content height and keep re-scrolling so late-arriving
  // children don't leave the viewport pinned mid-conversation. Without this,
  // a chat with images near the bottom paints once at the right scrollTop,
  // images load 80ms later, scrollHeight grows by their pixel cost, and
  // scrollTop is now stale → user lands above the last message.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom) scrollToBottom("auto");
    });
    // Watch every direct child — that's where messages land. Watching the
    // container itself only fires on viewport resize, not content growth.
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [stickToBottom, scrollToBottom, messages.length]);

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

      {/* Single combined chip · merges 回到最新 with the stream liveness
          beacon so they don't stack as two competing pills.
            • streaming + at bottom        → status only (info)
            • streaming + scrolled away    → status, clickable to scroll down
            • idle      + scrolled away    → "回到最新" jump button
            • idle      + at bottom        → hidden
      */}
      {(isStreaming && streamStartAt !== null) || (!stickToBottom && hasAnything) ? (
        <ChatStatusChip
          isStreaming={isStreaming && streamStartAt !== null}
          elapsedMs={streamStartAt !== null ? now - streamStartAt : 0}
          silentMs={streamStartAt !== null ? now - lastProgressAt : 0}
          atBottom={stickToBottom}
          onJumpToBottom={() => {
            scrollToBottom("smooth");
            setStickToBottom(true);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * ChatStatusChip · single floating chip combining stream liveness +
 * jump-to-bottom. Replaces what used to be two stacked pills.
 *
 * State machine (rendered when at least one is true):
 *   • streaming  +  at bottom    → status only · plain primary chip
 *   • streaming  +  away         → status + ↓ glyph · clickable scroll
 *   • idle       +  away         → 回到最新 button · neutral surface
 *   • idle       +  at bottom    → not rendered (caller guards)
 *
 * After 8s of no new tokens / tool-call updates / render payloads while
 * streaming, the tone shifts to warning so "thinking" vs "stuck" is
 * distinguishable at a glance.
 */
function ChatStatusChip({
  isStreaming,
  elapsedMs,
  silentMs,
  atBottom,
  onJumpToBottom,
}: {
  isStreaming: boolean;
  elapsedMs: number;
  silentMs: number;
  atBottom: boolean;
  onJumpToBottom: () => void;
}) {
  const t = useTranslations("chat.messageList");
  const SILENT_WARN_MS = 8000;
  const stalled = isStreaming && silentMs >= SILENT_WARN_MS;
  const seconds = Math.max(0, Math.floor(elapsedMs / 100) / 10).toFixed(1);
  const silentSeconds = Math.max(0, Math.round(silentMs / 1000));
  const isClickable = !atBottom;

  // Three tones · streaming-stalled (warning) · streaming-fine (primary) ·
  // idle-away (neutral surface, like the old jump-to-bottom).
  const tone = stalled
    ? "border-warning/30 bg-warning-soft text-warning"
    : isStreaming
    ? "border-primary/25 bg-primary-muted text-primary"
    : "border-border bg-surface text-text-muted hover:text-text hover:border-border-strong hover:bg-surface-2";
  const dotTone = stalled ? "bg-warning" : "bg-primary";

  const labelText = isStreaming
    ? stalled
      ? t("streamStalled")
      : t("streamProcessing")
    : t("backToLatest");

  const Element = isClickable ? "button" : "div";

  return (
    <Element
      type={isClickable ? "button" : undefined}
      onClick={isClickable ? onJumpToBottom : undefined}
      data-testid={isStreaming ? "stream-status-chip" : "jump-to-bottom"}
      role={isStreaming ? "status" : undefined}
      aria-live={isStreaming ? "polite" : undefined}
      aria-label={isClickable ? t("jumpToLatest") : undefined}
      title={isClickable ? t("jumpToLatest") : undefined}
      className={`absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-mono shadow-soft-sm tabular-nums transition-colors duration-base ${tone} ${isClickable ? "cursor-pointer" : ""}`}
    >
      {isStreaming ? (
        <>
          <span className="relative inline-flex h-2 w-2">
            <span className={`absolute inset-0 rounded-full ${dotTone} animate-pulse-ring`} />
            <span className={`absolute inset-0 rounded-full ${dotTone}`} />
          </span>
          <span>{labelText}</span>
          <span className="text-[11px] opacity-70">·</span>
          <span>{seconds}s</span>
          {stalled ? (
            <span className="ml-1 text-[10px] opacity-80">
              {t("streamSilent", { s: silentSeconds })}
            </span>
          ) : null}
          {isClickable ? <Icon name="arrow-down" size={11} className="ml-1 opacity-80" /> : null}
        </>
      ) : (
        <>
          <Icon name="arrow-down" size={12} />
          <span>{labelText}</span>
        </>
      )}
    </Element>
  );
}

function EmptyState() {
  const t = useTranslations("chat.messageList");
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary-muted text-primary">
          <Icon name="sparkles" size={22} />
        </div>
        <p className="text-[14px] font-medium text-text">{t("ready")}</p>
        <p className="mt-1 text-[12px] text-text-muted">{t("emptyHint")}</p>
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
  const t = useTranslations("chat.messageList");
  return (
    <div
      data-testid="pending-assistant-bubble"
      role="status"
      aria-label={t("modelProcessing")}
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
  const t = useTranslations("chat.messageList");
  const hint =
    code === "INTERNAL" || code === undefined
      ? t("internalHint")
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
        <div className="text-[13px] font-semibold text-danger">{t("assistantFailed")}</div>
        <div className="mt-1 break-all font-mono text-[11px] text-danger/80">
          {message}
          {code ? <span className="ml-2 text-danger/60">[{code}]</span> : null}
        </div>
        {hint && <div className="mt-1.5 text-[11px] text-text-muted">{hint}</div>}
      </div>
    </div>
  );
}
