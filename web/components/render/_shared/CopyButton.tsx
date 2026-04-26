"use client";

/**
 * CopyButton · single source of "copy this to clipboard" UX across viz
 * components. Renders a compact icon button that flips to a check mark
 * for ~1.4s after a successful copy. Falls back silently on browsers
 * without `navigator.clipboard`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";

type Props = {
  value: string;
  /** Tooltip + aria-label. Defaults to translated "Copy". */
  label?: string;
  /** Visible inline text when variant="button". Falls back to `label`.
   *  Use this to keep tooltips descriptive (e.g. "复制原文") while the
   *  chip's visible text stays short (e.g. "原"). */
  short?: string;
  /** Pixel size of the icon (button is icon + padding). Default: 12. */
  size?: number;
  className?: string;
  /** Render as `inline` (no border, just hover bg) or `button` (chip). */
  variant?: "inline" | "button";
};

export function CopyButton({
  value,
  label,
  short,
  size = 12,
  className,
  variant = "inline",
}: Props) {
  const t = useTranslations("renderShared.copyButton");
  const effectiveLabel = label ?? t("label");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  const handle = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      // Surface unsupported clipboard so the silent-failure UX stops biting.
      toast.error(t("failed"), t("failedDetail"));
      return;
    }
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        toast.error(t("failed"), t("failedDetail"));
      });
  }, [value, t, toast]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const base =
    variant === "inline"
      ? "inline-flex items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
      : "inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 text-caption font-mono text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text";

  return (
    <button
      type="button"
      onClick={handle}
      aria-label={effectiveLabel}
      title={copied ? t("copied") : effectiveLabel}
      className={cn(
        base,
        variant === "inline" ? "h-6 w-6" : "h-6",
        copied ? "text-success hover:text-success" : "",
        className,
      )}
    >
      <Icon name={copied ? "check" : "copy"} size={size} />
      {variant === "button" ? (
        <span>{copied ? t("copied") : short ?? effectiveLabel}</span>
      ) : null}
    </button>
  );
}
