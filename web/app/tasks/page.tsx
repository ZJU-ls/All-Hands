"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/icon";
import { NewTaskDrawer } from "@/components/tasks/NewTaskDrawer";
import { TaskStatusPill } from "@/components/tasks/TaskStatusPill";
import { TraceChip } from "@/components/runs/TraceChip";
import { listEmployees, type EmployeeDto } from "@/lib/api";
import { listTasks, type TaskDto, type TaskStatus } from "@/lib/tasks-api";

type FilterKey = "inbox" | "active" | "needs_user" | "done" | "failed" | "all";

type FilterLabelKey =
  | "filterInbox"
  | "filterNeedsUser"
  | "filterActive"
  | "filterDone"
  | "filterFailed"
  | "filterAll";

const FILTER_DEFS: {
  key: FilterKey;
  labelKey: FilterLabelKey;
  icon: IconName;
  statuses: TaskStatus[] | null;
}[] = [
  {
    key: "inbox",
    labelKey: "filterInbox",
    icon: "layout-grid",
    statuses: ["queued", "running", "needs_input", "needs_approval"],
  },
  { key: "needs_user", labelKey: "filterNeedsUser", icon: "user", statuses: ["needs_input", "needs_approval"] },
  { key: "active", labelKey: "filterActive", icon: "loader", statuses: ["running"] },
  { key: "done", labelKey: "filterDone", icon: "check-circle-2", statuses: ["completed"] },
  { key: "failed", labelKey: "filterFailed", icon: "alert-circle", statuses: ["failed", "cancelled"] },
  { key: "all", labelKey: "filterAll", icon: "list", statuses: null },
];

