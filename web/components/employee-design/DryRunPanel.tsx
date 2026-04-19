"use client";

import { useState } from "react";
import {
  previewEmployeeComposition,
  type EmployeePreset,
  type EmployeePreviewResult,
} from "@/lib/api";

/**
 * 点「预览合成」→ 调 POST /api/employees/preview · 展示展开后的
 * ``(tool_ids, skill_ids, max_iterations)`` 三列。L01 扩展下,meta tool
 * ``preview_employee_composition`` 是等价入口,Lead Agent 在对话里算同一份。
 *
 * §3.2 红线:面板只展示三列,不暴露 ``preset`` / ``mode`` 字样。
 */

export function DryRunPanel({
  preset,
  customToolIds,
  customSkillIds,
  customMaxIterations,
}: {
  preset: EmployeePreset;
  customToolIds?: string[];
  customSkillIds?: string[];
  customMaxIterations?: number;
}) {
  const [preview, setPreview] = useState<EmployeePreviewResult | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setErr("");
    try {
      const res = await previewEmployeeComposition({
        preset,
        custom_tool_ids: customToolIds,
        custom_skill_ids: customSkillIds,
        custom_max_iterations: customMaxIterations,
      });
      setPreview(res);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-text">Dry run 预览</h3>
        <button
          type="button"
          data-testid="dryrun-button"
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md border border-border px-3 py-1 text-[11px] text-text hover:bg-surface-2 disabled:opacity-40 transition-colors duration-base"
        >
          {loading ? "computing…" : "预览合成"}
        </button>
      </div>
      {err && (
        <p
          className="text-[11px] text-danger font-mono"
          data-testid="dryrun-error"
        >
          {err}
        </p>
      )}
      {preview === null && !err ? (
        <p className="text-[11px] text-text-muted">
          点「预览合成」看最终落库的三列(tool_ids / skill_ids /
          max_iterations),不会真的建员工。
        </p>
      ) : preview ? (
        <div data-testid="dryrun-panel" className="flex flex-col gap-3">
          <Row label={`tool_ids · ${preview.tool_ids.length}`}>
            {preview.tool_ids.length === 0 ? (
              <span className="text-[11px] text-text-subtle">(空)</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {preview.tool_ids.map((t) => (
                  <li
                    key={t}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <Row label={`skill_ids · ${preview.skill_ids.length}`}>
            {preview.skill_ids.length === 0 ? (
              <span className="text-[11px] text-text-subtle">(空)</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {preview.skill_ids.map((s) => (
                  <li
                    key={s}
                    className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </Row>
          <Row label="max_iterations">
            <span className="font-mono text-[12px] text-text">
              {preview.max_iterations}
            </span>
          </Row>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] text-text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}
