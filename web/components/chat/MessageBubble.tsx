import type { Message } from "@/lib/protocol";
import { ToolCallCard } from "./ToolCallCard";
import { RenderSlot } from "./RenderSlot";

type Props = {
  message: Message;
  isStreaming?: boolean;
};

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
          isUser
            ? "bg-surface-2 text-text"
            : "bg-surface text-text"
        }`}
      >
        {message.content && (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
        {isStreaming && !message.content && (
          <span className="inline-block w-2 h-4 bg-text-muted animate-pulse" />
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
