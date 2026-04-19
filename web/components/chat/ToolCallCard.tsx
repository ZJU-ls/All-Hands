"use client";

import { useState } from "react";
import type { ToolCall } from "@/lib/protocol";
import { PlusIcon, MinusIcon } from "@/components/ui/icons";

type Props = { toolCall: ToolCall };

const STATUS_COLOR: Record<string, string> = {
  pending: "text-text-muted",
  awaiting_confirmation: "text-warning",
  running: "text-primary",
  succeeded: "text-success",
  failed: "text-danger",
  rejected: "text-warning",
};

export function ToolCallCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[toolCall.status] ?? "text-text-muted";

  return (
    <div className="rounded-lg border border-border bg-bg text-xs overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 transition-colors duration-base"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="font-mono text-[10px] text-text-subtle shrink-0">fn</span>
        <span className="font-mono text-text truncate">
          {toolCall.tool_id.split(".").pop()}
        </span>
        <span className={`ml-auto font-medium ${color}`}>{toolCall.status}</span>
        <span className="text-text-muted shrink-0" aria-hidden="true">
          {expanded ? <MinusIcon size={12} /> : <PlusIcon size={12} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <p className="text-text-muted mb-0.5">args</p>
            <pre className="text-text whitespace-pre-wrap break-all">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <p className="text-text-muted mb-0.5">result</p>
              <pre className="text-text whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div>
              <p className="text-danger mb-0.5">error</p>
              <pre className="text-danger whitespace-pre-wrap">{toolCall.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
