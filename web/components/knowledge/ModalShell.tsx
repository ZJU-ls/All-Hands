/**
 * ModalShell — fixed-position centred modal used by Create KB / Url ingest /
 * Bulk tag flows. Trivial chrome (header + body + optional footer) so each
 * concrete modal only writes its own form.
 */

"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

export function ModalShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useTranslations("knowledge.modal");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-subtle hover:text-text"
            aria-label={t("closeAria")}
          >
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