export default function TasksPage() {
  const t = useTranslations("tasks.list");
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
      title={t("shellTitle")}
      actions={
        <button
          onClick={() => setDrawerOpen(true)}
          data-testid="new-task"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-glow-sm"
        >
          <Icon name="plus" size={14} /> {t("newTask")}
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-8 p-8 animate-fade-up">
          <PageHeader
            title={t("pageTitle")}
            count={tasks.length || undefined}
            subtitle={t("subtitle")}
          />

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <HeroStat
              label={t("kpiInbox")}
              value={counts.inbox}
              hint={counts.inbox > 0 ? t("kpiInboxHasPending") : t("kpiInboxAllClear")}
              icon="layout-grid"
            />
            <Stat label={t("kpiNeedsUser")} value={counts.needs_user} icon="user" tone="warning" />
            <Stat label={t("kpiActive")} value={counts.active} icon="loader" tone="primary" />
            <Stat label={t("kpiDone")} value={counts.done} icon="check-circle-2" tone="success" />
          </div>

          {/* Filter pills (V2: bg-surface-2 wrapper, bg-surface shadow-soft-sm active) */}
          <nav
            aria-label={t("filterAriaLabel")}
            className="inline-flex items-center gap-0.5 rounded-xl border border-border bg-surface-2 p-1"
          >
            {FILTER_DEFS.map((f) => {
              const active = filter === f.key;
              const count = counts[f.key];
              return (
                <button
                  key={f.key}
                  data-testid={`filter-${f.key}`}
                  onClick={() => setFilter(f.key)}
                  className={
                    active
                      ? "inline-flex h-8 items-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-semibold text-text shadow-soft-sm transition duration-fast"
                      : "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-text-muted hover:text-text transition duration-fast"
                  }
                >
                  <Icon name={f.icon} size={12} />
                  {t(f.labelKey)}
                  {count > 0 && (
                    <span
                      className={
                        active
                          ? "inline-flex h-4 items-center rounded bg-primary-muted px-1.5 font-mono text-[10px] text-primary"
                          : "inline-flex h-4 items-center rounded bg-surface px-1.5 font-mono text-[10px] text-text-subtle"
                      }
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {status === "loading" && (
            <div data-testid="tasks-loading" className="flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 rounded-xl border border-border bg-gradient-to-r from-surface via-surface-2 to-surface bg-[length:200%_100%] animate-shimmer"
                />
              ))}
            </div>
          )}

          {status === "error" && (
            <div
              data-testid="tasks-error"
              className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 animate-fade-up"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
                <Icon name="alert-circle" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-danger">{t("loadFailed")}</div>
                <div className="mt-1 truncate font-mono text-caption text-danger/80">{error}</div>
                <button
                  onClick={() => void load()}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/30 bg-surface px-3 text-caption font-medium text-danger hover:bg-danger/10 transition duration-fast"
                >
                  <Icon name="refresh" size={12} /> {t("retry")}
                </button>
              </div>
            </div>
          )}

          {status === "ready" && tasks.length === 0 && (
            <EmptyHint filter={filter} onCreate={() => setDrawerOpen(true)} />
          )}

          {status === "ready" && tasks.length > 0 && (
            <ul
              data-testid="tasks-list"
              className="flex flex-col gap-3"
              aria-label={t("listAriaLabel")}
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

function HeroStat({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: number;
  hint: string;
  icon: IconName;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 text-primary-fg shadow-soft-sm"
      style={{
        background:
          "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl"
        style={{ background: "var(--color-accent)", opacity: 0.4 }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-caption font-mono uppercase tracking-wider opacity-85">
            {label}
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
          <div className="mt-1 text-caption font-mono opacity-90">{hint}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/15">
          <Icon name={icon} size={16} />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: IconName;
  tone: "primary" | "success" | "warning" | "danger";
}) {
  const toneClass: Record<typeof tone, string> = {
    primary: "bg-primary-muted text-primary",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:border-border-strong hover:shadow-soft hover:-translate-y-px">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-caption font-mono uppercase tracking-wider text-text-muted">
            {label}
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-text">{value}</div>
        </div>
        <div className={`grid h-9 w-9 place-items-center rounded-lg ${toneClass[tone]}`}>
          <Icon name={icon} size={16} />
        </div>
      </div>
    </div>
  );
}

function EmptyHint({
  filter,
  onCreate,
}: {
  filter: FilterKey;
  onCreate: () => void;
}) {
  const t = useTranslations("tasks.list");
  const msg: Record<FilterKey, string> = {
    inbox: t("emptyInbox"),
    active: t("emptyActive"),
    needs_user: t("emptyNeedsUser"),
    done: t("emptyDone"),
    failed: t("emptyFailed"),
    all: t("emptyAll"),
  };
  return (
    <div
      data-testid="tasks-empty"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface p-14 shadow-soft-sm animate-fade-up"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(500px 300px at 20% 0%, var(--color-primary-soft) 0%, transparent 60%), radial-gradient(500px 300px at 80% 100%, var(--color-accent) 0%, transparent 65%)",
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
          <Icon name="check-circle-2" size={28} />
        </div>
        <h3 className="mt-6 text-lg font-semibold tracking-tight">{msg[filter]}</h3>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          {t("emptyBody")}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={onCreate}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-fg shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-glow-sm"
          >
            <Icon name="plus" size={14} /> {t("newTaskCta")}
          </button>
          <Link
            href="/chat"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface px-5 text-sm font-medium text-text shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft"
          >
            <Icon name="sparkles" size={14} className="text-primary" /> {t("askLead")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, assigneeName }: { task: TaskDto; assigneeName: string }) {
  const t = useTranslations("tasks.list");
  const sourceT = useTranslations("tasks.source");
  const locale = useLocale();
  const urgent = task.status === "needs_input" || task.status === "needs_approval";
  const updated = new Date(task.updated_at);
  const running = task.status === "running";
  const failed = task.status === "failed" || task.status === "cancelled";
  return (
    <li>
      <Link
        href={`/tasks/${task.id}`}
        data-testid={`task-${task.id}`}
        className={`group relative block overflow-hidden rounded-xl border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft ${
          urgent
            ? "border-warning/40 hover:border-warning"
            : failed
            ? "border-danger/30 hover:border-danger/60"
            : "border-border hover:border-border-strong"
        }`}
      >
        {urgent && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-warning to-transparent"
          />
        )}
        <div className="flex items-start gap-3">
          <div
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
              urgent
                ? "bg-warning-soft text-warning"
                : running
                ? "bg-primary-muted text-primary"
                : failed
                ? "bg-danger-soft text-danger"
                : "bg-surface-2 text-text-muted"
            }`}
          >
            <Icon
              name={
                urgent
                  ? "alert-triangle"
                  : running
                  ? "loader"
                  : failed
                  ? "alert-circle"
                  : "check-circle-2"
              }
              size={16}
              className={running ? "animate-spin-slow" : ""}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <TaskStatusPill status={task.status} />
              <span className="inline-flex h-5 items-center rounded bg-surface-2 px-1.5 font-mono text-[10px] text-text-muted">
                {sourceT(task.source)}
              </span>
              <span className="font-mono text-[10px] text-text-subtle">{task.id}</span>
            </div>
            <p className="mt-1.5 truncate text-sm font-medium text-text transition-colors duration-base group-hover:text-primary">
              {task.title}
            </p>
            <p className="mt-1 line-clamp-2 text-caption text-text-muted">
              {urgent && task.pending_input_question
                ? task.pending_input_question
                : task.result_summary ?? task.goal}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            <div className="text-[10px] font-mono uppercase tracking-wider text-text-subtle">
              {t("assignedTo")}
            </div>
            <div className="max-w-[10rem] truncate text-sm font-medium text-text">
              {assigneeName}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-text-subtle">
              {updated.toLocaleString(locale)}
            </div>
            {task.run_ids.length > 0 && task.run_ids[0] && (
              <TraceChip runId={task.run_ids[0]} label="trace" variant="page" />
            )}
          </div>
          <Icon
            name="arrow-right"
            size={14}
            className="mt-1 shrink-0 self-center text-text-subtle opacity-0 transition-[opacity,transform] duration-fast group-hover:translate-x-0.5 group-hover:opacity-100 group-hover:text-primary"
          />
        </div>
      </Link>
    </li>
  );
}
