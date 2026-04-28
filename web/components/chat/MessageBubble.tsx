import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Message, MessageSegment, ToolCall } from "@/lib/protocol";
import { ToolCallCard } from "./ToolCallCard";
import { SystemToolLine } from "./SystemToolLine";
import { RenderSlot } from "./RenderSlot";
import { AgentMarkdown } from "./AgentMarkdown";
import { TraceChip } from "@/components/runs/TraceChip";
import { classifyToolId } from "@/lib/tool-kind";
import { Icon } from "@/components/ui/icon";
import {
  attachmentContentUrl,
  attachmentThumbnailUrl,
} from "@/lib/attachments";

/**
 * Dispatch a tool call to the right renderer based on its tool_id prefix.
 *   - `allhands.*` (system) → inline `SystemToolLine`, non-interactive
 *   - everything else → expandable `ToolCallCard`
 * See product/06-ux-principles.md P13.
 */
function ToolCallNode({ toolCall }: { toolCall: ToolCall }) {
  if (isRenderToolCall(toolCall)) return null;
  if (classifyToolId(toolCall.tool_id) === "system") {
    return <SystemToolLine toolCall={toolCall} />;
  }
  return <ToolCallCard toolCall={toolCall} />;
}

type Props = {
  message: Message;
  isStreaming?: boolean;
};

/**
 * A render tool's visual IS its result — showing a `fn render_table ok …`
 * chip next to the rendered table is just noise (user feedback from the
 * "测试" conversation). We detect render tools by id prefix OR by a
 * `component`-shaped result envelope, and suppress the ToolCallCard for
 * those. Non-render (backend / meta) tool calls still get the card so the
 * user can see `list_providers`, `create_employee`, etc.
 */
function isRenderToolCall(tc: ToolCall): boolean {
  if (typeof tc.tool_id === "string" && tc.tool_id.startsWith("allhands.render.")) {
    return true;
  }
  const result = tc.result;
  if (
    result &&
    typeof result === "object" &&
    "component" in (result as Record<string, unknown>)
  ) {
    return true;
  }
  return false;
}

/**
 * MessageBubble · V2 Brand Blue dual-theme (ADR 0016).
 *
 * User bubbles are solid primary — the user's message feels like an action.
 * Agent bubbles are surface cards with a gradient avatar tile, reasoning
 * folded into a tinted block, and tool-call rows spaced as siblings of the
 * answer prose. Both bubbles share a max-prose width so dense replies stay
 * readable on wide viewports.
 */
