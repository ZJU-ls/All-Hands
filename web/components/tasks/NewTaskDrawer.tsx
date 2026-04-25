"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@/components/ui/icon";
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

/**
 * V2 (ADR 0016) · right-side drawer: `w-[440px] bg-surface border-l shadow-soft-lg`,
 * header with a `Icon` tile + title, form sections separated by section labels,
 * primary submit button with inline spinner. Scrim remains black/50 with
 * click-to-close; keyboard ESC still closes.
 */

const INPUT_CLS =
  "w-full h-10 rounded-md border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-fast";

const TEXTAREA_CLS =
  "w-full min-h-[96px] rounded-md border border-border bg-surface px-3 py-2 font-mono text-[12px] text-text placeholder:text-text-subtle focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:border-primary transition-colors duration-fast resize-y";

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
  const t = useTranslations("tasks.newDrawer");
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
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-title"
      onClick={onClose}
    >
      <div
        data-testid="new-task-drawer"
        className="flex h-full w-full max-w-[440px] flex-col border-l border-border bg-surface shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted text-primary">
              <Icon name="sparkles" size={16} />
            </span>
            <div>
              <h3
                id="new-task-title"
                className="text-[15px] font-semibold text-text"
              >
                {t("title")}
              </h3>
              <p className="mt-0.5 text-[12px] text-text-muted">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            <Field
              label={t("fieldTitle")}
              required
              htmlFor="task-title-input"
            >
              <input
                id="task-title-input"
                data-testid="task-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={t("titlePlaceholder")}
                className={INPUT_CLS}
              />
            </Field>

            <Field label={t("fieldAssignee")} required>
              {employees.length === 0 ? (
                <p className="flex items-center gap-1.5 rounded-md border border-warning/20 bg-warning-soft px-3 py-2 text-[12px] text-warning">
                  <Icon name="alert-triangle" size={13} />
                  {t("noEmployees")}
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
                  ariaLabel={t("fieldAssignee")}
                  className="w-full"
                />
              )}
            </Field>

            <Field label={t("fieldGoal")} required htmlFor="task-goal-input">
              <textarea
                id="task-goal-input"
                data-testid="task-goal"
                value={draft.goal}
                onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
                rows={4}
                placeholder={t("goalPlaceholder")}
                className={TEXTAREA_CLS}
              />
            </Field>

            <Field
              label={t("fieldDod")}
              required
              htmlFor="task-dod-input"
              hint={t("dodHint")}
              footer={t("dodFooter")}
            >
              <textarea
                id="task-dod-input"
                data-testid="task-dod"
                value={draft.dod}
                onChange={(e) => setDraft({ ...draft, dod: e.target.value })}
                rows={6}
                placeholder={t("dodPlaceholder")}
                className={TEXTAREA_CLS}
              />
            </Field>

            <Field label={t("fieldBudget")} htmlFor="task-budget-input">
              <input
                id="task-budget-input"
                data-testid="task-budget"
                type="number"
                min={1}
                value={draft.token_budget}
                onChange={(e) => setDraft({ ...draft, token_budget: e.target.value })}
                placeholder={t("budgetPlaceholder")}
                className={`${INPUT_CLS} font-mono`}
              />
            </Field>

            {err && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2"
              >
                <Icon
                  name="alert-circle"
                  size={14}
                  className="mt-0.5 shrink-0 text-danger"
                />
                <p
                  className="font-mono text-[11px] text-danger break-all"
                  data-testid="task-create-error"
                >
                  {err}
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 p-4">
          <p className="text-[11px] text-text-subtle">
            {t("footerHint")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-[13px] text-text-muted transition-colors duration-fast hover:border-border-strong hover:text-text"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              data-testid="task-submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-fg shadow-soft-sm transition-colors duration-fast hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && (
                <span className="inline-block h-3 w-3 rounded-full border-2 border-primary-fg/30 border-t-primary-fg animate-spin" />
              )}
              {submitting ? t("creating") : t("submit")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  footer,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  footer?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium text-text-muted"
        >
          {label}
          {required && <span className="ml-1 text-danger">*</span>}
        </label>
        {hint && <span className="text-[10px] text-text-subtle">{hint}</span>}
      </div>
      {children}
      {footer && <p className="text-[11px] text-text-subtle">{footer}</p>}
    </div>
  );
}
