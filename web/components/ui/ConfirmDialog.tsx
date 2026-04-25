"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

/**
 * ConfirmDialog — 项目唯一的确认入口(Brand Blue Dual Theme · ADR 0016)
 *
 * 替代浏览器原生 `confirm()`(违反 P02:错误/危险操作必须指向下一步,
 * 原生 confirm 不能定制按钮文案/语义颜色,也与 L4 Confirmation Gate
 * 的交互语义不一致)。
 *
 * - Esc 关闭 · Enter 触发主按钮 · 打开时 autofocus 到取消(避免误删)
 * - 点击背景关闭(非 IRREVERSIBLE 场景够用;IRREVERSIBLE 依然走此组件,
 *   危险程度通过 `danger` 属性和文案表达)
 * - V2 两段式布局:icon + title + message 上;actions 下 · border-t 分隔
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
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
  const t = useTranslations("ui.confirmDialog");
  const resolvedConfirm = confirmLabel ?? t("confirm");
  const resolvedCancel = cancelLabel ?? t("cancel");
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg"
        style={{ animation: "ah-fade-up 180ms var(--ease-out) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header · icon + title + message + close */}
        <div className="flex items-start gap-3 p-6">
          <div
            className={
              danger
                ? "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger"
                : "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-muted text-primary"
            }
          >
            <Icon name={danger ? "alert-triangle" : "info"} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="confirm-title"
              className="text-base font-semibold tracking-tight text-text"
            >
              {title}
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
              {message}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-subtle hover:bg-surface-2 hover:text-text transition duration-fast disabled:opacity-40"
            aria-label={t("closeAria")}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Footer · actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/40 px-5 py-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-text-muted hover:bg-surface-2 hover:text-text transition duration-fast disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:bg-surface-2 focus-visible:text-text"
          >
            {resolvedCancel}
            <span className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[10px] text-text-subtle">
              Esc
            </span>
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? "inline-flex h-9 items-center gap-2 rounded-lg bg-danger px-4 text-sm font-semibold text-primary-fg shadow-soft-sm hover:shadow-soft hover:-translate-y-px transition duration-fast disabled:opacity-40 disabled:translate-y-0 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-danger/40"
                : "inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg shadow-soft-sm hover:shadow-glow-sm hover:-translate-y-px transition duration-fast disabled:opacity-40 disabled:translate-y-0 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
            }
          >
            {busy && (
              <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-primary-fg/30 border-t-primary-fg" />
            )}
            {busy ? t("processing") : resolvedConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
