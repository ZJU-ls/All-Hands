import { useState } from "react";
import type { Message } from "@/lib/protocol";
import { ToolCallCard } from "./ToolCallCard";
import { RenderSlot } from "./RenderSlot";
import { AgentMarkdown } from "./AgentMarkdown";

type Props = {
  message: Message;
  isStreaming?: boolean;
};

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  const showCursor = Boolean(isStreaming) && !isUser;
  const hasReasoning = !isUser && !!message.reasoning && message.reasoning.length > 0;

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
            {message.tool_calls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
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
      </div>
    </div>
  );
}

/**
 * Collapsible thinking / reasoning transcript from thinking-capable models.
 * Rendered above the final answer, mono typography, subdued so it reads as
 * secondary context. Default-open while streaming (the user expects to see
 * progress when they explicitly opted into thinking), default-collapsed once
 * the final answer has landed (they want the answer, not the reasoning).
 */
function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(isStreaming);
  return (
    <div
      data-testid="reasoning-block"
      className="mb-2 rounded-md border border-border bg-surface-2"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <div className="border-t border-border px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
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
