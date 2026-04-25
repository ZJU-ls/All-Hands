"use client";

/**
 * RunTurnList · Brand Blue Dual Theme V2 (ADR 0016)
 *
 * Compact turn rows. Every turn carries a small status/role icon tile, a
 * mono label, and its content. Tool-call rows stay collapsible; thinking
 * rows stay collapsible. Hover lightens to surface-2.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { TurnDto, TurnToolCallDto } from "@/lib/observatory-api";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { Icon, type IconName } from "@/components/ui/icon";

export function RunTurnList({ turns }: { turns: TurnDto[] }) {
  const t = useTranslations("runs.turnList");
  if (turns.length === 0) {
    return (
      <p
        data-testid="run-turns-empty"
        className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-caption text-text-muted"
      >
        {t("empty")}
      </p>
    );
  }

  return (
    <ol
      data-testid="run-turn-list"
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {turns.map((turn, idx) => (
        <li key={`${turn.kind}-${idx}`} data-testid={`run-turn-${turn.kind}`}>
          <TurnRow turn={turn} />
        </li>
      ))}
    </ol>
  );
}

function TurnIcon({
  name,
  tone,
}: {
  name: IconName;
  tone: "user" | "worker" | "tool" | "think";
}) {
  const toneClass =
    tone === "user"
      ? "bg-surface-2 text-text"
      : tone === "worker"
        ? "bg-primary-muted text-primary"
        : tone === "tool"
          ? "bg-accent/15 text-accent"
          : "bg-surface-2 text-text-muted";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${toneClass}`}
    >
      <Icon name={name} size={12} />
    </span>
  );
}

function TurnRow({ turn }: { turn: TurnDto }) {
  const t = useTranslations("runs.turnList");
  switch (turn.kind) {
    case "user_input":
      return (
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-2">
            <TurnIcon name="user" tone="user" />
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
              {t("user")}
            </p>
          </div>
          <p className="whitespace-pre-wrap text-sm text-text">{turn.content}</p>
        </div>
      );
    case "thinking":
      return <ThinkingTurn content={turn.content} />;
    case "tool_call":
      return <ToolCallTurn turn={turn} />;
    case "message":
      return (
        <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="mb-1 flex items-center gap-2">
            <TurnIcon name="message-square" tone="worker" />
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
              {t("reply")}
            </p>
          </div>
          <AgentMarkdown
            content={turn.content}
            className="prose prose-invert prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
        </div>
      );
  }
}

function ThinkingTurn({ content }: { content: string }) {
  const t = useTranslations("runs.turnList");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-caption text-text-muted transition-colors duration-base hover:text-text hover:bg-surface-2"
        aria-expanded={open}
        data-testid="run-turn-thinking-toggle"
      >
        <TurnIcon name="brain" tone="think" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          {t("thinking")}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px]">
          {content.length}
          <Icon
            name={open ? "chevron-down" : "chevron-right"}
            size={11}
            className="text-text-subtle"
          />
        </span>
      </button>
      {open && (
        <div
          data-testid="run-turn-thinking-body"
          className="border-t border-border px-3 py-2.5 text-caption leading-relaxed text-text-muted"
        >
          <AgentMarkdown
            content={content}
            className="prose prose-invert prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:text-[10px] [&_code]:text-[10px]"
          />
        </div>
      )}
    </div>
  );
}

function ToolCallTurn({ turn }: { turn: TurnToolCallDto }) {
  const t = useTranslations("runs.turnList");
  const [expanded, setExpanded] = useState(false);
  const hasResult = turn.result !== null && turn.result !== undefined;
  const statusTone: "ok" | "err" | "wait" = turn.error
    ? "err"
    : hasResult
      ? "ok"
      : "wait";
  const statusChip =
    statusTone === "err"
      ? "border-danger/30 bg-danger-soft text-danger"
      : statusTone === "ok"
        ? "border-success/30 bg-success-soft text-success"
        : "border-border bg-surface-2 text-text-muted";
  const statusIcon: IconName =
    statusTone === "err"
      ? "alert-circle"
      : statusTone === "ok"
        ? "check-circle-2"
        : "clock";
  const statusKey =
    statusTone === "err" ? "failed" : statusTone === "ok" ? "done" : "pending";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface text-caption">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-base hover:bg-surface-2"
      >
        <TurnIcon name="terminal" tone="tool" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle shrink-0">
          {t("tool")}
        </span>
        <span className="truncate font-mono text-sm text-text">{turn.name}</span>
        <span
          className={`ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[10px] ${statusChip}`}
        >
          <Icon name={statusIcon} size={10} />
          {t(`status.${statusKey}`)}
        </span>
        <Icon
          name={expanded ? "chevron-down" : "chevron-right"}
          size={12}
          className="text-text-subtle shrink-0"
        />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border bg-surface-2/30 px-3 py-2.5">
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
              {t("args")}
            </p>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-surface p-2 text-[10px] text-text">
              {JSON.stringify(turn.args, null, 2)}
            </pre>
          </div>
          {hasResult && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                {t("result")}
              </p>
              <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-surface p-2 text-[10px] text-text">
                {JSON.stringify(turn.result, null, 2)}
              </pre>
            </div>
          )}
          {turn.error && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-danger">
                {t("error")}
              </p>
              <pre className="whitespace-pre-wrap rounded-md border border-danger/30 bg-danger-soft p-2 text-[10px] text-danger">
                {turn.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
