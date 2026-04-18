"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import {
  getEmployee,
  listConversations,
  createConversation,
  type ConversationDto,
  type EmployeeDto,
} from "@/lib/api";
import { deriveProfile, BADGE_LABEL } from "@/lib/employee-profile";

export default function EmployeePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeDto | null>(null);
  const [conversations, setConversations] = useState<ConversationDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [e, c] = await Promise.all([
          getEmployee(employeeId),
          listConversations({ employeeId }),
        ]);
        if (cancelled) return;
        setEmployee(e);
        setConversations(c);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  async function handleNewConversation() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await createConversation(employeeId);
      router.push(`/chat/${res.id}`);
    } catch (err) {
      setError(String(err));
      setCreating(false);
    }
  }

  const badges = employee ? deriveProfile(employee) : [];
  const isLead = Boolean(employee?.is_lead_agent);

  return (
    <AppShell title={employee?.name ?? "员工"}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {error && (
            <div className="rounded border border-border bg-surface-2 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}

          {employee && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                  {isLead ? "lead" : "emp"}
                </span>
                <h2 className="text-[15px] font-semibold text-text">{employee.name}</h2>
              </div>
              <div className="flex flex-wrap gap-1">
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
              {employee.description && (
                <p className="text-[13px] text-text-muted leading-relaxed">
                  {employee.description}
                </p>
              )}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
                <dt className="text-text-subtle">模型</dt>
                <dd className="font-mono text-text">{employee.model_ref}</dd>
                <dt className="text-text-subtle">工具数</dt>
                <dd className="font-mono text-text">{employee.tool_ids.length}</dd>
                <dt className="text-text-subtle">技能数</dt>
                <dd className="font-mono text-text">{employee.skill_ids.length}</dd>
                <dt className="text-text-subtle">最大迭代</dt>
                <dd className="font-mono text-text">{employee.max_iterations}</dd>
              </dl>
            </section>
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-mono uppercase tracking-wider text-text-subtle">
                对话
              </h3>
              <button
                type="button"
                onClick={handleNewConversation}
                disabled={creating || !employee}
                className="text-[12px] px-3 py-1 rounded border border-border text-text hover:bg-surface-2 hover:border-border-strong transition-colors duration-base disabled:opacity-50"
              >
                {creating ? "创建中…" : "新对话"}
              </button>
            </div>
            {conversations === null ? (
              <p className="text-[12px] text-text-muted">加载中…</p>
            ) : conversations.length === 0 ? (
              <p className="text-[12px] text-text-muted">
                还没有和 {employee?.name ?? "该员工"} 的对话。点「新对话」开始。
              </p>
            ) : (
              <ul className="divide-y divide-border border border-border rounded">
                {conversations.map((c) => (
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
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
