"use client";

/**
 * SystemToolLine · inline visualisation for platform-owned tool calls.
 *
 * Why it exists: we classify tools into system vs external (see
 * `web/lib/tool-kind.ts` + product/06-ux-principles.md P13). External tools
 * (MCP / installed skill packs) keep the expandable `ToolCallCard` because
 * the user needs to audit what a black-box third-party call did. System
 * tools (`allhands.meta.*` / `allhands.render.*` / etc.) come with
 * well-known shapes we already render well elsewhere — a collapsible card
 * just adds noise to the transcript. This component surfaces them as a
 * compact, non-interactive line:
 *
 *   ● list_providers · 1 providers
 *   ○ create_employee · running
 *   ✕ list_skills · fetch failed
 *
 * Non-interactive on purpose: the point is "you saw Lead call it and saw
 * what came back", not "you could drill into the payload". Drilling is a
 * trace/observatory feature; the transcript should stay readable.
 */

import type { ToolCall } from "@/lib/protocol";
import { shortToolName } from "@/lib/tool-kind";
import { cn } from "@/lib/cn";

const STATUS_DOT: Record<string, string> = {
  pending: "bg-text-subtle",
  awaiting_confirmation: "bg-warning",
  running: "bg-primary",
  succeeded: "bg-success",
  failed: "bg-danger",
  rejected: "bg-warning",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "等待",
  awaiting_confirmation: "等待审批",
  running: "运行中",
  succeeded: "",
  failed: "失败",
  rejected: "被拒绝",
};

const MAX_SUMMARY_LEN = 48;

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

function countSuffix(n: number, kind: "item" | "row" | "result" = "item"): string {
  const label = kind === "row" ? "条" : kind === "result" ? "项" : "项";
  return `${n} ${label}`;
}

function summarizeResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (Array.isArray(result)) return countSuffix(result.length);
  if (typeof result !== "object") return truncate(formatValue(result));

  const obj = result as Record<string, unknown>;

  // Prefer explicit `count` / `total` / known list fields — these are the
  // conventions our system executors follow (`{providers: [...], count: N}`).
  if (typeof obj.count === "number") return countSuffix(obj.count);
  if (typeof obj.total === "number") return countSuffix(obj.total);
  for (const listKey of [
    "providers",
    "models",
    "skills",
    "mcp_servers",
    "employees",
    "items",
    "results",
    "tasks",
    "triggers",
  ]) {
    const v = obj[listKey];
    if (Array.isArray(v)) return countSuffix(v.length);
  }
  // Fall through: first kv pair as a hint.
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  const [k, v] = entries[0]!;
  return truncate(`${k}=${formatValue(v)}${entries.length > 1 ? ` +${entries.length - 1}` : ""}`);
}

export function SystemToolLine({ toolCall }: { toolCall: ToolCall }) {
  const dotColor = STATUS_DOT[toolCall.status] ?? "bg-text-subtle";
  const name = shortToolName(toolCall.tool_id);
  const statusLabel = STATUS_LABEL[toolCall.status] ?? "";
  const summary =
    toolCall.status === "succeeded"
      ? summarizeResult(toolCall.result)
      : toolCall.status === "failed" && toolCall.error
        ? truncate(toolCall.error)
        : statusLabel;

  return (
    <div
      data-testid="system-tool-line"
      data-tool-id={toolCall.tool_id}
      data-status={toolCall.status}
      className="inline-flex items-center gap-2 font-mono text-[11px] leading-relaxed"
      title={toolCall.tool_id}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full shrink-0",
          dotColor,
          toolCall.status === "running" && "animate-[ah-pulse_1.6s_ease-in-out_infinite]",
        )}
      />
      <span className="text-text-muted">{name}</span>
      {summary && (
        <>
          <span aria-hidden="true" className="text-text-subtle">·</span>
          <span
            data-testid="system-tool-summary"
            className={
              toolCall.status === "failed" ? "text-danger" : "text-text-subtle"
            }
          >
            {summary}
          </span>
        </>
      )}
    </div>
  );
}
