"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import {
  listConversations,
  listEmployees,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";

type Group = {
  employee: EmployeeDto | null;
  conversations: ConversationDto[];
};

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [conv, emps] = await Promise.all([
          listConversations({ employeeId: "all" }),
          listEmployees(),
        ]);
        if (cancelled) return;
        setConversations(conv);
        setEmployees(emps);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo<Group[]>(() => {
    if (!conversations || !employees) return [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    const byEmployee = new Map<string, ConversationDto[]>();
    for (const c of conversations) {
      const arr = byEmployee.get(c.employee_id) ?? [];
      arr.push(c);
      byEmployee.set(c.employee_id, arr);
    }
    const out: Group[] = [];
    for (const [empId, convs] of byEmployee) {
      out.push({ employee: empById.get(empId) ?? null, conversations: convs });
    }
    out.sort((a, b) => {
      if (a.employee?.is_lead_agent && !b.employee?.is_lead_agent) return -1;
      if (!a.employee?.is_lead_agent && b.employee?.is_lead_agent) return 1;
      return (a.employee?.name ?? "").localeCompare(b.employee?.name ?? "");
    });
    return out;
  }, [conversations, employees]);

  const loading = conversations === null || employees === null;

  return (
    <AppShell title="历史会话">
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {error && (
            <div className="rounded border border-border bg-surface-2 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}
          {loading ? (
            <p className="text-[12px] text-text-muted">加载中…</p>
          ) : groups.length === 0 ? (
            <p className="text-[12px] text-text-muted">
              还没有任何对话。打开一个员工主页,创建新对话开始。
            </p>
          ) : (
            groups.map((g) => {
              const empId = g.employee?.id ?? "unknown";
              return (
                <section key={empId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                        {g.employee?.is_lead_agent ? "lead" : "emp"}
                      </span>
                      {g.employee ? (
                        <Link
                          href={`/employees/${empId}`}
                          className="text-[13px] font-medium text-text hover:text-primary transition-colors duration-base"
                        >
                          {g.employee.name}
                        </Link>
                      ) : (
                        <span className="text-[13px] font-medium text-text-muted">
                          未知员工 · {empId}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-text-subtle">
                        · {g.conversations.length} 条
                      </span>
                    </div>
                  </div>
                  <ul className="divide-y divide-border border border-border rounded">
                    {g.conversations.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/chat/${c.id}`}
                          className="flex items-center gap-3 px-3 py-2 text-[12px] hover:bg-surface-2 transition-colors duration-base"
                        >
                          <span className="font-mono text-[10px] text-text-subtle shrink-0">
                            {c.id.slice(0, 8)}
                          </span>
                          <span className="flex-1 truncate text-text">
                            {c.title ?? "(无标题)"}
                          </span>
                          <time className="font-mono text-[10px] text-text-subtle shrink-0">
                            {new Date(c.created_at).toLocaleString()}
                          </time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
