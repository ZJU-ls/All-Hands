"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ToolCall } from "@/lib/protocol";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { TraceChip } from "@/components/runs/TraceChip";

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

const STATUS_BG: Record<string, string> = {
  pending: "bg-surface-2 text-text-muted",
  awaiting_confirmation: "bg-warning-soft text-warning",
  running: "bg-primary-muted text-primary",
  succeeded: "bg-success-soft text-success",
  failed: "bg-danger-soft text-danger",
  rejected: "bg-warning-soft text-warning",
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

/** Pick a Lucide icon that visually hints at the tool family. Cheap keyword
 * match on the id — not a registry, so unseen tools just fall back to the
 * neutral terminal glyph. */
function iconForToolId(toolId: string): IconName {
  const id = toolId.toLowerCase();
  if (id.includes("search") || id.includes("find")) return "search";
  if (id.includes("fetch") || id.includes("http") || id.includes("url")) return "external-link";
  if (id.includes("file") || id.includes("read") || id.includes("write")) return "file-code-2";
  if (id.includes("db") || id.includes("sql") || id.includes("query")) return "database";
  if (id.includes("spawn") || id.includes("dispatch") || id.includes("agent")) return "users";
  if (id.includes("create") || id.includes("add") || id.includes("new")) return "plus";
  if (id.includes("delete") || id.includes("remove") || id.includes("drop")) return "trash-2";
  if (id.includes("list") || id.includes("index")) return "layout-grid";
  return "terminal";
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
 *
 * V2 polish: tool-specific icon tile, soft status pill (green/red/blue),
 * running state gets a spinner that replaces the pill.
 */
export function ToolCallCard({ toolCall }: Props) {
  const t = useTranslations("chat.toolCall");
  const [expanded, setExpanded] = useState(false);
  const color = STATUS_COLOR[toolCall.status] ?? "text-text-muted";
  const statusLabel = STATUS_LABEL[toolCall.status] ?? toolCall.status;
  const statusBg = STATUS_BG[toolCall.status] ?? "bg-surface-2 text-text-muted";
  const argsSummary = summarizeArgs(toolCall.args);
  const resultSummary =
    toolCall.status === "succeeded" ? summarizeResult(toolCall.result) : "";
  const iconName = iconForToolId(toolCall.tool_id);

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-surface-2 text-[12px] transition-colors duration-fast hover:border-border-strong"
      data-testid="tool-call-card"
      data-status={toolCall.status}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-3"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span
          aria-hidden="true"
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded-md",
            toolCall.status === "running"
              ? "bg-primary-muted text-primary"
              : "bg-surface text-text-subtle",
          )}
        >
          <Icon name={iconName} size={12} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className="min-w-0 truncate font-mono text-[12px] text-text"
              data-testid="tool-call-name"
              title={toolCall.tool_id}
            >
              {toolCall.tool_id}
            </span>
            <span
              className={cn(
                "ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 font-mono text-[10px] font-medium",
                statusBg,
              )}
              data-testid="tool-call-status"
            >
              {toolCall.status === "running" ? (
                <Icon name="loader" size={10} className="animate-spin" />
              ) : toolCall.status === "succeeded" ? (
                <Icon name="check" size={10} strokeWidth={2.5} />
              ) : toolCall.status === "failed" ? (
                <Icon name="alert-circle" size={10} />
              ) : (
                <span
                  aria-hidden="true"
                  className={cn("inline-block h-1.5 w-1.5 rounded-full bg-current", color)}
                />
              )}
              {statusLabel}
            </span>
            <Icon
              name={expanded ? "chevron-up" : "chevron-down"}
              size={12}
              className="shrink-0 text-text-subtle"
            />
          </div>
          {(argsSummary || resultSummary) && (
            <div className="truncate font-mono text-[11px] text-text-muted">
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
        <div className="space-y-2.5 border-t border-border bg-surface px-3 py-2.5">
          {/* ADR 0019 C2 · subagent run_id surfaces a link into the
              observatory L3 trace page (/observatory/runs/<run_id>). Detected
              by duck-typing the result envelope; no special tool flag — any
              tool that wants its run inspectable can include run_id in its
              result. (Pre-2026-04-27 this opened a global ?trace= drawer.) */}
          {(() => {
            const subRunId =
              toolCall.result &&
              typeof toolCall.result === "object" &&
              !Array.isArray(toolCall.result)
                ? (toolCall.result as Record<string, unknown>).run_id
                : undefined;
            if (typeof subRunId !== "string" || !subRunId) return null;
            return (
              <div data-testid="tool-call-card-subrun-link">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                  {t("subagentRun")}
                </p>
                <TraceChip
                  runId={subRunId}
                  label={t("viewTrace")}
                  variant="link"
                />
              </div>
            );
          })()}
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
              args
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-text">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                result
              </p>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-surface-2 p-2 font-mono text-[11px] leading-relaxed text-text">
                {JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.error && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-danger">
                error
              </p>
              <pre className="whitespace-pre-wrap break-all rounded-md border border-danger/30 bg-danger-soft p-2 font-mono text-[11px] leading-relaxed text-danger">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
