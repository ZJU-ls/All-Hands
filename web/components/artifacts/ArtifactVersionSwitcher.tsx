"use client";

/**
 * ArtifactVersionSwitcher · inline pill-tab picker for artifact versions.
 *
 * 2026-04-25 (P1): adds rollback action — clicking the rotate-ccw icon next
 * to a non-latest version writes its content forward as a new v{N+1}.
 * History is preserved (rollback is always a forward step that copies
 * older bytes); the icon is hidden on the latest version because there's
 * nothing to revert to.
 */

import { useTranslations } from "next-intl";
import type { ArtifactVersionDto } from "@/lib/artifacts-api";
import { Icon } from "@/components/ui/icon";

export function ArtifactVersionSwitcher({
  versions,
  current,
  onSelect,
  latestVersion,
  onRollback,
  rollbackBusy,
}: {
  versions: ArtifactVersionDto[];
  current: number;
  onSelect: (v: number) => void;
  /** The artifact's current latest version (versions[0].version normally). */
  latestVersion?: number;
  /** Click → roll the artifact back to that version. Undefined = no rollback chip. */
  onRollback?: (v: number) => void;
  rollbackBusy?: boolean;
}) {
  const t = useTranslations("artifacts.versionSwitcher");
  if (versions.length === 0) return null;
  const latest = latestVersion ?? versions[0]?.version ?? current;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
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
      {/* Rollback chip — only show when looking at a non-latest version. */}
      {onRollback && current !== latest && (
        <button
          type="button"
          onClick={() => onRollback(current)}
          disabled={rollbackBusy}
          data-testid="artifact-rollback"
          title={t("rollbackTitle", { current, next: latest + 1 })}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-warning/40 bg-warning/5 text-[11px] font-medium text-warning hover:bg-warning/10 disabled:opacity-50 transition-colors duration-fast"
        >
          <Icon name={rollbackBusy ? "loader" : "refresh"} size={11}
            className={rollbackBusy ? "animate-spin-slow" : ""} />
          {t("rollbackLabel", { v: current })}
        </button>
      )}
    </div>
  );
}
