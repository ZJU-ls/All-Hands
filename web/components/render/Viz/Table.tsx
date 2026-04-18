"use client";

import { useMemo, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";

type Column = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
};

type Row = Record<string, unknown>;

export function Table({ props }: RenderProps) {
  const columns = (props.columns as Column[] | undefined) ?? [];
  const rawRowsRaw = props.rows as Row[] | undefined;
  const caption = props.caption as string | undefined;

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => {
    const rawRows = rawRowsRaw ?? [];
    if (!sortKey) return rawRows;
    const out = [...rawRows];
    out.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return out;
  }, [rawRowsRaw, sortKey, sortAsc]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-3 py-2 text-left text-xs font-semibold text-text-muted"
                  style={{ width: c.width, textAlign: c.align ?? "left" }}
                >
                  <button
                    className="flex items-center gap-1 hover:text-text transition-colors"
                    onClick={() => toggleSort(c.key)}
                    aria-label={`Sort by ${c.label}`}
                  >
                    <span>{c.label}</span>
                    <span className="text-[10px] font-mono text-text-muted">
                      {sortKey === c.key ? (sortAsc ? "↑" : "↓") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className="px-3 py-2 text-text"
                    style={{ textAlign: c.align ?? "left" }}
                  >
                    {row[c.key] == null ? "—" : String(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-6 text-center text-xs text-text-muted"
                >
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {caption && (
        <div className="px-3 py-2 text-xs text-text-muted border-t border-border">
          {caption}
        </div>
      )}
    </div>
  );
}
