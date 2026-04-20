"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { listEmployees, type EmployeeDto } from "@/lib/api";
import { deriveProfile, BADGE_LABEL } from "@/lib/employee-profile";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * Employees · card grid view (Track δ).
 *
 * Rationale: the previous single-column <ul> made the roster feel like a log
 * file at any screen width beyond a phone. A card grid is the convention for
 * browsing a "who's in the team" roster (ChatGPT GPTs page, Linear workspace
 * members, etc.), and it surfaces the three things a user actually wants when
 * scanning: who the employee is (name + lead badge), what model they run on,
 * and how many capabilities they own (tools / skills).
 */

function modelDisplay(modelRef: string): string {
  if (!modelRef) return "默认模型";
  const idx = modelRef.indexOf("/");
  return idx >= 0 ? modelRef.slice(idx + 1) : modelRef;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await listEmployees();
        if (!cancelled) setEmployees(list);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      title="员工"
      actions={
        <Link
          href="/employees/design"
          data-testid="goto-employee-design"
          className="rounded-md border border-border px-3 py-1 text-[12px] text-text hover:bg-surface-2 transition-colors duration-base"
        >
          设计员工
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          {error && (
            <div
              data-testid="employees-error"
              className="mb-4 rounded border border-border bg-surface-2 px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </div>
          )}
          {employees === null ? (
            <LoadingState title="加载员工" />
          ) : employees.length === 0 ? (
            <div
              data-testid="employees-empty"
              className="rounded border border-border bg-surface-2 px-6 py-10 text-center text-[12px] text-text-muted"
            >
              还没有员工。与 Lead Agent 对话,用 create_employee 工具即可创建。
            </div>
          ) : (
            <div
              data-testid="employees-grid"
              className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            >
              {employees.map((e) => (
                <EmployeeCard key={e.id} employee={e} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function EmployeeCard({ employee }: { employee: EmployeeDto }) {
  const badges = deriveProfile(employee);
  const isLead = employee.is_lead_agent;
  return (
    <Link
      href={`/employees/${employee.id}`}
      data-testid={`employee-card-${employee.name}`}
      className="group flex flex-col gap-3 rounded border border-border bg-surface-2 p-4 hover:border-border-strong transition-colors duration-base min-w-0"
    >
      <div className="flex items-start gap-3">
        <BrandMark
          name={employee.model_ref}
          fallbackName={employee.name}
          size="md"
          className="text-text-muted"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-text truncate">
              {employee.name}
            </span>
            {isLead && (
              <span
                className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted shrink-0"
                data-testid="badge-lead"
              >
                lead
              </span>
            )}
          </div>
          <p className="font-mono text-[10px] text-text-subtle truncate mt-0.5">
            {modelDisplay(employee.model_ref)}
          </p>
        </div>
      </div>

      {employee.description ? (
        <p className="text-[12px] text-text-muted leading-snug line-clamp-2 min-h-[30px]">
          {employee.description}
        </p>
      ) : (
        <p className="text-[12px] text-text-subtle italic leading-snug min-h-[30px]">
          暂无描述
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {badges
          .filter((b) => b !== "react")
          .map((b) => (
            <span
              key={b}
              className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted"
            >
              {BADGE_LABEL[b]}
            </span>
          ))}
      </div>

      <div className="flex items-center gap-3 pt-1 mt-auto border-t border-border">
        <Stat label="tools" value={employee.tool_ids.length} />
        <Stat label="skills" value={employee.skill_ids.length} />
        <span className="ml-auto font-mono text-[10px] text-text-subtle group-hover:text-text transition-colors duration-base">
          打开 →
        </span>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-[13px] text-text">{value}</span>
      <span className="font-mono text-[10px] text-text-subtle">{label}</span>
    </span>
  );
}
