"use client";

/**
 * useUnsavedWarning · attach a beforeunload prompt while a form is dirty.
 *
 * Browsers ignore the custom message text and show their own "Leave site?"
 * dialog regardless. We only need to call `preventDefault()` and set
 * `returnValue` to opt in. Pass `false` to detach.
 *
 * Reference: Notion / Linear / GitHub PR description editors all guard
 * accidental tab close on dirty drafts.
 */

import { useEffect } from "react";

export function useUnsavedWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      // Required for Chrome/Edge to surface the dialog.
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
