"use client";

/**
 * SkillFileTree · flat-list-with-indent renderer.
 *
 * Backend returns a sorted flat list of files; we derive directory headers
 * by splitting paths and rendering each unique parent as a non-clickable
 * header row. This avoids a real tree state (collapsed/expanded folders),
 * which is overkill for typical skill dirs (≤ 10-20 files, ≤ 2 levels).
 *
 * For a future deeper-nested skill someone could add real expand/collapse;
 * for now this matches Linear's flat list look and stays under 100 lines.
 */

import { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import type { SkillFileEntry } from "@/lib/skill-files-api";

type Row =
  | { kind: "dir"; path: string; depth: number }
  | { kind: "file"; path: string; depth: number; sizeBytes: number };

function buildRows(files: SkillFileEntry[]): Row[] {
  const seenDirs = new Set<string>();
  const rows: Row[] = [];
  for (const f of files) {
    const parts = f.relative_path.split("/");
    // Emit any dir headers we haven't seen yet, in order.
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/");
      if (!seenDirs.has(dirPath)) {
        seenDirs.add(dirPath);
        rows.push({ kind: "dir", path: dirPath, depth: i });
      }
    }
    rows.push({
      kind: "file",
      path: f.relative_path,
      depth: parts.length - 1,
      sizeBytes: f.size_bytes,
    });
  }
  return rows;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function SkillFileTree({
  files,
  selectedPath,
  onSelect,
  className,
}: {
  files: SkillFileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  className?: string;
}) {
  const rows = useMemo(() => buildRows(files), [files]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div data-testid="skill-file-tree" className={cn("flex flex-col gap-px", className)}>
      {rows.map((row) => {
        const indent = row.depth * 12;
        if (row.kind === "dir") {
          const name = row.path.split("/").pop() ?? row.path;
          return (
            <div
              key={`dir-${row.path}`}
              className="flex items-center gap-1.5 px-2 py-1 text-text-subtle"
              style={{ paddingLeft: `${indent + 8}px` }}
            >
              <Icon name="folder" size={11} className="shrink-0" />
              <span className="font-mono text-[11px]">{name}/</span>
            </div>
          );
        }
        const name = row.path.split("/").pop() ?? row.path;
        const isSelected = selectedPath === row.path;
        return (
          <button
            key={`file-${row.path}`}
            type="button"
            data-testid={`skill-file-row-${row.path}`}
            onClick={() => onSelect(row.path)}
            aria-pressed={isSelected}
            className={cn(
              "group flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-[background-color,color]",
              isSelected
                ? "bg-primary-muted text-text"
                : "text-text-muted hover:bg-surface-2 hover:text-text",
            )}
            style={{ paddingLeft: `${indent + 8}px` }}
          >
            <Icon
              name="file"
              size={11}
              className={cn("shrink-0", isSelected ? "text-primary" : "text-text-subtle")}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{name}</span>
            <span className="shrink-0 font-mono text-[10px] text-text-subtle">
              {formatBytes(row.sizeBytes)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
