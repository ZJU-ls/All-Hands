"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { listEmployees, type EmployeeDto } from "@/lib/api";
import { deriveProfile, BADGE_LABEL } from "@/lib/employee-profile";

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
    <AppShell title="员工">
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          {error && (
            <div className="rounded border border-border bg-surface-2 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}
          {employees === null ? (
            <p className="text-[12px] text-text-muted">加载中…</p>
          ) : employees.length === 0 ? (
            <p className="text-[12px] text-text-muted">
              还没有员工。通过与 Lead Agent 对话,用 create_employee 工具来创建。
            </p>
          ) : (
            <ul className="divide-y divide-border border border-border rounded">
              {employees.map((e) => {
                const badges = deriveProfile(e);
                const isLead = e.is_lead_agent;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/employees/${e.id}`}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-surface-2 transition-colors duration-base"
                    >
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle shrink-0">
                        {isLead ? "lead" : "emp"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text truncate">
                            {e.name}
                          </span>
                          {isLead && (
                            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted">
                              全能
                            </span>
                          )}
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
                        {e.description && (
                          <p className="text-[12px] text-text-muted truncate mt-0.5">
                            {e.description}
                          </p>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-text-subtle shrink-0">
                        {e.tool_ids.length} tools
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
