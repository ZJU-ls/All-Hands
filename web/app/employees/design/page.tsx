"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { DesignForm } from "@/components/employee-design/DesignForm";
import {
  createConversation,
  deleteEmployee,
  listEmployees,
  listMcpServers,
  listSkills,
  publishEmployee,
  type EmployeeDto,
  type McpServerDto,
  type SkillDto,
} from "@/lib/api";
import { UserIcon } from "@/components/icons";

/**
 * /employees/design · 员工招聘(设计)页。
 *
 * 左列:员工列表(draft + published 混排 · 草稿视觉弱化),顶端"新建员工"。
 * 右栏:
 *  - 新建:DesignForm 默认态(空值 · preset 触发 preview)
 *  - 选中:DesignForm 以 initial 载入 + 头部工具条(status chip · 上岗 / 试用 / 删除)
 *
 * 红线:§3.2 表单无 mode 字段;§3.1 两个入口(REST + Meta Tool)语义等价。
 */

export default function EmployeeDesignPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [skills, setSkills] = useState<SkillDto[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busyAction, setBusyAction] = useState<"publish" | "delete" | "chat" | null>(null);

  async function load(preserveSelected = true) {
    try {
      // Design surface shows ALL employees (draft + published) — that's
      // the whole point: you manage the roster from here, publish from here,
      // retire from here.
      const [es, sk, mcp] = await Promise.all([
        listEmployees(),
        listSkills().catch(() => [] as SkillDto[]),
        listMcpServers().catch(() => [] as McpServerDto[]),
      ]);
      setEmployees(es);
      setSkills(sk);
      setMcpServers(mcp);
      if (!preserveSelected && es.length > 0) setSelectedId("");
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const ready = employees !== null && skills !== null && mcpServers !== null;
  const selected = employees?.find((e) => e.id === selectedId) ?? null;

  async function onPublish(id: string) {
    setBusyAction("publish");
    setError("");
    try {
      await publishEmployee(id);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function onDelete(emp: EmployeeDto) {
    // IRREVERSIBLE: employee_id is referenced by conversations + traces; show
    // a blocking confirm rather than a soft toast. Matches meta-tool
    // delete_employee scope semantics.
    const ok = window.confirm(
      `确定要删除员工「${emp.name}」?此操作不可撤销,且该员工名下的对话历史仍会保留但失去引用。`,
    );
    if (!ok) return;
    setBusyAction("delete");
    setError("");
    try {
      await deleteEmployee(emp.id);
      setSelectedId("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function onTry(emp: EmployeeDto) {
    setBusyAction("chat");
    setError("");
    try {
      const conv = await createConversation(emp.id);
      router.push(`/chat/${conv.id}`);
    } catch (e) {
      setError(String(e));
      setBusyAction(null);
    }
  }

  return (
    <AppShell title="员工设计">
      <div className="flex h-full min-h-0">
        <aside
          data-testid="design-employee-list"
          className="w-64 shrink-0 border-r border-border bg-surface overflow-y-auto"
        >
          <div className="p-3 border-b border-border">
            <button
              data-testid="design-new-employee"
              onClick={() => setSelectedId("")}
              className={`w-full flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] transition-colors duration-base ${
                selectedId === ""
                  ? "border-primary/60 bg-primary/5 text-text"
                  : "border-border text-text hover:bg-surface-2"
              }`}
            >
              <span className="font-mono text-[11px] text-primary">+</span>
              <span>新建员工</span>
            </button>
          </div>
          {employees === null ? (
            <div className="p-3">
              <LoadingState title="加载员工" />
            </div>
          ) : employees.length === 0 ? (
            <p className="p-3 text-[11px] text-text-muted">
              还没有员工,右侧表单填完即可招聘第一位。
            </p>
          ) : (
            <ul className="py-1">
              {employees.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    data-testid={`design-emp-${e.id}`}
                    onClick={() => setSelectedId(e.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors duration-base ${
                      selectedId === e.id
                        ? "bg-surface-2 text-text"
                        : "text-text-muted hover:text-text hover:bg-surface-2"
                    }`}
                  >
                    <UserIcon size={14} className="shrink-0" />
                    <span
                      className={`flex-1 min-w-0 text-[12px] truncate ${
                        e.status === "draft" ? "italic" : ""
                      }`}
                    >
                      {e.name}
                    </span>
                    {e.status === "draft" && (
                      <span
                        data-testid={`design-emp-${e.id}-draft-tag`}
                        className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-subtle"
                      >
                        草稿
                      </span>
                    )}
                    {e.is_lead_agent && (
                      <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-subtle">
                        lead
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">
            {error && (
              <div
                data-testid="design-page-error"
                className="mb-4 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger font-mono"
              >
                {error}
              </div>
            )}
            {!ready ? (
              <LoadingState title="加载表单依赖" />
            ) : selectedId === "" ? (
              <DesignForm
                skills={skills}
                mcpServers={mcpServers}
                onCreated={async (emp) => {
                  // A freshly-created employee is a draft — jump the user
                  // into its edit view so they can iterate or publish.
                  await load();
                  setSelectedId(emp.id);
                }}
              />
            ) : selected ? (
              <div className="flex flex-col gap-5">
                <EmployeeToolbar
                  employee={selected}
                  busyAction={busyAction}
                  onPublish={() => onPublish(selected.id)}
                  onDelete={() => onDelete(selected)}
                  onTry={() => onTry(selected)}
                />
                <DesignForm
                  key={selected.id}
                  skills={skills}
                  mcpServers={mcpServers}
                  initial={selected}
                  onSaved={async () => {
                    await load();
                  }}
                />
              </div>
            ) : (
              <p className="text-[12px] text-text-muted">员工不存在。</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function EmployeeToolbar({
  employee,
  busyAction,
  onPublish,
  onDelete,
  onTry,
}: {
  employee: EmployeeDto;
  busyAction: "publish" | "delete" | "chat" | null;
  onPublish: () => void;
  onDelete: () => void;
  onTry: () => void;
}) {
  const isDraft = employee.status === "draft";
  const busy = busyAction !== null;
  return (
    <div
      data-testid="design-toolbar"
      className="flex items-center gap-2 pb-4 border-b border-border"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-text truncate">{employee.name}</h2>
          <span
            data-testid={`design-status-chip-${employee.status}`}
            className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              isDraft
                ? "border-border text-text-subtle"
                : "border-primary/40 text-primary"
            }`}
          >
            {isDraft ? "草稿" : "已上岗"}
          </span>
        </div>
        <p className="font-mono text-[10px] text-text-subtle mt-1">
          {employee.model_ref || "平台默认模型"}
        </p>
      </div>
      <button
        type="button"
        onClick={onTry}
        disabled={busy}
        data-testid="design-try"
        className="rounded-md border border-border px-3 py-1.5 text-[12px] text-text hover:bg-surface-2 disabled:opacity-40 transition-colors duration-base"
      >
        {busyAction === "chat" ? "打开中…" : "试用 →"}
      </button>
      {isDraft && (
        <button
          type="button"
          onClick={onPublish}
          disabled={busy}
          data-testid="design-publish"
          className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-3 py-1.5 text-[12px] font-medium transition-colors duration-base"
        >
          {busyAction === "publish" ? "上岗中…" : "上岗"}
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={busy || employee.is_lead_agent}
        title={employee.is_lead_agent ? "Lead Agent 不可删除" : "删除员工(不可撤销)"}
        data-testid="design-delete"
        className="rounded-md border border-danger/40 text-danger hover:bg-danger/5 disabled:opacity-30 disabled:hover:bg-transparent px-3 py-1.5 text-[12px] transition-colors duration-base"
      >
        {busyAction === "delete" ? "删除中…" : "删除"}
      </button>
    </div>
  );
}
