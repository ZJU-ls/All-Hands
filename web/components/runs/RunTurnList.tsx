"use client";

import { useState } from "react";
import type { TurnDto, TurnToolCallDto } from "@/lib/observatory-api";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";
import { PlusIcon, MinusIcon } from "@/components/ui/icons";

export function RunTurnList({ turns }: { turns: TurnDto[] }) {
  if (turns.length === 0) {
    return (
      <p
        data-testid="run-turns-empty"
        className="px-4 py-6 text-center text-[11px] text-text-muted"
      >
        暂无轮次 · 此运行还没有产生消息
      </p>
    );
  }

  return (
    <ol
      data-testid="run-turn-list"
      className="flex flex-col gap-2 list-none p-0 m-0"
    >
      {turns.map((turn, idx) => (
        <li key={`${turn.kind}-${idx}`} data-testid={`run-turn-${turn.kind}`}>
          <TurnRow turn={turn} />
        </li>
      ))}
    </ol>
  );
}

function TurnRow({ turn }: { turn: TurnDto }) {
  switch (turn.kind) {
    case "user_input":
      return (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2">
          <p className="text-[10px] text-text-muted mb-0.5">用户</p>
          <p className="whitespace-pre-wrap text-[12px] text-text">
            {turn.content}
          </p>
        </div>
      );
    case "thinking":
      return <ThinkingTurn content={turn.content} />;
    case "tool_call":
      return <ToolCallTurn turn={turn} />;
    case "message":
      return (
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-[10px] text-text-muted mb-1">回复</p>
          <AgentMarkdown
            content={turn.content}
            className="prose prose-invert prose-xs max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
          />
        </div>
      );
  }
}

function ThinkingTurn({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-text-muted hover:text-text transition-colors duration-base"
        aria-expanded={open}
        data-testid="run-turn-thinking-toggle"
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="font-mono">{open ? "▾" : "▸"}</span>
          思考过程
        </span>
        <span className="font-mono text-[10px]">{content.length}</span>
      </button>
      {open && (
        <div
          data-testid="run-turn-thinking-body"
          className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-text-muted"
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
  const [expanded, setExpanded] = useState(false);
  const hasResult = turn.result !== null && turn.result !== undefined;
  const statusColor = turn.error
    ? "text-danger"
    : hasResult
      ? "text-success"
      : "text-text-muted";
  const statusLabel = turn.error ? "failed" : hasResult ? "done" : "pending";

  return (
    <div className="rounded-md border border-border bg-bg text-[11px] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 transition-colors duration-base"
      >
        <span className="font-mono text-[10px] text-text-subtle shrink-0">fn</span>
        <span className="font-mono text-text truncate">{turn.name}</span>
        <span className={`ml-auto font-medium ${statusColor}`}>{statusLabel}</span>
        <span className="text-text-muted shrink-0" aria-hidden="true">
          {expanded ? <MinusIcon size={12} /> : <PlusIcon size={12} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <p className="text-text-muted mb-0.5">args</p>
            <pre className="text-text whitespace-pre-wrap break-all text-[10px]">
              {JSON.stringify(turn.args, null, 2)}
            </pre>
          </div>
          {hasResult && (
            <div>
              <p className="text-text-muted mb-0.5">result</p>
              <pre className="text-text whitespace-pre-wrap break-all text-[10px]">
                {JSON.stringify(turn.result, null, 2)}
              </pre>
            </div>
          )}
          {turn.error && (
            <div>
              <p className="text-danger mb-0.5">error</p>
              <pre className="text-danger whitespace-pre-wrap text-[10px]">
                {turn.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
