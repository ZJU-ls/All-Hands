"use client";

/**
 * ArtifactVersionSwitcher · inline pill-tab picker for artifact versions.
 * V2-level (ADR 0016): pill tabs on a surface track, active tab gets
 * `bg-surface shadow-soft-sm text-primary`; inactive is `text-text-muted`.
 */

import { useTranslations } from "next-intl";
import type { ArtifactVersionDto } from "@/lib/artifacts-api";

export function ArtifactVersionSwitcher({
  versions,
  current,
  onSelect,
}: {
  versions: ArtifactVersionDto[];
  current: number;
  onSelect: (v: number) => void;
}) {
  const t = useTranslations("artifacts.versionSwitcher");
  if (versions.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label={t("ariaLabel")}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5"
    >
      {versions.map((v) => {
        const active = v.version === current;
        return (
          <button
            key={v.version}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(v.version)}
            className={`inline-flex h-6 items-center rounded-md px-2 font-mono text-[11px] font-medium transition-[background-color,color,box-shadow] duration-fast ease-out ${
              active
                ? "bg-surface text-primary shadow-soft-sm"
                : "text-text-muted hover:text-text"
            }`}
          >
            v{v.version}
          </button>
        );
      })}
    </div>
  );
}
