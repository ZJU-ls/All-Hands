import { useEffect, useRef, useState } from "react";
import type { Message, MessageSegment, ToolCall } from "@/lib/protocol";
import { ToolCallCard } from "./ToolCallCard";
import { SystemToolLine } from "./SystemToolLine";
import { RenderSlot } from "./RenderSlot";
import { AgentMarkdown } from "./AgentMarkdown";
import { TraceChip } from "@/components/runs/TraceChip";
import { classifyToolId } from "@/lib/tool-kind";

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

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  const showCursor = Boolean(isStreaming) && !isUser;
  const hasReasoning = !isUser && !!message.reasoning && message.reasoning.length > 0;
  const hasSegments = !isUser && Array.isArray(message.segments) && message.segments.length > 0;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
          isUser ? "bg-surface-2 text-text" : "bg-surface text-text"
        }`}
      >
        {hasReasoning && (
          <ReasoningBlock
            text={message.reasoning ?? ""}
            isStreaming={Boolean(isStreaming) && !message.content}
          />
        )}
        {hasSegments ? (
          <SegmentedBody
            message={message}
            showCursor={showCursor}
          />
        ) : (
          <LegacyBody
            message={message}
            isUser={isUser}
            showCursor={showCursor}
          />
        )}
        {!isUser && message.parent_run_id && (
          <div className="mt-1.5 flex justify-end">
            <TraceChip runId={message.parent_run_id} variant="link" />
          </div>
        )}
      </div>
    </div>
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
    <div className="flex flex-col gap-2">
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
 * Legacy rendering path for user messages and historical assistant messages
 * loaded from the DB (which don't carry `segments`). Keeps the original
 * bucketed layout so existing history doesn't regress.
 */
function LegacyBody({
  message,
  isUser,
  showCursor,
}: {
  message: Message;
  isUser: boolean;
  showCursor: boolean;
}) {
  return (
    <>
      {(message.content || showCursor) &&
        (isUser ? (
          <p className="whitespace-pre-wrap">
            {message.content}
            {showCursor && <StreamingCursor />}
          </p>
        ) : (
          <div>
            {message.content && <AgentMarkdown content={message.content} />}
            {showCursor && <StreamingCursor />}
          </div>
        ))}
      {message.tool_calls.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {message.tool_calls.filter((tc) => !isRenderToolCall(tc)).map((tc) => (
            <ToolCallNode key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}
      {message.render_payloads.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
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
 */
function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
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
      className="mb-2 rounded-md border border-border bg-surface-2"
    >
      <button
        type="button"
        onClick={() => {
          userTouched.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1 text-[11px] text-text-muted hover:text-text"
        aria-expanded={open}
        data-testid="reasoning-toggle"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="font-mono">{open ? "▾" : "▸"}</span>
          思考过程{isStreaming ? "…" : ""}
        </span>
        <span className="font-mono text-[10px]">{text.length}</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          data-testid="reasoning-body"
          className={`border-t border-border px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted ${
            isStreaming ? "max-h-60 overflow-y-auto" : ""
          }`}
        >
          <AgentMarkdown
            content={text}
            className="prose prose-invert prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:text-[10px] [&_code]:text-[10px]"
          />
        </div>
      )}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      data-testid="streaming-cursor"
      aria-hidden="true"
      className="ml-0.5 inline-block align-baseline font-mono text-text"
      style={{ animation: "ah-caret 1s step-end infinite" }}
    >
      ▍
    </span>
  );
}
