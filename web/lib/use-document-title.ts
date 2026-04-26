"use client";

import { useEffect } from "react";

/**
 * Sync `document.title` to the page-supplied label · format `"{title} · allhands"`.
 * Pass `undefined` (or empty) to fall back to bare "allhands".
 *
 * Centralised so AppShell, standalone hero pages (welcome) etc. share one
 * convention — keeps browser-tab labels locale-aware automatically because
 * callers pass strings already routed through useTranslations().
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = title ? `${title} · allhands` : "allhands";
  }, [title]);
}
