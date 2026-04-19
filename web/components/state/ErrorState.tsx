"use client";

/**
 * ErrorState · 报错兜底 · Linear Precise
 *
 * Visual contract:
 * - 红 token(bg-danger/5 · border-danger/40 · text-danger)仅占据细边框 + 状态头,
 *   正文保持中性色方便阅读。没有 icon 库,用 mono 字符 `✕` 做视觉锚。
 * - action 按钮用 ghost-danger 风格(边框 · hover 背景)以和 primary retry 区分。
 */

import type { ReactNode } from "react";
import type { StateAction } from "./EmptyState";

export function ErrorState({
  title,
  description,
  action,
  detail,
  children,
}: {
  title: string;
  description?: string;
  action?: StateAction;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="alert"
      data-state="error"
      className="rounded-md border border-danger/40 bg-danger/5 px-4 py-3"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="font-mono text-[12px] text-danger leading-none pt-0.5 shrink-0"
        >
          ✕
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-danger">{title}</p>
          {description && (
            <p className="mt-0.5 text-[11px] text-text-muted">{description}</p>
          )}
          {detail && (
            <pre className="mt-2 font-mono text-[10px] text-text-muted whitespace-pre-wrap break-words">
              {detail}
            </pre>
          )}
          {children && <div className="mt-2 text-[12px] text-text-muted">{children}</div>}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-2 rounded border border-border text-danger hover:bg-danger/10 hover:border-danger/50 text-[11px] px-2 py-1 transition-colors duration-base"
            >
              {action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
