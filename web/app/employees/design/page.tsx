"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/PageHeader";
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

/**
 * /employees/design · Employee designer · ADR 0016 V2 Azure Live polish.
 *
 * Left rail = roster (draft + published) with gradient accents on selection.
 * Right column = DesignForm body + hero toolbar (status chip · try · publish
 * · delete). Data / mutation contract unchanged: REST + meta-tool parity (§3.1).
 */

function avatarInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function modelDisplay(modelRef: string, fallback: string): string {
  if (!modelRef) return fallback;
  const idx = modelRef.indexOf("/");
  return idx >= 0 ? modelRef.slice(idx + 1) : modelRef;
}

export default function EmployeeDesignPage() {
  const t = useTranslations("employees.design");
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeDto[] | null>(null);
  const [skills, setSkills] = useState<SkillDto[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busyAction, setBusyAction] = useState<"publish" | "delete" | "chat" | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<EmployeeDto | null>(null);

  async function load(preserveSelected = true) {
    try {
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
    setDeleteTarget(emp);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyAction("delete");
    setError("");
    try {
      await deleteEmployee(deleteTarget.id);
      setSelectedId("");
      setDeleteTarget(null);
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

  const draftCount = employees?.filter((e) => e.status === "draft").length ?? 0;
  const publishedCount =
    employees?.filter((e) => e.status === "published").length ?? 0;

  return (
    <AppShell title={t("shellTitle")}>
      <div className="flex h-full min-h-0">
        <aside
          data-testid="design-employee-list"
          className="w-72 shrink-0 border-r border-border bg-surface overflow-y-auto"
        >
          <div className="p-4 border-b border-border space-y-3">
            <div>
              <h2 className="text-[13px] font-semibold text-text">{t("rosterTitle")}</h2>
              <p className="mt-0.5 text-caption text-text-muted">
                {t("rosterCounts", { draft: draftCount, published: publishedCount })}
              </p>
            </div>
            <button
              data-testid="design-new-employee"
              onClick={() => setSelectedId("")}
              className={`w-full inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-[12px] font-medium transition duration-base ${
                selectedId === ""
                  ? "bg-primary text-primary-fg shadow-soft-sm"
                  : "bg-surface-2 text-text hover:bg-primary-muted hover:text-primary"
              }`}
            >
              <Icon name="user-plus" size={14} strokeWidth={2} />
              {t("newEmployee")}
              <Icon
                name="arrow-right"
                size={12}
                className="ml-auto opacity-70"
              />
            </button>
          </div>
          {employees === null ? (
            <div className="p-4">
              <LoadingState title={t("loadingEmployees")} />
            </div>
          ) : employees.length === 0 ? (
            <div className="p-5 text-center">
              <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl bg-primary-muted text-primary">
                <Icon name="users" size={16} />
              </div>
              <p className="text-[12px] text-text-muted">
                {t("rosterEmpty")}
              </p>
            </div>
          ) : (
            <ul className="py-2">
              {employees.map((e) => {
                const active = selectedId === e.id;
                const isDraft = e.status === "draft";
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      data-testid={`design-emp-${e.id}`}
                      onClick={() => setSelectedId(e.id)}
                      className={`relative w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-fast ${
                        active
                          ? "bg-primary-muted text-text"
                          : "text-text hover:bg-surface-2"
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r bg-primary"
                        />
                      )}
                      <div
                        className="grid h-8 w-8 place-items-center rounded-lg text-primary-fg text-[11px] font-semibold shrink-0 shadow-soft-sm"
                        style={{
                          background: isDraft
                            ? "linear-gradient(135deg, var(--color-surface-3), var(--color-surface-4))"
                            : "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
                        }}
                        aria-hidden="true"
                      >
                        {avatarInitials(e.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-[13px] truncate ${
                              active
                                ? "text-primary font-semibold"
                                : "font-medium text-text"
                            } ${isDraft ? "italic" : ""}`}
                          >
                            {e.name}
                          </span>
                          {e.is_lead_agent && (
                            <Icon
                              name="sparkles"
                              size={10}
                              className="shrink-0 text-primary"
                            />
                          )}
                        </div>
                        <p className="font-mono text-caption text-text-subtle truncate">
                          {modelDisplay(e.model_ref, t("fallbackModel"))}
                        </p>
                      </div>
                      {isDraft && (
                        <span
                          data-testid={`design-emp-${e.id}-draft-tag`}
                          className="inline-flex items-center h-5 px-1.5 rounded bg-warning-soft text-warning font-mono text-[10px] uppercase tracking-wider shrink-0"
                        >
                          {t("draftTag")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-8 py-8 space-y-6 animate-fade-up">
            {!ready && (selectedId !== "" || employees === null) ? (
              <LoadingState title={t("loadingForm")} />
            ) : (
              <>
                {selectedId === "" ? (
                  <>
                    <PageHeader
                      title={t("hireHeading")}
                      subtitle={t("hireSubtitle")}
                    />
                    <CreateHint />
                  </>
                ) : selected ? (
                  <EmployeeToolbar
                    employee={selected}
                    busyAction={busyAction}
                    onPublish={() => onPublish(selected.id)}
                    onDelete={() => onDelete(selected)}
                    onTry={() => onTry(selected)}
                  />
                ) : null}

                {error && (
                  <div
                    data-testid="design-page-error"
                    className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
                  >
                    <Icon
                      name="alert-circle"
                      size={14}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="min-w-0 break-words font-mono">{error}</span>
                  </div>
                )}

                {ready && selectedId === "" && (
                  <DesignForm
                    skills={skills}
                    mcpServers={mcpServers}
                    onCreated={async (emp) => {
                      await load();
                      setSelectedId(emp.id);
                    }}
                  />
                )}
                {ready && selectedId !== "" && selected && (
                  <DesignForm
                    key={selected.id}
                    skills={skills}
                    mcpServers={mcpServers}
                    initial={selected}
                    onSaved={async () => {
                      await load();
                    }}
                  />
                )}
                {ready && selectedId !== "" && !selected && (
                  <p className="text-[12px] text-text-muted">{t("missingEmployee")}</p>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("deleteTitle", { name: deleteTarget?.name ?? "" })}
        message={t("deleteMessage")}
        confirmLabel={t("deleteConfirm")}
        danger
        busy={busyAction === "delete"}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

function CreateHint() {
  const t = useTranslations("employees.design");
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm p-5">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/70 via-primary to-accent"
      />
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-muted text-primary shrink-0">
          <Icon name="sparkles" size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-text">
            {t("templateHeading")}
          </h3>
          <p className="mt-1 text-caption text-text-muted leading-relaxed">
            {t("templateBody")}
          </p>
        </div>
      </div>
    </div>
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
  const t = useTranslations("employees.design");
  const isDraft = employee.status === "draft";
  const busy = busyAction !== null;
  return (
    <section
      data-testid="design-toolbar"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/20 shadow-soft-lg p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl opacity-50"
        style={{ background: "var(--color-primary-glow)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/70 via-primary to-accent"
      />

      <div className="relative flex items-start gap-4 flex-wrap">
        <div
          className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg text-[16px] font-bold shadow-soft shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          {avatarInitials(employee.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-tight text-text truncate">
              {employee.name}
            </h2>
            <span
              data-testid={`design-status-chip-${employee.status}`}
              className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-caption font-mono font-semibold uppercase tracking-wider ${
                isDraft
                  ? "bg-warning-soft text-warning"
                  : "bg-success-soft text-success"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${isDraft ? "bg-warning" : "bg-success"}`}
              />
              {isDraft ? t("statusDraft") : t("statusPublished")}
            </span>
            {employee.is_lead_agent && (
              <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-primary text-primary-fg text-caption font-medium shadow-soft-sm">
                <Icon name="sparkles" size={10} />
                {t("leadBadge")}
              </span>
            )}
          </div>
          <p className="mt-1 font-mono text-caption text-text-subtle truncate">
            {t("toolbarSummary", {
              model: employee.model_ref || t("platformDefaultModel"),
              tools: employee.tool_ids.length,
              skills: employee.skill_ids.length,
              iter: employee.max_iterations,
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onTry}
            disabled={busy}
            data-testid="design-try"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base disabled:opacity-40"
          >
            {busyAction === "chat" ? (
              <>
                <Icon name="loader" size={12} className="animate-spin" />
                {t("openingChat")}
              </>
            ) : (
              <>
                <Icon name="play" size={12} strokeWidth={2.25} />
                {t("tryEmployee")}
              </>
            )}
          </button>
          {isDraft && (
            <button
              type="button"
              onClick={onPublish}
              disabled={busy}
              data-testid="design-publish"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary hover:bg-primary-hover text-primary-fg text-[12px] font-medium shadow-soft-sm hover:-translate-y-px transition duration-base disabled:opacity-40"
            >
              {busyAction === "publish" ? (
                <>
                  <Icon name="loader" size={12} className="animate-spin" />
                  {t("publishing")}
                </>
              ) : (
                <>
                  <Icon name="check-circle-2" size={12} strokeWidth={2} />
                  {t("publish")}
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy || employee.is_lead_agent}
            title={employee.is_lead_agent ? t("leadCannotDelete") : t("deleteHint")}
            data-testid="design-delete"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-danger/40 bg-surface text-danger hover:bg-danger-soft text-[12px] font-medium shadow-soft-sm transition duration-base disabled:opacity-30 disabled:hover:bg-surface"
          >
            <Icon name="trash-2" size={12} strokeWidth={2} />
            {busyAction === "delete" ? t("deleting") : t("delete")}
          </button>
        </div>
      </div>
    </section>
  );
}
