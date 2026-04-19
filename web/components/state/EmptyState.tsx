"use client";

/**
 * EmptyState · 空数据占位 · Linear Precise
 *
 * Visual contract (product/03-visual-design.md §3 · design-system/MASTER.md §2.14):
 * - 虚线边框卡片,mono 字符 `·` 做视觉起点(无 icon 库)。
 * - 颜色走 token:bg-surface · border-border (dashed) · text-text · text-text-muted。
 * - 可选 action 使用主按钮模板 · 无位移 · 仅颜色过渡。
 */

import type { ReactNode } from "react";

export type StateAction = {
  label: string;
  onClick: () => void;
};

export function EmptyState({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: StateAction;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      data-state="empty"
      className="rounded-md border border-dashed border-border bg-surface px-5 py-6 text-center"
    >
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle mb-2">
        · empty
      </div>
      <p className="text-[13px] text-text">{title}</p>
      {description && (
        <p className="mt-1 text-[11px] text-text-muted">{description}</p>
      )}
      {children && <div className="mt-3 text-[12px] text-text-muted">{children}</div>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 rounded bg-primary hover:bg-primary-hover text-primary-fg text-[12px] font-medium px-3 py-1.5 transition-colors duration-base"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
