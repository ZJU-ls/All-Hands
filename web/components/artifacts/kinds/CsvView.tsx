"use client";

/**
 * CsvView · parse utf-8 csv text via papaparse, render as ArtifactTable.
 * Strips the BOM emitted by the backend so the first cell of the first
 * row doesn't show "﻿foo".
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Papa from "papaparse";
import { ArtifactTable } from "./_shared/Table";

export function CsvView({ content }: { content: string }) {
  const t = useTranslations("artifacts.csv");
  const [parsed, setParsed] = useState<{
    headers: string[];
    rows: string[][];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const text = content.replace(/^﻿/, "");
    const result = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
    });
    if (result.errors.length > 0 && result.data.length === 0) {
      setError(result.errors[0]?.message ?? "csv parse failed");
      return;
    }
    const data = result.data;
    if (data.length === 0) {
      setParsed({ headers: [], rows: [] });
      return;
    }
    const [first, ...rest] = data;
    setParsed({ headers: first ?? [], rows: rest });
  }, [content]);

  if (error) {
    return <div className="px-4 py-3 text-[12px] text-danger">{error}</div>;
  }
  if (!parsed) return null;
  return (
    <ArtifactTable
      headers={parsed.headers}
      rows={parsed.rows}
      emptyMessage={t("empty")}
    />
  );
}
