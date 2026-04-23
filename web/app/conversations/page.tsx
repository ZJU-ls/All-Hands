"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";
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
        <div className="mx-auto max-w-5xl space-y-8 p-8">
          <PageHeader
            title="历史会话"
            count={conversations?.length}
            subtitle="按员工分组 · 最新对话在顶部 · 点击进入对话记录"
          />

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 animate-fade-up">
              <Icon name="alert-circle" size={18} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-danger">加载失败</div>
                <div className="mt-1 font-mono text-caption text-danger/80">{error}</div>
              </div>
            </div>
          )}

          {loading ? (
            <SkeletonGroups />
          ) : groups.length === 0 ? (
            <EmptyConversations />
          ) : (
            <div className="space-y-10">
              {groups.map((g) => {
                const empId = g.employee?.id ?? "unknown";
                const isLead = Boolean(g.employee?.is_lead_agent);
                const initials = (g.employee?.name ?? "?").slice(0, 2).toUpperCase();
                return (
                  <section key={empId} className="space-y-3 animate-fade-up">
                    {/* Group header */}
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-primary-fg shadow-soft-sm"
                        style={{
                          background: isLead
                            ? "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))"
                            : "linear-gradient(135deg, var(--color-accent), var(--color-primary))",
                        }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {g.employee ? (
                            <Link
                              href={`/employees/${empId}`}
                              className="text-base font-semibold tracking-tight text-text hover:text-primary transition-colors duration-base"
                            >
                              {g.employee.name}
                            </Link>
                          ) : (
                            <span className="text-base font-semibold text-text-muted">
                              未知员工
                            </span>
                          )}
                          {isLead && (
                            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary px-2 text-[10px] font-medium text-primary-fg shadow-soft-sm">
                              <Icon name="sparkles" size={10} /> Lead
                            </span>
                          )}
                          <span className="font-mono text-caption text-text-subtle">
                            · {g.conversations.length} 条对话
                          </span>
                        </div>
                        {g.employee?.description && (
                          <div className="mt-0.5 truncate text-caption text-text-muted">
                            {g.employee.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Conversation cards */}
                    <ul className="space-y-2 pl-[52px]">
                      {g.conversations.map((c) => (
                        <li key={c.id}>
                          <Link
                            href={`/chat/${c.id}`}
                            className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft"
                          >
                            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-subtle group-hover:bg-primary-muted group-hover:text-primary transition-colors duration-fast">
                              <Icon name="message-square" size={14} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-text">
                                {c.title ?? "(无标题)"}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 font-mono text-caption text-text-subtle">
                                <span>{c.id.slice(0, 8)}</span>
                                <span>·</span>
                                <time>{new Date(c.created_at).toLocaleString()}</time>
                              </div>
                            </div>
                            <Icon
                              name="arrow-right"
                              size={14}
                              className="shrink-0 text-text-subtle opacity-0 transition-[opacity,transform] duration-fast group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-primary"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SkeletonGroups() {
  return (
    <div className="space-y-10">
      {[0, 1].map((k) => (
        <div key={k} className="space-y-3 animate-fade-up">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 animate-shimmer bg-[length:200%_100%]" />
            <div className="flex-1">
              <div className="h-4 w-40 rounded bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 animate-shimmer bg-[length:200%_100%]" />
              <div className="mt-2 h-3 w-28 rounded bg-gradient-to-r from-surface-2 via-surface-3 to-surface-2 animate-shimmer bg-[length:200%_100%]" />
            </div>
          </div>
          <ul className="space-y-2 pl-[52px]">
            {[0, 1, 2].map((j) => (
              <li
                key={j}
                className="h-14 rounded-xl border border-border bg-gradient-to-r from-surface via-surface-2 to-surface animate-shimmer bg-[length:200%_100%]"
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EmptyConversations() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-14 shadow-soft-sm animate-fade-up">
      {/* Mesh hero backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(600px 300px at 20% 0%, var(--color-primary-soft) 0%, transparent 60%), radial-gradient(500px 300px at 80% 100%, var(--color-accent) 0%, transparent 65%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--color-border) 1px, transparent 0)",
          backgroundSize: "24px 24px",
          opacity: 0.3,
        }}
      />
      <div className="relative mx-auto max-w-md text-center">
        <div
          className="mx-auto grid h-16 w-16 animate-float place-items-center rounded-2xl text-primary-fg shadow-soft-lg"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
        >
          <Icon name="message-square" size={28} />
        </div>
        <h3 className="mt-6 text-lg font-semibold tracking-tight">
          还没有任何对话
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          打开一个员工主页 · 创建新对话开始。所有与数字员工的交流都会记录在这里。
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            href="/employees"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-fg shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-glow-sm"
          >
            <Icon name="users" size={14} /> 打开员工列表
          </Link>
          <Link
            href="/chat"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface px-5 text-sm font-medium text-text shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
          >
            <Icon name="sparkles" size={14} className="text-primary" /> 直接开对话
          </Link>
        </div>
      </div>
    </div>
  );
}