export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  const showCursor = Boolean(isStreaming) && !isUser;
  const hasReasoning = !isUser && !!message.reasoning && message.reasoning.length > 0;
  const hasSegments = !isUser && Array.isArray(message.segments) && message.segments.length > 0;

  if (isUser) {
    const hasAttachments =
      (message.attachment_ids && message.attachment_ids.length > 0) ||
      (message.attachments && message.attachments.length > 0);
    return (
      <div className="flex justify-end">
        <div className="ml-auto max-w-[75%] rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-[14px] leading-[1.55] text-primary-fg shadow-soft-sm">
          {hasAttachments && <UserAttachments message={message} />}
          {message.content && (
            <p className="whitespace-pre-wrap">{message.content}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start gap-3">
      <AgentAvatar />
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 text-[14px] leading-[1.6] text-text shadow-soft-sm">
          {hasReasoning && (
            <ReasoningBlock
              text={message.reasoning ?? ""}
              isStreaming={Boolean(isStreaming) && !message.content}
            />
          )}
          {hasSegments ? (
            <SegmentedBody message={message} showCursor={showCursor} />
          ) : (
            <LegacyAgentBody message={message} showCursor={showCursor} />
          )}
          {/* 「已中止」 tail (Claude Code parity). Shown when the producing
              turn was cut short — user 中止 / SSE drop / mid-stream error.
              Whatever streamed before the cut is still on the message above;
              this chip just tells the reader the answer is incomplete. */}
          {!isStreaming && message.interrupted && (
            <InterruptedTail />
          )}
          {message.parent_run_id && (
            <div className="mt-2 flex justify-end">
              <TraceChip runId={message.parent_run_id} variant="link" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InterruptedTail() {
  const t = useTranslations("chat.messageBubble");
  return (
    <div
      data-testid="message-interrupted-tail"
      className="mt-3 flex items-center gap-1.5 border-t border-dashed border-warning/30 pt-2 text-[11px] text-warning"
      title={t("interruptedTitle")}
    >
      <Icon name="alert-triangle" size={11} strokeWidth={2} />
      <span>{t("interrupted")}</span>
    </div>
  );
}

/** 32×32 gradient avatar tile. 135° primary → accent matches V2 §3.19. */
function AgentAvatar() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-primary-fg shadow-soft-sm"
      style={{
        backgroundImage:
          "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
      }}
    >
      <Icon name="sparkles" size={14} strokeWidth={2.25} />
    </span>
  );
}

/**
 * Time-ordered renderer. Walks `segments` and emits text / tool / render
 * in the order they streamed. Render-tool cards are suppressed (their
 * rendered payload lands right after via a render segment).
 */
function SegmentedBody({
  message,
  showCursor,
}: {
  message: Message;
  showCursor: boolean;
}) {
  const segments = message.segments ?? [];
  const toolById = new Map(message.tool_calls.map((tc) => [tc.id, tc]));
  const lastIdx = segments.length - 1;

  const nodes = segments.map((seg, i) => {
    const isLast = i === lastIdx;
    return renderSegment({
      seg,
      toolById,
      renderPayloads: message.render_payloads,
      key: i,
      trailingCursor: isLast && showCursor,
    });
  });

  // If the last segment wasn't text but we still need a cursor (assistant
  // is about to say more after a tool call), surface the cursor standalone
  // so the user sees the turn is still live.
  const last = segments[lastIdx];
  const cursorAlreadyAttached = last?.kind === "text";
  return (
    <div className="flex flex-col gap-2.5">
      {nodes}
      {showCursor && !cursorAlreadyAttached && (
        <div>
          <StreamingCursor />
        </div>
      )}
    </div>
  );
}

function renderSegment({
  seg,
  toolById,
  renderPayloads,
  key,
  trailingCursor,
}: {
  seg: MessageSegment;
  toolById: Map<string, ToolCall>;
  renderPayloads: Message["render_payloads"];
  key: number;
  trailingCursor: boolean;
}) {
  if (seg.kind === "text") {
    return (
      <div key={`t-${key}`}>
        <AgentMarkdown content={seg.content} />
        {trailingCursor && <StreamingCursor />}
      </div>
    );
  }
  if (seg.kind === "tool_call") {
    const tc = toolById.get(seg.tool_call_id);
    if (!tc) return null;
    return <ToolCallNode key={`c-${key}`} toolCall={tc} />;
  }
  if (seg.kind === "render") {
    const payload = renderPayloads[seg.index];
    if (!payload) return null;
    return <RenderSlot key={`r-${key}`} payload={payload} />;
  }
  return null;
}

/**
 * Legacy rendering path for historical assistant messages loaded from the DB
 * (which don't carry `segments`). Keeps the original bucketed layout so
 * existing history doesn't regress.
 */
function LegacyAgentBody({
  message,
  showCursor,
}: {
  message: Message;
  showCursor: boolean;
}) {
  const t = useTranslations("chat.messageBubble");
  // Mid-stream the model can call several tools in a row without emitting any
  // text. Without an indicator the bubble collapses to a thin tool-chip strip,
  // reading as "broken / empty" — show a small typing pulse next to the
  // tool-call group so the user sees activity. Only fires while still
  // streaming AND no committed text has arrived yet AND there's at least one
  // tool_call in flight.
  const showSilentToolPulse =
    showCursor && !message.content && message.tool_calls.length > 0;
  return (
    <>
      {(message.content || showCursor) && (
        <div>
          {message.content && <AgentMarkdown content={message.content} />}
          {showCursor && <StreamingCursor />}
        </div>
      )}
      {showSilentToolPulse && (
        <div
          data-testid="agent-silent-tool-pulse"
          className="-mb-1 mt-1 inline-flex items-center gap-1.5 text-[12px] text-text-subtle"
        >
          <span className="inline-flex items-center gap-1">
            <BubbleDot delay={0} />
            <BubbleDot delay={160} />
            <BubbleDot delay={320} />
          </span>
          <span>{t("toolPulse")}</span>
        </div>
      )}
      {message.tool_calls.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {message.tool_calls
            .filter((tc) => !isRenderToolCall(tc))
            .map((tc) => (
              <ToolCallNode key={tc.id} toolCall={tc} />
            ))}
        </div>
      )}
      {message.render_payloads.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {message.render_payloads.map((rp, i) => (
            <RenderSlot key={i} payload={rp} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Collapsible thinking / reasoning transcript from thinking-capable models.
 *
 * Interaction model:
 *   - Open by default while reasoning is actively streaming — the user
 *     explicitly opted into thinking and wants to watch progress.
 *   - While streaming, the body is a fixed 240px window that auto-pins the
 *     scroll to the bottom, so 5000-char thinking transcripts don't take
 *     over the chat viewport.
 *   - Auto-collapses when reasoning ends (falling edge on `isStreaming`) so
 *     the final answer lands without a wall of deliberation pushing it off
 *     screen. The answer is what the user actually came for.
 *   - Any explicit user toggle (open→close or close→open) takes over — we
 *     stop auto-managing for the rest of the turn. Their choice wins.
 *   - Historical (post-finalize) reasoning expands to full height on demand;
 *     the fixed-window constraint only helps during live streaming.
 *
 * V2 polish: primary-tinted container with a brain icon + token count,
 * mono-typed meta. Matches the "reasoning row" language in V2 §3.19.
 */
function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const t = useTranslations("chat.messageBubble");
  const [open, setOpen] = useState(isStreaming);
  const userTouched = useRef(false);
  const prevStreamingRef = useRef(isStreaming);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Falling edge on isStreaming → auto-collapse unless the user has already
  // expressed a preference. Runs on every isStreaming change so the transition
  // is caught exactly once (subsequent equal renders are no-ops).
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && !userTouched.current) {
      setOpen(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Pin the fixed-height window to the bottom as new reasoning tokens land.
  // AgentMarkdown updates its own innerHTML asynchronously (dynamic-imports
  // `marked`), so we observe DOM mutations on the body and scroll *after* the
  // paint — a scrollTop=scrollHeight call at text-change time would fire
  // before marked had a chance to commit.
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
      data-testid="reasoning-block"
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
        data-testid="reasoning-toggle"
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon name="brain" size={12} />
          <span className="font-medium">{isStreaming ? t("thinkingProcessLive") : t("thinkingProcess")}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-primary/80">
          {text.length} tokens
          <Icon name={open ? "chevron-up" : "chevron-down"} size={10} />
        </span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          data-testid="reasoning-body"
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

function BubbleDot({ delay }: { delay: number }) {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
      style={{ animation: `ah-dot 1.2s ease-in-out ${delay}ms infinite` }}
    />
  );
}

function StreamingCursor() {
  return (
    <span
      data-testid="streaming-cursor"
      aria-hidden="true"
      className="ml-0.5 inline-block align-baseline font-mono text-primary"
      style={{ animation: "ah-caret 1s step-end infinite" }}
    >
      ▍
    </span>
  );
}


// ---- User-message attachment rendering (images grid + file chips) -------

const MAX_INLINE_IMAGES = 4;
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type AttachmentMeta = {
  id: string;
  mime: string;
  filename: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  kind: "image" | "file";
};

function UserAttachments({ message }: { message: Message }) {
  const t = useTranslations("chat.attachments");
  const [resolved, setResolved] = useState<AttachmentMeta[]>(
    () => (message.attachments ? [...message.attachments] : []),
  );
  const [lightbox, setLightbox] = useState<string | null>(null);

  // When the bubble was rehydrated from server history (no preloaded
  // attachments), fetch metadata by id so we can render thumbnails.
  useEffect(() => {
    if (resolved.length > 0) return;
    const ids = message.attachment_ids || [];
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const out: AttachmentMeta[] = [];
      for (const id of ids) {
        try {
          const r = await fetch(`${BASE}/api/attachments/${id}`);
          if (!r.ok) continue;
          out.push((await r.json()) as AttachmentMeta);
        } catch {
          // ignore
        }
      }
      if (!cancelled) setResolved(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(message.attachment_ids)]);

  const images = resolved.filter((a) => a.kind === "image" || a.mime.startsWith("image/"));
  const files = resolved.filter((a) => !(a.kind === "image" || a.mime.startsWith("image/")));

  if (images.length === 0 && files.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 space-y-2">
      {images.length > 0 && (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(images.length, 2)}, minmax(0, 1fr))`,
          }}
          data-testid="user-image-grid"
        >
          {images.slice(0, MAX_INLINE_IMAGES).map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setLightbox(img.id)}
              className="group overflow-hidden rounded-md bg-surface-2"
              title={img.filename}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachmentThumbnailUrl(img.id)}
                alt={img.filename}
                className="block max-h-48 w-full object-cover transition-transform group-hover:scale-[1.02]"
              />
            </button>
          ))}
          {images.length > MAX_INLINE_IMAGES && (
            <div className="grid place-items-center rounded-md bg-surface-2 text-[12px] text-text-muted">
              {t("morePlaceholder", { count: images.length - MAX_INLINE_IMAGES })}
            </div>
          )}
        </div>
      )}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f) => (
            <a
              key={f.id}
              href={attachmentContentUrl(f.id)}
              download={f.filename}
              title={t("downloadTitle")}
              className="flex items-center gap-2 rounded-lg border border-primary-fg/20 bg-primary-fg/5 px-2 py-1.5 text-[12px] text-primary-fg hover:bg-primary-fg/10"
            >
              <Icon name="file" size={16} />
              <div className="min-w-0 flex-1 truncate">{f.filename}</div>
              <span className="shrink-0 text-[10px] opacity-80">
                {Math.max(1, Math.round(f.size_bytes / 1024))} KB
              </span>
            </a>
          ))}
        </div>
      )}
      {lightbox && (
        <Lightbox
          src={attachmentContentUrl(lightbox)}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const t = useTranslations("chat.attachments");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-bg/90 p-8 backdrop-blur-sm"
      role="dialog"
      aria-label={t("lightboxClose")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-md object-contain shadow-soft-md"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-surface px-3 py-1 text-text"
      >
        ✕
      </button>
    </div>
  );
}
