"use client";

/**
 * RunError · tiny inline pill summarising a run failure. Kept deliberately
 * small so it can slot inside lists + headers without stealing focus.
 */

import type { RunErrorDto } from "@/lib/observatory-api";
import { Icon } from "@/components/ui/icon";

export function RunError({ error }: { error: RunErrorDto }) {
  return (
    <div
      role="alert"
      data-testid="run-error"
      className="inline-flex max-w-full items-start gap-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-caption"
    >
      <Icon name="alert-circle" size={12} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-danger">{error.kind}</span>
        <span className="mx-1 text-danger/50">·</span>
        <span className="text-text-muted break-words">{error.message}</span>
      </div>
    </div>
  );
}
