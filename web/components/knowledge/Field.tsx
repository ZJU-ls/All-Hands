/**
 * Field — small labelled wrapper used inside KB modals / forms.
 * Pulled out of the legacy /knowledge single-page so multiple modals + the
 * settings page can share one definition.
 */

import type { ReactNode } from "react";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.15em] text-text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
