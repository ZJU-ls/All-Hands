"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";

type SkillSource = "builtin" | "github" | "market" | "local";

type Skill = {
  id: string;
  name: string;
  description: string;
  tool_ids: string[];
  prompt_fragment: string | null;
  version: string;
  source: SkillSource;
  source_url: string | null;
  installed_at: string | null;
  path: string | null;
};

type Employee = {
  id: string;
  name: string;
  description: string;
  is_lead_agent: boolean;
  tool_ids: string[];
  skill_ids: string[];
  max_iterations: number;
  model_ref: string;
};

type Tab = "overview" | "prompt" | "versions" | "dependencies";

type LoadStatus = "loading" | "ready" | "notfound" | "error";

const TABS: [Tab, string][] = [
  ["overview", "概览"],
  ["prompt", "参数 / 模板"],
  ["versions", "版本历史"],
  ["dependencies", "依赖图"],
];

export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [skill, setSkill] = useState<Skill | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus("loading");
    try {
      const [sRes, eRes] = await Promise.all([
        fetch(`/api/skills/${encodeURIComponent(id)}`),
        fetch("/api/employees"),
      ]);
      if (sRes.status === 404) {
        setStatus("notfound");
        return;
      }
      if (!sRes.ok) throw new Error(`skill HTTP ${sRes.status}`);
      if (!eRes.ok) throw new Error(`employees HTTP ${eRes.status}`);
      setSkill((await sRes.json()) as Skill);
      setEmployees((await eRes.json()) as Employee[]);
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!skill) return;
    setDeleting(true);
    try {
      await fetch(`/api/skills/${encodeURIComponent(skill.id)}`, {
        method: "DELETE",
      });
      window.location.href = "/skills";
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }

  const dependents = skill
    ? employees.filter((e) => e.skill_ids.includes(skill.id))
    : [];

  return (
    <AppShell title={skill?.name ?? "技能"}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="mb-4">
            <Link
              href="/skills"
              className="text-xs text-text-muted hover:text-text transition-colors duration-base"
            >
              ← 返回技能列表
            </Link>
          </div>

          {status === "loading" && (
            <div data-testid="skill-detail-loading">
              <LoadingState title="加载技能详情" />
            </div>
          )}

          {status === "notfound" && (
            <div data-testid="skill-detail-notfound">
              <EmptyState
                title={`技能 ${id} 不存在`}
                description="可能已被卸载,或 URL 拼写有误。"
              >
                <Link
                  href="/skills"
                  className="inline-block mt-2 rounded border border-border px-3 py-1.5 text-[12px] text-text hover:bg-surface-2 transition-colors duration-base"
                >
                  回到列表
                </Link>
              </EmptyState>
            </div>
          )}

          {status === "error" && (
            <div data-testid="skill-detail-error">
              <ErrorState
                title="加载技能失败"
                detail={error}
                action={{ label: "重试", onClick: () => void load() }}
              />
            </div>
          )}

          {status === "ready" && skill && (
            <>
              <Header
                skill={skill}
                dependentCount={dependents.length}
                onDelete={() => setConfirmDelete(true)}
              />

              <div
                role="tablist"
                className="mb-5 flex items-center gap-1 border-b border-border"
              >
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    data-testid={`tab-${key}`}
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`px-3 py-2 text-xs font-medium transition-colors duration-base border-b-2 -mb-px ${
                      tab === key
                        ? "text-text border-primary"
                        : "text-text-muted border-transparent hover:text-text"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "overview" && (
                <Overview skill={skill} dependents={dependents} />
              )}
              {tab === "prompt" && <PromptTab skill={skill} />}
              {tab === "versions" && <VersionsTab skill={skill} />}
              {tab === "dependencies" && <DependenciesTab skill={skill} />}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`卸载技能 ${skill?.name ?? ""}?`}
        message="此操作会同时删除本地目录,不可撤销。已分配该技能的员工将失去对应提示片段。"
        confirmLabel="卸载"
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}

function Header({
  skill,
  dependentCount,
  onDelete,
}: {
  skill: Skill;
  dependentCount: number;
  onDelete: () => void;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h2
            data-testid="skill-name"
            className="text-lg font-semibold tracking-tight text-text"
          >
            {skill.name}
          </h2>
          <span
            data-testid="skill-version"
            className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted font-mono"
          >
            v{skill.version}
          </span>
          <span
            data-testid="skill-source"
            className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted"
          >
            {skill.source}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted">
            {dependentCount} 员工在用
          </span>
        </div>
        <p className="text-[13px] text-text-muted leading-relaxed">
          {skill.description || "该技能暂无描述。"}
        </p>
        <p className="text-[11px] font-mono text-text-subtle mt-1 truncate">
          {skill.id}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        {skill.source_url && (
          <a
            href={skill.source_url}
            target="_blank"
            rel="noreferrer"
            data-testid="skill-source-link"
            className="text-xs px-3 py-1.5 rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text transition-colors duration-base"
          >
            源码 ↗
          </a>
        )}
        {skill.source !== "builtin" && (
          <button
            onClick={onDelete}
            data-testid="skill-delete"
            className="text-xs px-3 py-1.5 rounded border border-border text-danger hover:bg-danger/10 transition-colors duration-base"
          >
            卸载
          </button>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-md border border-border bg-surface p-5">
      <h3 className="text-[10px] uppercase tracking-wider font-mono text-text-subtle mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Overview({
  skill,
  dependents,
}: {
  skill: Skill;
  dependents: Employee[];
}) {
  return (
    <div data-testid="tab-panel-overview">
      <Section title="元数据">
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
          <dt className="text-text-muted">版本</dt>
          <dd className="font-mono text-text">{skill.version}</dd>
          <dt className="text-text-muted">来源</dt>
          <dd className="font-mono text-text">{skill.source}</dd>
          <dt className="text-text-muted">安装时间</dt>
          <dd className="font-mono text-text">
            {skill.installed_at ? formatTime(skill.installed_at) : "—"}
          </dd>
          <dt className="text-text-muted">本地路径</dt>
          <dd className="font-mono text-text-muted break-all">
            {skill.path ?? "—"}
          </dd>
          <dt className="text-text-muted">工具数</dt>
          <dd className="font-mono text-text">{skill.tool_ids.length}</dd>
        </dl>
      </Section>

      <Section title={`依赖工具 · ${skill.tool_ids.length}`}>
        {skill.tool_ids.length === 0 ? (
          <p className="text-xs text-text-muted">
            该技能未声明任何工具依赖。仅贡献提示片段。
          </p>
        ) : (
          <ul data-testid="tool-id-list" className="flex flex-col gap-1">
            {skill.tool_ids.map((tid) => (
              <li
                key={tid}
                data-testid={`tool-id-${tid}`}
                className="text-xs font-mono text-text"
              >
                {tid}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`使用该技能的员工 · ${dependents.length}`}>
        {dependents.length === 0 ? (
          <p data-testid="dependents-empty" className="text-xs text-text-muted">
            尚无员工引用该技能。
          </p>
        ) : (
          <div data-testid="dependents-list" className="flex flex-col gap-1.5">
            {dependents.map((e) => (
              <Link
                key={e.id}
                href={`/employees/${encodeURIComponent(e.id)}`}
                data-testid={`dependent-${e.id}`}
                className="flex items-center gap-2 rounded border border-border bg-bg px-3 py-2 text-xs hover:border-border-strong hover:bg-surface-2 transition-colors duration-base"
              >
                <span className="text-text">{e.name}</span>
                {e.is_lead_agent && (
                  <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-border text-text-muted">
                    lead
                  </span>
                )}
                <span className="font-mono text-text-subtle text-[10px] truncate">
                  {e.id}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function PromptTab({ skill }: { skill: Skill }) {
  return (
    <div data-testid="tab-panel-prompt">
      <Section title="系统提示片段">
        {skill.prompt_fragment ? (
          <pre
            data-testid="prompt-fragment"
            className="text-[12px] font-mono text-text bg-bg border border-border rounded p-3 whitespace-pre-wrap break-words"
          >
            {skill.prompt_fragment}
          </pre>
        ) : (
          <p
            data-testid="prompt-empty"
            className="text-xs text-text-muted"
          >
            该技能没有附带提示片段,仅通过工具注入能力。
          </p>
        )}
      </Section>

      <Section title="调用示例">
        <p className="text-xs text-text-muted mb-2">
          将 <span className="font-mono">{skill.id}</span> 添加到员工的
          <span className="font-mono"> skill_ids</span> 后,员工的 system prompt
          会追加上方片段,并获得下列 tools:
        </p>
        {skill.tool_ids.length === 0 ? (
          <p className="text-xs text-text-subtle">— 无 tool 依赖 —</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {skill.tool_ids.map((tid) => (
              <li
                key={tid}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted"
              >
                {tid}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function VersionsTab({ skill }: { skill: Skill }) {
  return (
    <div data-testid="tab-panel-versions">
      <Section title="当前版本">
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
          <dt className="text-text-muted">version</dt>
          <dd className="font-mono text-text">v{skill.version}</dd>
          <dt className="text-text-muted">安装时间</dt>
          <dd className="font-mono text-text">
            {skill.installed_at ? formatTime(skill.installed_at) : "—"}
          </dd>
          <dt className="text-text-muted">来源 URL</dt>
          <dd className="font-mono text-text-muted break-all">
            {skill.source_url ?? "—"}
          </dd>
        </dl>
      </Section>
      <div data-testid="version-history-empty">
        <EmptyState
          title="暂无版本历史"
          description="当前后端仅记录安装时刻的单一版本。未来通过 reinstall / 切换分支可保留历史。"
        />
      </div>
    </div>
  );
}

function DependenciesTab({ skill }: { skill: Skill }) {
  return (
    <div data-testid="tab-panel-dependencies">
      <Section title={`技能 → 工具 · ${skill.tool_ids.length}`}>
        <p className="text-[11px] text-text-muted mb-3">
          该技能注入到员工时会开放以下工具。点击 tool_id 跳 /gateway
          查看实际实现与 scope。
        </p>
        {skill.tool_ids.length === 0 ? (
          <p data-testid="dep-empty" className="text-xs text-text-muted">
            没有工具依赖。
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-subtle">
                <th className="pb-2 font-mono font-normal">序号</th>
                <th className="pb-2 font-mono font-normal">tool_id</th>
                <th className="pb-2 font-mono font-normal">来源</th>
              </tr>
            </thead>
            <tbody
              data-testid="dep-table-body"
              className="border-t border-border"
            >
              {skill.tool_ids.map((tid, idx) => {
                const kind = tid.startsWith("allhands.mcp.")
                  ? "mcp"
                  : tid.startsWith("allhands.builtin.")
                    ? "builtin"
                    : "unknown";
                return (
                  <tr
                    key={tid}
                    data-testid={`dep-row-${tid}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="py-2 font-mono text-text-subtle">
                      {String(idx + 1).padStart(2, "0")}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/gateway?tool=${encodeURIComponent(tid)}`}
                        className="font-mono text-text hover:text-primary transition-colors duration-base"
                      >
                        {tid}
                      </Link>
                    </td>
                    <td className="py-2 font-mono text-text-muted">{kind}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
