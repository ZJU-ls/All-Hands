import type { Message } from "@/lib/protocol";
import { ToolCallCard } from "./ToolCallCard";
import { RenderSlot } from "./RenderSlot";

type Props = {
  message: Message;
  isStreaming?: boolean;
};

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";
  const showCursor = Boolean(isStreaming) && !isUser;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
          isUser ? "bg-surface-2 text-text" : "bg-surface text-text"
        }`}
      >
        {(message.content || showCursor) && (
          <p className="whitespace-pre-wrap">
            {message.content}
            {showCursor && <StreamingCursor />}
          </p>
        )}
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
