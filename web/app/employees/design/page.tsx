"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { DesignForm } from "@/components/employee-design/DesignForm";
import {
  listEmployees,
  listSkills,
  listMcpServers,
  type EmployeeDto,
  type SkillDto,
  type McpServerDto,
} from "@/lib/api";
import { UserIcon } from "@/components/icons";

/**
 * /employees/design · 员工招聘(设计)页 · Track L · I-0021 Phase 2 骨架。
 *
 * 架构:
 * - 左列:当前员工列表 + 新建入口
 * - 右栏:`DesignForm` 基础信息 + Skill/MCP 多选 + Preset 占位 + 系统 prompt
 * - 保存:POST /api/employees(方案 A · L01 对偶 · §3.1 扩展)
 * - 红线:表单 state 禁 `mode` 字段(§3.2)· PresetRadio 组件不写 state,
 *   Phase 3B 映射到 tool_ids / skill_ids / max_iterations。
 */

export default function EmployeeDesignPage() {
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [skills, setSkills] = useState<SkillDto[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function load() {
    try {
      const [es, sk, mcp] = await Promise.all([
        listEmployees(),
        listSkills().catch(() => [] as SkillDto[]),
        listMcpServers().catch(() => [] as McpServerDto[]),
      ]);
      setEmployees(es);
      setSkills(sk);
      setMcpServers(mcp);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const ready = employees !== null && skills !== null && mcpServers !== null;

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
                    <span className="flex-1 min-w-0 text-[12px] truncate">{e.name}</span>
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
              <div className="mb-4 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger font-mono">
                {error}
              </div>
            )}
            {!ready ? (
              <LoadingState title="加载表单依赖" />
            ) : selectedId === "" ? (
              <DesignForm
                skills={skills}
                mcpServers={mcpServers}
                onCreated={async () => {
                  await load();
                }}
              />
            ) : (
              <EmployeeReadonlyView
                employee={employees.find((e) => e.id === selectedId) ?? null}
              />
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function EmployeeReadonlyView({ employee }: { employee: EmployeeDto | null }) {
  if (!employee) {
    return <p className="text-[12px] text-text-muted">员工不存在。</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{employee.name}</h2>
        {employee.description && (
          <p className="text-[12px] text-text-muted mt-1">{employee.description}</p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px]">
        <dt className="text-text-muted">tools</dt>
        <dd className="font-mono text-text">{employee.tool_ids.length}</dd>
        <dt className="text-text-muted">skills</dt>
        <dd className="font-mono text-text">{employee.skill_ids.length}</dd>
        <dt className="text-text-muted">max_iterations</dt>
        <dd className="font-mono text-text">{employee.max_iterations}</dd>
        <dt className="text-text-muted">model</dt>
        <dd className="font-mono text-text">{employee.model_ref}</dd>
      </dl>
      <p className="text-[11px] text-text-muted">
        编辑 / 删除入口将在 Phase 3B 接通契约后提供(I-0022 Track M)。
      </p>
    </div>
  );
}
