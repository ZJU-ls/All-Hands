"use client";

import { useMemo } from "react";
import { KV, Table } from "@/components/render/Viz";

const NO_INTERACTIONS: never[] = [];

export function DataView({ content }: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(content) };
    } catch {
      return { ok: false as const };
    }
  }, [content]);

  if (!parsed.ok) {
    return (
      <pre className="whitespace-pre-wrap px-4 py-3 text-xs font-mono text-text">
        {content}
      </pre>
    );
  }

  const value: unknown = parsed.value;
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
    const keys = Array.from(
      new Set(value.flatMap((row) => Object.keys(row as object))),
    );
    return (
      <div className="px-4 py-3">
        <Table
          props={{
            columns: keys.map((k) => ({ key: k, label: k })),
            rows: value as Record<string, unknown>[],
          }}
          interactions={NO_INTERACTIONS}
        />
      </div>
    );
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const items = Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
      label: k,
      value: typeof v === "string" ? v : JSON.stringify(v),
    }));
    return (
      <div className="px-4 py-3">
        <KV props={{ items }} interactions={NO_INTERACTIONS} />
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap px-4 py-3 text-xs font-mono text-text">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
