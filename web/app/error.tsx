"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function GlobalAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const tCommon = useTranslations("common");
  useEffect(() => {
    // Keep in dev console — production log pipeline can extend this later.
    console.error("[allhands] app error boundary:", error);
  }, [error]);

  return (
    <div className="h-screen w-full flex items-center justify-center bg-bg text-text p-8">
      <div className="max-w-md w-full rounded-xl border border-border bg-surface p-6">
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-sm font-semibold text-text">{t("runtimeTitle")}</h2>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-danger/10 text-danger">
            {t("runtimeBadge")}
          </span>
        </div>
        <p className="text-[12px] text-text-muted mb-3">{error.message || t("unknown")}</p>
        {error.digest && (
          <p className="font-mono text-[10px] text-text-subtle mb-4">{t("digest")} · {error.digest}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={reset}
            className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[12px] px-3 py-1.5 transition-colors duration-base"
          >
            {tCommon("retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
