"use client";

import { useEffect, useRef } from "react";

/**
 * ConfirmDialog — 项目唯一的确认入口。
 *
 * 替代浏览器原生 `confirm()`(违反 P02:错误/危险操作必须指向下一步,
 * 原生 confirm 不能定制按钮文案/语义颜色,也与 L4 Confirmation Gate
 * 的交互语义不一致)。
 *
 * - Esc 关闭 · Enter 触发主按钮 · 打开时 autofocus 到取消(避免误删)
 * - 点击背景关闭(非 IRREVERSIBLE 场景够用;IRREVERSIBLE 依然走此组件,
 *   危险程度通过 `danger` 属性和文案表达)
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !busy) onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="text-sm font-semibold text-text mb-2">
          {title}
        </h3>
        <p className="text-sm text-text-muted whitespace-pre-wrap">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text disabled:opacity-40 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? "rounded-md px-4 py-2 text-sm font-medium bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 disabled:opacity-40 transition-colors"
                : "rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition-colors"
            }
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
