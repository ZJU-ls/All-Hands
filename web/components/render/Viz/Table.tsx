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
  const rawColumns = props.columns;
  const columns = useMemo<Column[]>(() => {
    if (!Array.isArray(rawColumns)) return [];
    return (rawColumns as Column[]).filter(
      (c): c is Column =>
        !!c && typeof c.key === "string" && typeof c.label === "string",
    );
  }, [rawColumns]);
  const rawRowsRaw = Array.isArray(props.rows) ? (props.rows as Row[]) : undefined;
  const caption = typeof props.caption === "string" ? props.caption : undefined;

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

  // Auto-right-align columns that look numeric, so untagged columns stop
  // drifting left. We sample up to the first 8 rows per column — cheap,
  // doesn't need a pydantic-style explicit type hint from the agent.
  const autoAlign = useMemo(() => {
    const m = new Map<string, "left" | "right">();
    const sampleRows = rawRowsRaw?.slice(0, 8) ?? [];
    for (const c of columns) {
      if (c.align) continue;
      const vals = sampleRows.map((r) => r[c.key]).filter((v) => v != null);
      const allNumeric =
        vals.length > 0 &&
        vals.every(
          (v) =>
            typeof v === "number" ||
            (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))),
        );
      if (allNumeric) m.set(c.key, "right");
    }
    return m;
  }, [columns, rawRowsRaw]);

  function alignFor(c: Column): "left" | "right" | "center" {
    return c.align ?? autoAlign.get(c.key) ?? "left";
  }

  return (
    <div
      className="rounded-lg border border-border bg-bg overflow-hidden transition-colors duration-base hover:border-border-strong"
      style={{ animation: "ah-fade-up var(--dur-mid) var(--ease-out)" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              {columns.map((c) => {
                const align = alignFor(c);
                const isSorted = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    className="sticky top-0 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider bg-surface-2 text-text-muted border-b border-border"
                    style={{ width: c.width, textAlign: align }}
                  >
                    <button
                      className={`inline-flex items-center gap-1 hover:text-text transition-colors duration-fast ${
                        isSorted ? "text-primary" : ""
                      }`}
                      onClick={() => toggleSort(c.key)}
                      aria-label={`Sort by ${c.label}`}
                    >
                      <span>{c.label}</span>
                      <span className="text-[10px] font-mono">
                        {isSorted ? (sortAsc ? "↑" : "↓") : "·"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="group transition-colors duration-fast hover:bg-surface-hover"
              >
                {columns.map((c) => {
                  const align = alignFor(c);
                  const raw = row[c.key];
                  const isNumeric = align === "right";
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 border-b border-border last:border-r-0 ${
                        i % 2 === 1 ? "bg-surface/50" : ""
                      } ${isNumeric ? "font-mono tabular-nums text-text" : "text-text"}`}
                      style={{ textAlign: align }}
                    >
                      {raw == null ? (
                        <span className="text-text-subtle">—</span>
                      ) : (
                        String(raw)
                      )}
                    </td>
                  );
                })}
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
        <div className="px-3 py-2 text-[11px] text-text-muted border-t border-border bg-surface/40">
          {caption}
        </div>
      )}
    </div>
  );
}
