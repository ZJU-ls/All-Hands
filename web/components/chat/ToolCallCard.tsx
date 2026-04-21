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

const STATUS_LABEL: Record<string, string> = {
  pending: "pending",
  awaiting_confirmation: "awaiting",
  running: "running",
  succeeded: "ok",
  failed: "failed",
  rejected: "rejected",
};

const MAX_SUMMARY_LEN = 80;

function truncate(s: string, max = MAX_SUMMARY_LEN): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  // Show up to 2 keys, compact `k=v`; the expand view carries full detail.
  const pieces = entries.slice(0, 2).map(([k, v]) => `${k}=${truncate(formatValue(v), 40)}`);
  const more = entries.length > 2 ? ` +${entries.length - 2}` : "";
  return truncate(pieces.join(" · ") + more);
}

function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (Array.isArray(result)) return `${result.length} item${result.length === 1 ? "" : "s"}`;
  if (typeof result === "object") {
    const entries = Object.entries(result as Record<string, unknown>);
    // If the object is a standard paginated shape, prefer its count/total.
    const count = (result as Record<string, unknown>).count;
    const items = (result as Record<string, unknown>).items;
    if (typeof count === "number") return `${count} item${count === 1 ? "" : "s"}`;
    if (Array.isArray(items)) return `${items.length} item${items.length === 1 ? "" : "s"}`;
    const first = entries[0];
    if (!first) return "{}";
    const [k, v] = first;
    return truncate(`${k}=${formatValue(v)}${entries.length > 1 ? ` +${entries.length - 1}` : ""}`);
  }
  return truncate(formatValue(result));
}

/**
 * Inline, generic tool-call display for the chat stream.
 *
 * Surfaces three lines of information without needing to expand:
 *   1. Full tool id (so the user can tell `list_providers` from `list_skills`)
 *   2. A `key=value · key=value` summary of non-empty args (max 2 keys)
 *   3. Either a one-line result summary ("N items", first kv) or a status
 *      word ("running…", "failed"), colored by status.
 *
 * Click to expand for the pretty-printed JSON of args / result / error.
 * The rule: the default view tells you *what* the Lead is doing; expand
 * tells you *exactly what* it passed and got back.
 */
export function ToolCallCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[toolCall.status] ?? "text-text-muted";
  const statusLabel = STATUS_LABEL[toolCall.status] ?? toolCall.status;
  const argsSummary = summarizeArgs(toolCall.args);
  const resultSummary =
    toolCall.status === "succeeded" ? summarizeResult(toolCall.result) : "";

  return (
    <div
      className="rounded-lg border border-border bg-bg text-xs overflow-hidden"
      data-testid="tool-call-card"
      data-status={toolCall.status}
    >
      <button
        type="button"
        className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-2 transition-colors duration-base"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="font-mono text-[10px] text-text-subtle shrink-0 mt-0.5">fn</span>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="font-mono text-text truncate"
              data-testid="tool-call-name"
              title={toolCall.tool_id}
            >
              {toolCall.tool_id}
            </span>
            <span
              className={`ml-auto font-mono text-[10px] shrink-0 ${color}`}
              data-testid="tool-call-status"
            >
              {statusLabel}
            </span>
            <span className="text-text-muted shrink-0" aria-hidden="true">
              {expanded ? <MinusIcon size={12} /> : <PlusIcon size={12} />}
            </span>
          </div>
          {(argsSummary || resultSummary) && (
            <div className="mt-0.5 font-mono text-[10px] text-text-muted truncate">
              {argsSummary && <span data-testid="tool-call-args-summary">{argsSummary}</span>}
              {argsSummary && resultSummary && (
                <span aria-hidden="true" className="mx-1.5 text-text-subtle">→</span>
              )}
              {resultSummary && (
                <span data-testid="tool-call-result-summary" className="text-text">
                  {resultSummary}
                </span>
              )}
            </div>
          )}
        </div>
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
