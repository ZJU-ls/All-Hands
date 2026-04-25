"use client";

import { useMemo, useState } from "react";
import type { RenderProps } from "@/lib/component-registry";
import { Icon } from "@/components/ui/icon";
import {
  SearchInput,
  matchesQuery,
} from "@/components/render/_shared/SearchInput";
import { Toolbar } from "@/components/render/_shared/Toolbar";
import { CopyButton } from "@/components/render/_shared/CopyButton";

type Column = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string;
};

type Row = Record<string, unknown>;

/**
 * Brand-Blue V2 (ADR 0016) · data table.
 *
 * Interactions:
 *   - sort by column · click header (asc/desc/clear cycle)
 *   - free-text filter · matches across all columns
 *   - copy as CSV · entire visible table (respects sort + filter)
 *   - auto-right-align numeric columns (sampled from first 8 rows)
 */
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
  const title = typeof props.title === "string" ? props.title : undefined;

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [query, setQuery] = useState("");

  // Filter first · then sort · so result counts reflect the visible set.
  const filteredRows = useMemo(() => {
    const all = rawRowsRaw ?? [];
    if (!query) return all;
    return all.filter((row) =>
      columns.some((c) => matchesQuery(row[c.key], query)),
    );
  }, [rawRowsRaw, columns, query]);

  const rows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const out = [...filteredRows];
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
  }, [filteredRows, sortKey, sortAsc]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      // asc → desc → clear
      if (sortAsc) {
        setSortAsc(false);
      } else {
        setSortKey(null);
        setSortAsc(true);
      }
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  // Auto-right-align numeric columns so untagged numbers stop drifting
  // left-ragged in mixed tables. Samples first 8 rows, cheap.
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

  // Build CSV of currently-visible rows · respects sort + filter.
  const csv = useMemo(() => {
    const escape = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map((c) => escape(c.label)).join(",");
    const body = rows
      .map((r) => columns.map((c) => escape(r[c.key])).join(","))
      .join("\n");
    return body ? `${header}\n${body}` : header;
  }, [columns, rows]);

  const totalRows = rawRowsRaw?.length ?? 0;
  const filteredHint =
    query && rows.length !== totalRows
      ? `${rows.length}/${totalRows}`
      : undefined;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-soft-sm animate-fade-up">
      <Toolbar title={title}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="筛选行…"
          hint={filteredHint}
        />
        <CopyButton value={csv} label="复制为 CSV" />
      </Toolbar>
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
                    className={`sticky top-0 px-3 py-2 text-caption font-mono font-semibold uppercase tracking-[0.18em] bg-surface-2/60 text-text-muted border-b border-border`}
                    style={{ width: c.width, textAlign: align }}
                  >
                    <button
                      className={`inline-flex items-center gap-1 transition-colors duration-fast hover:text-text ${
                        isSorted ? "text-primary" : ""
                      }`}
                      onClick={() => toggleSort(c.key)}
                      aria-label={`Sort by ${c.label}`}
                    >
                      <span>{c.label}</span>
                      <Icon
                        name={
                          isSorted
                            ? sortAsc
                              ? "chevron-up"
                              : "chevron-down"
                            : "chevrons-up-down"
                        }
                        size={10}
                        className={isSorted ? "" : "opacity-40"}
                      />
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
                className="group transition-colors duration-fast hover:bg-surface-2/40"
              >
                {columns.map((c) => {
                  const align = alignFor(c);
                  const raw = row[c.key];
                  const isNumeric = align === "right";
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 border-b border-border ${
                        isNumeric
                          ? "font-mono tabular-nums text-text"
                          : "text-text"
                      }`}
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
                  className="px-3 py-6 text-center text-caption text-text-muted"
                >
                  {query ? "没有匹配的行" : "No rows"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {caption && (
        <div className="px-3 py-2 text-caption font-mono text-text-muted border-t border-border bg-surface-2/40">
          {caption}
        </div>
      )}
    </div>
  );
}
