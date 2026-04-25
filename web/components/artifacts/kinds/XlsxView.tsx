"use client";

/**
 * XlsxView · fetch the .xlsx blob, parse with SheetJS, render each sheet
 * as a tab + table. SheetJS is dynamic-imported so it only lands in the
 * bundle when a user actually opens an xlsx artifact (~150KB gzipped).
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArtifactTable } from "./_shared/Table";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

type Sheet = {
  name: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
};

export function XlsxView({ artifactId }: { artifactId: string }) {
  const t = useTranslations("artifacts.xlsx");
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/artifacts/${artifactId}/content`);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const buf = await res.arrayBuffer();
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const next: Sheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          if (!ws) return { name, headers: [], rows: [] };
          const aoa = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
            ws,
            { header: 1, defval: null },
          );
          if (aoa.length === 0) return { name, headers: [], rows: [] };
          const [first = [], ...rest] = aoa;
          return {
            name,
            headers: first.map((h) => (h == null ? "" : String(h))),
            rows: rest as (string | number | boolean | null)[][],
          };
        });
        if (!cancelled) setSheets(next);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  if (error) {
    return <div className="px-4 py-3 text-[12px] text-danger">{t("loadFailed", { error })}</div>;
  }
  if (!sheets) {
    return <div className="px-4 py-3 text-[12px] text-text-muted">{t("loading")}</div>;
  }
  if (sheets.length === 0) {
    return <div className="px-4 py-3 text-[12px] text-text-muted">{t("empty")}</div>;
  }

  const current = sheets[active];
  return (
    <div className="flex flex-col">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-border bg-surface-2/40 px-3 py-2">
          {sheets.map((s, i) => (
            <button
              key={`${i}-${s.name}`}
              type="button"
              onClick={() => setActive(i)}
              className={
                i === active
                  ? "rounded bg-primary-muted px-2 py-1 font-mono text-[10px] text-primary"
                  : "rounded px-2 py-1 font-mono text-[10px] text-text-muted hover:bg-surface-2 hover:text-text"
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {current ? (
        <ArtifactTable
          headers={current.headers}
          rows={current.rows}
          emptyMessage={t("empty")}
        />
      ) : null}
    </div>
  );
}
