"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { NewTaskDrawer } from "@/components/tasks/NewTaskDrawer";
import { TaskStatusPill } from "@/components/tasks/TaskStatusPill";
import { listEmployees, type EmployeeDto } from "@/lib/api";
import {
  listTasks,
  sourceLabel,
  type TaskDto,
  type TaskStatus,
} from "@/lib/tasks-api";

type FilterKey = "inbox" | "active" | "needs_user" | "done" | "failed" | "all";

const FILTER_DEFS: { key: FilterKey; label: string; statuses: TaskStatus[] | null }[] = [
  { key: "inbox", label: "收件箱", statuses: ["queued", "running", "needs_input", "needs_approval"] },
  { key: "needs_user", label: "等你", statuses: ["needs_input", "needs_approval"] },
  { key: "active", label: "执行中", statuses: ["running"] },
  { key: "done", label: "已完成", statuses: ["completed"] },
  { key: "failed", label: "失败/取消", statuses: ["failed", "cancelled"] },
  { key: "all", label: "全部", statuses: null },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("inbox");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const def: (typeof FILTER_DEFS)[number] =
        FILTER_DEFS.find((f) => f.key === filter) ?? FILTER_DEFS[0]!;
      const [rows, emps] = await Promise.all([
        listTasks({ status: def.statuses ?? undefined, limit: 200 }),
        employees.length === 0 ? listEmployees() : Promise.resolve(employees),
      ]);
      setTasks(rows);
      if (employees.length === 0) setEmployees(emps);
      setStatus("ready");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, [filter, employees]);

  useEffect(() => {
    void load();
  }, [load]);

  const empNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, e.name);
    return m;
  }, [employees]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      inbox: 0,
      active: 0,
      needs_user: 0,
      done: 0,
      failed: 0,
      all: tasks.length,
    };
    for (const t of tasks) {
      if (["queued", "running", "needs_input", "needs_approval"].includes(t.status)) c.inbox++;
      if (t.status === "running") c.active++;
      if (t.status === "needs_input" || t.status === "needs_approval") c.needs_user++;
      if (t.status === "completed") c.done++;
      if (t.status === "failed" || t.status === "cancelled") c.failed++;
    }
    return c;
  }, [tasks]);

  return (
    <AppShell
      title="任务"
      actions={
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="new-task"
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base"
        >
          + 新任务
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-6">
          <p className="mb-5 text-sm text-text-muted">
            任务是异步工作单元 · 发起后可以直接关掉页面,员工在后台跑完后你回来看结果。
            让 Lead Agent 在对话里派,也可以右上 &ldquo;+ 新任务&rdquo; 手动建。
          </p>

          <nav
            aria-label="任务筛选"
            className="mb-4 flex items-center gap-1 rounded-md border border-border bg-surface p-1 w-fit"
          >
            {FILTER_DEFS.map((f) => {
              const active = filter === f.key;
              const count = counts[f.key];
              return (
                <button
                  key={f.key}
                  data-testid={`filter-${f.key}`}
                  onClick={() => setFilter(f.key)}
                  className={`text-xs px-3 py-1.5 rounded transition-colors duration-base ${
                    active
                      ? "bg-surface-2 text-text"
                      : "text-text-muted hover:text-text"
                  }`}
                >
                  {f.label}
                  {count > 0 && (
                    <span
                      className={`ml-1.5 font-mono text-[10px] ${
                        active ? "text-text-muted" : "text-text-subtle"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {status === "loading" && (
            <div data-testid="tasks-loading">
              <LoadingState title="加载任务" />
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="tasks-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载任务失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{error}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors duration-base"
              >
                重试
              </button>
            </div>
          )}

          {status === "ready" && tasks.length === 0 && (
            <EmptyHint filter={filter} onCreate={() => setDrawerOpen(true)} />
          )}

          {status === "ready" && tasks.length > 0 && (
            <ul
              data-testid="tasks-list"
              className="flex flex-col gap-2"
              aria-label="任务列表"
            >
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  assigneeName={empNameById.get(t.assignee_id) ?? t.assignee_id}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <NewTaskDrawer
        open={drawerOpen}
        employees={employees}
        onClose={() => setDrawerOpen(false)}
        onCreated={async () => {
          setDrawerOpen(false);
          setFilter("inbox");
          await load();
        }}
      />
    </AppShell>
  );
}

function EmptyHint({
  filter,
  onCreate,
}: {
  filter: FilterKey;
  onCreate: () => void;
}) {
  const msg: Record<FilterKey, string> = {
    inbox: "收件箱是空的。",
    active: "现在没有执行中的任务。",
    needs_user: "没有任务在等你回答或审批。",
    done: "还没有已完成的任务。",
    failed: "没有失败或取消的任务。",
    all: "还没有任务。",
  };
  return (
    <div
      data-testid="tasks-empty"
      className="rounded-xl border border-dashed border-border p-10 text-center"
    >
      <p className="text-sm text-text mb-1">{msg[filter]}</p>
      <p className="text-xs text-text-subtle mb-4">
        让 Lead Agent 在对话里派一个,或直接
      </p>
      <button
        onClick={onCreate}
        className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-surface-2 transition-colors duration-base"
      >
        + 新建任务
      </button>
    </div>
  );
}

function TaskRow({ task, assigneeName }: { task: TaskDto; assigneeName: string }) {
  const urgent = task.status === "needs_input" || task.status === "needs_approval";
  const updated = new Date(task.updated_at);
  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        data-testid={`task-${task.id}`}
        className={`group block rounded-xl border bg-surface p-4 transition-colors duration-base ${
          urgent
            ? "border-warning/40 hover:border-warning"
            : "border-border hover:border-border-strong"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <TaskStatusPill status={task.status} />
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                {sourceLabel(task.source)}
              </span>
              <span className="font-mono text-[10px] text-text-subtle">
                {task.id}
              </span>
            </div>
            <p className="text-sm font-medium text-text group-hover:text-primary transition-colors duration-base truncate">
              {task.title}
            </p>
            <p className="mt-1 text-xs text-text-muted line-clamp-2">
              {urgent && task.pending_input_question
                ? task.pending_input_question
                : task.result_summary ?? task.goal}
            </p>
          </div>
          <div className="shrink-0 text-right flex flex-col gap-1 items-end">
            <div className="text-[11px] text-text-muted">指派给</div>
            <div className="text-xs text-text truncate max-w-[10rem]">
              {assigneeName}
            </div>
            <div className="font-mono text-[10px] text-text-subtle mt-1">
              {updated.toLocaleString()}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
