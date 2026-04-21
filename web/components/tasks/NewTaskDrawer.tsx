"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
import type { EmployeeDto } from "@/lib/api";
import { createTask } from "@/lib/tasks-api";

type Draft = {
  title: string;
  assignee_id: string;
  goal: string;
  dod: string;
  token_budget: string;
};

const EMPTY: Draft = {
  title: "",
  assignee_id: "",
  goal: "",
  dod: "",
  token_budget: "",
};

const DOD_PLACEHOLDER = `- 输出格式:(例如 markdown / PDF / Figma 链接)
- 必须包含:(3-5 条关键内容)
- 绝对不能包含:(常见的误区)
- 验收信号:(我怎么一眼就知道 done 了)`;

export function NewTaskDrawer({
  open,
  employees,
  onClose,
  onCreated,
}: {
  open: boolean;
  employees: EmployeeDto[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft({ ...EMPTY, assignee_id: employees[0]?.id ?? "" });
    setErr("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, employees, onClose]);

  if (!open) return null;

  const canSubmit =
    draft.title.trim().length > 0 &&
    draft.goal.trim().length > 0 &&
    draft.dod.trim().length > 0 &&
    draft.assignee_id.trim().length > 0 &&
    !submitting;

  async function submit() {
    setSubmitting(true);
    setErr("");
    try {
      const budget = draft.token_budget.trim()
        ? Number.parseInt(draft.token_budget, 10)
        : null;
      await createTask({
        title: draft.title.trim(),
        goal: draft.goal.trim(),
        dod: draft.dod.trim(),
        assignee_id: draft.assignee_id,
        token_budget: Number.isNaN(budget as number) ? null : budget,
      });
      await onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-title"
      onClick={onClose}
    >
      <div
        data-testid="new-task-drawer"
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3
              id="new-task-title"
              className="text-sm font-semibold text-text"
            >
              新任务
            </h3>
            <p className="text-xs text-text-subtle mt-0.5">
              发起后可以关掉页面,员工会在后台跑。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-text-muted hover:text-text transition-colors duration-base"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          <div>
            <label className="text-xs text-text-muted block mb-1">
              标题 <span className="text-danger">*</span>
            </label>
            <input
              data-testid="task-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="下周发布日志整理"
              className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base"
            />
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">
              指派给 <span className="text-danger">*</span>
            </label>
            {employees.length === 0 ? (
              <p className="text-xs text-warning">
                还没有员工 · 请先在&ldquo;员工&rdquo;里新建一位。
              </p>
            ) : (
              <Select
                value={draft.assignee_id}
                onChange={(v) => setDraft({ ...draft, assignee_id: v })}
                options={employees.map((emp) => ({
                  value: emp.id,
                  label: emp.name,
                  hint: emp.id,
                }))}
                testId="task-assignee"
                ariaLabel="指派给"
                className="w-full"
              />
            )}
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">
              目标(Goal) <span className="text-danger">*</span>
            </label>
            <textarea
              data-testid="task-goal"
              value={draft.goal}
              onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
              rows={4}
              placeholder="把上周 release 的 PR 整理成给客户的中文 release note,重点突出 XYZ 功能。"
              className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base font-mono resize-y"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-text-muted">
                Definition of Done(DoD) <span className="text-danger">*</span>
              </label>
              <span className="text-[10px] text-text-subtle">
                员工以此判定&ldquo;做完了&rdquo;
              </span>
            </div>
            <textarea
              data-testid="task-dod"
              value={draft.dod}
              onChange={(e) => setDraft({ ...draft, dod: e.target.value })}
              rows={6}
              placeholder={DOD_PLACEHOLDER}
              className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base font-mono resize-y"
            />
            <p className="mt-1 text-[11px] text-text-subtle">
              写得越具体,员工越不容易跑偏。至少回答&ldquo;输出什么 / 必须包含什么 / 不能包含什么&rdquo;。
            </p>
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">
              Token 预算(可选)
            </label>
            <input
              data-testid="task-budget"
              type="number"
              min={1}
              value={draft.token_budget}
              onChange={(e) => setDraft({ ...draft, token_budget: e.target.value })}
              placeholder="留空则无限制"
              className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors duration-base font-mono"
            />
          </div>

          {err && (
            <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
              <p className="text-xs text-danger font-mono" data-testid="task-create-error">
                {err}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-border">
          <p className="text-[11px] text-text-subtle">
            缺 DoD 的任务不会进入执行队列。
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text transition-colors duration-base"
            >
              取消
            </button>
            <button
              onClick={() => void submit()}
              disabled={!canSubmit}
              data-testid="task-submit"
              className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors duration-base"
            >
              {submitting ? "创建中…" : "创建任务"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
