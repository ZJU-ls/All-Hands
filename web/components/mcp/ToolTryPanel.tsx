"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";

/**
 * ToolTryPanel · in-place "Try it" runner for a single MCP tool.
 *
 * Schema-driven form: each top-level property in tool.input_schema becomes
 * a labeled input. Supported types map directly:
 *   - string            → single-line input
 *   - integer / number  → number input
 *   - boolean           → checkbox
 *   - object / array    → JSON textarea (caller types JSON)
 *
 * Anything richer falls back to a JSON textarea. Calls
 * POST /api/mcp-servers/{id}/invoke and shows result/error.
 *
 * Shared between the MCP list page (registration view) and the detail page so
 * "试一下" UX stays consistent. i18n is read from "mcp.detail.tools.tryPanel".
 */

export type ToolInfo = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export function ToolTryPanel({
  serverId,
  tool,
  testIdPrefix = "tool-try",
}: {
  serverId: string;
  tool: ToolInfo;
  testIdPrefix?: string;
}) {
  const tr = useTranslations("mcp.detail.tools.tryPanel");
  type RunState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok"; result: unknown }
    | { status: "error"; message: string };
  const [args, setArgs] = useState<Record<string, unknown>>(() =>
    initialArgsFromSchema(tool.input_schema),
  );
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const props = readSchemaProperties(tool.input_schema);
  const required = readSchemaRequired(tool.input_schema);
  const isLoading = run.status === "running";

  const setArg = (key: string, value: unknown) =>
    setArgs((prev) => ({ ...prev, [key]: value }));

  async function invoke() {
    setRun({ status: "running" });
    try {
      const res = await fetch(
        `/api/mcp-servers/${encodeURIComponent(serverId)}/invoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool_name: tool.name, arguments: args }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          (body && typeof body === "object" && "detail" in body
            ? String((body as { detail: unknown }).detail)
            : "") || `${res.status} ${res.statusText}`;
        setRun({ status: "error", message: detail });
        return;
      }
      setRun({ status: "ok", result: body });
    } catch (e) {
      setRun({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const reset = () => {
    setArgs(initialArgsFromSchema(tool.input_schema));
    setRun({ status: "idle" });
  };

  return (
    <div
      data-testid={`${testIdPrefix}-${tool.name}`}
      className="border-t border-border px-3 py-3 bg-bg space-y-3"
    >
      <p className="text-caption uppercase tracking-wider font-mono text-text-subtle font-semibold">
        {tr("title")}
      </p>
      {props.length === 0 ? (
        <p className="text-[12px] text-text-muted">{tr("noArgs")}</p>
      ) : (
        <div className="space-y-2.5">
          {props.map(({ key, schema }) => (
            <SchemaField
              key={key}
              name={key}
              required={required.includes(key)}
              schema={schema}
              value={args[key]}
              onChange={(v) => setArg(key, v)}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          type="button"
          onClick={() => void invoke()}
          disabled={isLoading}
          data-testid={`${testIdPrefix}-run-${tool.name}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-fg text-[12px] font-semibold hover:bg-primary-hover disabled:opacity-40 transition duration-base"
        >
          {isLoading ? (
            <>
              <Icon name="loader" size={12} className="animate-spin-slow" />
              {tr("running")}
            </>
          ) : (
            <>
              <Icon name="play" size={12} />
              {tr("run")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface text-[12px] text-text-muted hover:text-text hover:border-border-strong transition duration-base"
        >
          {tr("reset")}
        </button>
        {run.status === "ok" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-success font-mono">
            <Icon name="check" size={12} />
            {tr("ok")}
          </span>
        )}
        {run.status === "error" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-danger font-mono">
            <Icon name="alert-circle" size={12} />
            {tr("err")}
          </span>
        )}
      </div>
      {run.status === "ok" && (
        <div data-testid={`${testIdPrefix}-result-${tool.name}`}>
          <p className="text-caption uppercase tracking-wider font-mono text-text-subtle font-semibold mb-1">
            {tr("result")}
          </p>
          <pre className="text-[11px] font-mono text-text whitespace-pre-wrap break-words leading-relaxed bg-surface-2 border border-border rounded-md p-2 max-h-[280px] overflow-auto">
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </div>
      )}
      {run.status === "error" && (
        <div
          data-testid={`${testIdPrefix}-error-${tool.name}`}
          className="text-[12px] text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2"
        >
          {run.message}
        </div>
      )}
    </div>
  );
}

// ── schema helpers · pure ───────────────────────────────────────────────

type SchemaProp = { key: string; schema: Record<string, unknown> };

function readSchemaProperties(schema: Record<string, unknown>): SchemaProp[] {
  const props = schema.properties;
  if (!props || typeof props !== "object") return [];
  return Object.entries(props as Record<string, unknown>).map(([key, s]) => ({
    key,
    schema: (s as Record<string, unknown>) ?? {},
  }));
}

function readSchemaRequired(schema: Record<string, unknown>): string[] {
  const r = schema.required;
  return Array.isArray(r)
    ? r.filter((x): x is string => typeof x === "string")
    : [];
}

function initialArgsFromSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, schema: s } of readSchemaProperties(schema)) {
    if ("default" in s) {
      out[key] = (s as { default: unknown }).default;
      continue;
    }
    const t = (s.type as string | undefined) ?? "string";
    if (t === "boolean") out[key] = false;
    else if (t === "integer" || t === "number") out[key] = 0;
    else out[key] = "";
  }
  return out;
}

function SchemaField({
  name,
  required,
  schema,
  value,
  onChange,
}: {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const tr = useTranslations("mcp.detail.tools.tryPanel");
  const t = (schema.type as string | undefined) ?? "string";
  const description = (schema.description as string | undefined) ?? "";
  const label = (
    <label className="block text-[11px] font-mono text-text-muted">
      {name}
      {required ? <span className="text-danger ml-1">*</span> : null}
      {description ? (
        <span className="ml-2 text-text-subtle font-sans">· {description}</span>
      ) : null}
    </label>
  );

  if (t === "boolean") {
    return (
      <div className="space-y-1">
        {label}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-border bg-surface text-primary"
        />
      </div>
    );
  }
  if (t === "integer" || t === "number") {
    return (
      <div className="space-y-1">
        {label}
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const n = e.target.value === "" ? 0 : Number(e.target.value);
            onChange(t === "integer" ? Math.trunc(n) : n);
          }}
          className="block w-full h-8 px-2 rounded-md border border-border bg-surface text-[12px] font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    );
  }
  if (t === "object" || t === "array") {
    const text =
      typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
    return (
      <div className="space-y-1">
        {label}
        <textarea
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            try {
              onChange(JSON.parse(raw));
            } catch {
              onChange(raw);
            }
          }}
          rows={3}
          placeholder={tr("jsonPlaceholder")}
          className="block w-full px-2 py-1 rounded-md border border-border bg-surface text-[12px] font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {label}
      <input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full h-8 px-2 rounded-md border border-border bg-surface text-[12px] font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
