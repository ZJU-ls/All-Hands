"use client";

/**
 * Local Workspaces · /settings/workspaces
 *
 * Configure host directories the `allhands.local-files` skill is allowed to
 * read / write / shell into. Without a workspace, all 7 file tools refuse.
 *
 * REST: GET/POST/PATCH/DELETE /api/workspaces (sibling of meta tools
 * list/add/update/remove_local_workspace · L01 / Tool First).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/icon";

type Workspace = {
  id: string;
  name: string;
  root_path: string;
  read_only: boolean;
  denied_globs: string[];
  created_at: string;
  updated_at: string;
};

export default function WorkspacesPage() {
  const t = useTranslations("workspaces");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [showForm, setShowForm] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWorkspaces((await res.json()) as Workspace[]);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onDelete = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    if (res.ok) await reload();
  };

  const onToggleReadOnly = async (ws: Workspace) => {
    const res = await fetch(`/api/workspaces/${ws.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read_only: !ws.read_only }),
    });
    if (res.ok) await reload();
  };

  return (
    <AppShell title={t("title")}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-8 py-10 animate-fade-up">
          <div className="flex items-start justify-between">
            <PageHeader title={t("title")} subtitle={t("subtitle")} />
            <button
              type="button"
              onClick={() => setShowForm((s) => !s)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Icon name={showForm ? "x" : "plus"} size={16} />
              {showForm ? t("cancel") : t("addCta")}
            </button>
          </div>

          {showForm && (
            <AddWorkspaceForm
              onSuccess={async () => {
                setShowForm(false);
                await reload();
              }}
            />
          )}

          <section className="rounded-xl border border-border bg-surface p-5 shadow-soft-sm">
            {loading && (
              <div className="text-sm text-text-muted">{t("loading")}</div>
            )}
            {error && (
              <div className="text-sm text-danger">
                {t("loadFailed")}: {error}
              </div>
            )}
            {!loading && !error && workspaces.length === 0 && <EmptyState />}
            {!loading && workspaces.length > 0 && (
              <ul className="space-y-3">
                {workspaces.map((ws) => (
                  <li
                    key={ws.id}
                    className="rounded-lg border border-border bg-surface-2/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon name="folder" size={16} className="text-primary" />
                          <span className="text-base font-medium text-text">
                            {ws.name}
                          </span>
                          {ws.read_only && (
                            <span className="rounded bg-warning/20 px-2 py-0.5 text-[11px] text-warning">
                              {t("readOnlyBadge")}
                            </span>
                          )}
                        </div>
                        <code className="mt-1 block break-all text-caption text-text-muted">
                          {ws.root_path}
                        </code>
                        {ws.denied_globs.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {ws.denied_globs.map((g) => (
                              <code
                                key={g}
                                className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-text-subtle"
                              >
                                {t("denyPrefix")} {g}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onToggleReadOnly(ws)}
                          className="rounded border border-border px-3 py-1 text-caption text-text-muted hover:border-primary hover:text-primary"
                        >
                          {ws.read_only ? t("allowWrites") : t("makeReadOnly")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(ws.id)}
                          className="rounded border border-border px-3 py-1 text-caption text-danger hover:border-danger"
                        >
                          {t("delete")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="rounded-xl border border-border bg-surface-2/40 p-4 text-caption text-text-muted">
            <div className="flex items-start gap-2">
              <Icon name="info" size={14} className="mt-0.5 text-text-subtle" />
              <div>{t("footnote")}</div>
            </div>
          </div>

          <div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-caption text-text-muted hover:text-primary"
            >
              <Icon name="arrow-left" size={14} />
              {t("backToSettings")}
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function EmptyState() {
  const t = useTranslations("workspaces");
  return (
    <div className="py-8 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-primary-muted text-primary">
        <Icon name="folder" size={20} />
      </div>
      <div className="text-base font-medium text-text">{t("emptyTitle")}</div>
      <div className="mt-1 text-caption text-text-muted">
        {t("emptyDescription")}
      </div>
    </div>
  );
}

function AddWorkspaceForm({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const t = useTranslations("workspaces");
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr("");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          root_path: rootPath.trim(),
          read_only: readOnly,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.detail || `HTTP ${res.status}`);
        return;
      }
      setName("");
      setRootPath("");
      setReadOnly(false);
      await onSuccess();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-soft-sm"
    >
      <h3 className="text-base font-semibold text-text">{t("addTitle")}</h3>
      <div>
        <label className="mb-1 block text-caption text-text-muted">
          {t("nameLabel")}
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          required
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="mb-1 block text-caption text-text-muted">
          {t("rootPathLabel")}
        </label>
        <input
          value={rootPath}
          onChange={(e) => setRootPath(e.target.value)}
          placeholder="/Users/you/code/myproject"
          required
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text outline-none focus:border-primary"
        />
        <div className="mt-1 text-caption text-text-subtle">
          {t("rootPathHint")}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={readOnly}
          onChange={(e) => setReadOnly(e.target.checked)}
        />
        {t("readOnlyLabel")}
      </label>
      {err && (
        <div className="rounded border border-danger/40 bg-danger/10 p-3 text-caption text-danger">
          {err}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
