"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
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
 *
 * V2 (ADR 0016):surface card with rounded-xl + shadow-soft-sm · header status
 * chip · soft-status error block · mono `<ul>` chip cloud for id lists.
 */

type Status = "idle" | "loading" | "ready" | "error";

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
  const t = useTranslations("employees.dryRun");
  const [preview, setPreview] = useState<EmployeePreviewResult | null>(null);
  const [err, setErr] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");

  async function run() {
    setStatus("loading");
    setErr("");
    try {
      const res = await previewEmployeeComposition({
        preset,
        custom_tool_ids: customToolIds,
        custom_skill_ids: customSkillIds,
        custom_max_iterations: customMaxIterations,
      });
      setPreview(res);
      setStatus("ready");
    } catch (e) {
      setErr(String(e));
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
            <Icon name="zap" size={14} />
          </span>
          <h3 className="text-[13px] font-semibold text-text">{t("title")}</h3>
          <StatusChip status={status} />
        </div>
        <button
          type="button"
          data-testid="dryrun-button"
          onClick={() => void run()}
          disabled={status === "loading"}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-fg shadow-soft-sm transition-colors duration-fast hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? (
            <>
              <span className="inline-block h-3 w-3 rounded-full border-2 border-primary-fg/30 border-t-primary-fg animate-spin" />
              {t("computing")}
            </>
          ) : (
            <>
              <Icon name="play" size={12} />
              {t("preview")}
            </>
          )}
        </button>
      </div>

      {status === "error" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2"
        >
          <Icon
            name="alert-circle"
            size={14}
            className="mt-0.5 shrink-0 text-danger"
          />
          <p
            className="font-mono text-[11px] text-danger break-all"
            data-testid="dryrun-error"
          >
            {err}
          </p>
        </div>
      )}

      {preview === null && status !== "error" && (
        <p className="text-[12px] text-text-muted">
          {t("intro")}
        </p>
      )}

      {preview && status !== "error" && (
        <div data-testid="dryrun-panel" className="flex flex-col gap-3">
          <Row label={t("rowToolIds", { count: preview.tool_ids.length })}>
            <IdChips ids={preview.tool_ids} />
          </Row>
          <Row label={t("rowSkillIds", { count: preview.skill_ids.length })}>
            <IdChips ids={preview.skill_ids} />
          </Row>
          <Row label={t("rowMaxIter")}>
            <span className="font-mono text-[13px] font-medium text-text">
              {preview.max_iterations}
            </span>
          </Row>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  const t = useTranslations("employees.dryRun");
  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-primary-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-primary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        {t("statusRunning")}
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-success-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-success">
        <Icon name="check" size={10} />
        {t("statusOk")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-danger-soft px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-danger">
        <Icon name="alert-circle" size={10} />
        {t("statusError")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle">
      {t("statusIdle")}
    </span>
  );
}

function IdChips({ ids }: { ids: string[] }) {
  const t = useTranslations("employees.dryRun");
  if (ids.length === 0) {
    return <span className="text-[11px] text-text-subtle">{t("emptyChips")}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <li
          key={id}
          className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
        >
          {id}
        </li>
      ))}
    </ul>
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
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle">
        {label}
      </div>
      {children}
    </div>
  );
}
