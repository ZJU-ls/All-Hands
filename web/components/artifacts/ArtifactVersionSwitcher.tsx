"use client";

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
  if (versions.length === 0) return null;
  return (
    <div
      role="tablist"
      aria-label="版本切换"
      className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2"
    >
      {versions.map((v) => {
        const active = v.version === current;
        return (
          <button
            key={v.version}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(v.version)}
            className={`inline-flex h-6 items-center rounded border px-2 font-mono text-[10px] transition-colors duration-base ${
              active
                ? "border-border-strong bg-surface-2 text-text"
                : "border-border text-text-muted hover:text-text hover:border-border-strong"
            }`}
          >
            v{v.version}
          </button>
        );
      })}
    </div>
  );
}
