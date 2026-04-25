"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { Icon, type IconName } from "@/components/ui/icon";
import { SkillExplainer } from "@/components/skills/SkillExplainer";

/**
 * Skill detail page · ADR 0016 V2 Azure Live polish.
 *
 * Breadcrumb + eyebrow · gradient hero card (icon tile + name + meta chips +
 * actions) · underline tab group · sectioned body cards with hairline top
 * accent · shimmer-friendly loading / error / not-found states.
 *
 * All fetch / state / mutation / navigation / data-testid preserved verbatim.
 */

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

const TABS: ReadonlyArray<readonly [Tab, IconName]> = [
  ["overview", "layout-grid"],
  ["prompt", "file-code-2"],
  ["versions", "clock"],
  ["dependencies", "share-2"],
];

export default function SkillDetailPage() {
  const t = useTranslations("skills.detail");
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
    <AppShell title={skill?.name ?? t("appShellFallback")}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          <Breadcrumb name={skill?.name} />

          {status === "loading" && (
            <div data-testid="skill-detail-loading">
              <LoadingState title={t("loadingTitle")} />
            </div>
          )}

          {status === "notfound" && (
            <div data-testid="skill-detail-notfound">
              <EmptyState
                title={t("notFoundTitle", { id })}
                description={t("notFoundDescription")}
              >
                <Link
                  href="/skills"
                  className="inline-flex items-center gap-1.5 mt-2 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
                >
                  <Icon name="arrow-left" size={12} />
                  {t("backToList")}
                </Link>
              </EmptyState>
            </div>
          )}

          {status === "error" && (
            <div data-testid="skill-detail-error">
              <ErrorState
                title={t("loadErrorTitle")}
                detail={error}
                action={{ label: t("retry"), onClick: () => void load() }}
              />
            </div>
          )}

          {status === "ready" && skill && (
            <>
              <Hero
                skill={skill}
                dependentCount={dependents.length}
                onDelete={() => setConfirmDelete(true)}
              />

              <div
                role="tablist"
                aria-label={t("tabsLabel")}
                className="inline-flex items-center gap-1 rounded-xl bg-surface-2 p-1 border border-border"
              >
                {TABS.map(([key, icon]) => {
                  const active = tab === key;
                  return (
                    <button
                      key={key}
                      role="tab"
                      data-testid={`tab-${key}`}
                      aria-selected={active}
                      onClick={() => setTab(key)}
                      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] transition duration-base ${
                        active
                          ? "bg-surface text-text font-semibold shadow-soft-sm"
                          : "text-text-muted hover:text-text font-medium"
                      }`}
                    >
                      <Icon name={icon} size={12} strokeWidth={2} />
                      {t(`tabs.${key}`)}
                    </button>
                  );
                })}
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
        title={t("uninstallTitle", { name: skill?.name ?? "" })}
        message={t("uninstallMessage")}
        confirmLabel={t("uninstallConfirm")}
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}

function Breadcrumb({ name }: { name?: string }) {
  const t = useTranslations("skills.detail");
  return (
    <div className="flex items-center gap-1.5 font-mono text-caption uppercase tracking-wider text-text-subtle">
      <Link
        href="/skills"
        className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-text-muted hover:text-primary hover:bg-primary-muted transition duration-base"
      >
        <Icon name="arrow-left" size={11} strokeWidth={2} />
        {t("breadcrumbRoot")}
      </Link>
      <Icon name="chevron-right" size={11} className="text-text-subtle" />
      <span className="text-text truncate max-w-[30ch]">{name ?? "…"}</span>
    </div>
  );
}

function SourceChip({ source }: { source: SkillSource }) {
  const map: Record<SkillSource, { icon: IconName; cls: string }> = {
    builtin: {
      icon: "shield-check",
      cls: "bg-primary-muted text-primary border-primary/20",
    },
    market: { icon: "store", cls: "bg-surface-2 text-text-muted border-border" },
    github: { icon: "code", cls: "bg-surface-2 text-text-muted border-border" },
    local: { icon: "upload", cls: "bg-surface-2 text-text-muted border-border" },
  };
  const m = map[source] ?? map.local;
  return (
    <span
      data-testid="skill-source"
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-caption font-mono font-medium shrink-0 ${m.cls}`}
    >
      <Icon name={m.icon} size={10} strokeWidth={2.25} />
      {source}
    </span>
  );
}

function Hero({
  skill,
  dependentCount,
  onDelete,
}: {
  skill: Skill;
  dependentCount: number;
  onDelete: () => void;
}) {
  const t = useTranslations("skills.detail.hero");
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, var(--color-primary) 50%, transparent 100%)",
          opacity: 0.25,
        }}
      />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4 min-w-0 flex-1">
          <div
            className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft shrink-0"
            style={{
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
            }}
            aria-hidden="true"
          >
            <Icon name="wand-2" size={26} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h1
                data-testid="skill-name"
                className="text-xl font-bold tracking-tight text-text truncate"
              >
                {skill.name}
              </h1>
              <span
                data-testid="skill-version"
                className="inline-flex items-center h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono shrink-0"
              >
                v{skill.version}
              </span>
              <SourceChip source={skill.source} />
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                <Icon name="users" size={10} strokeWidth={2.25} />
                {t("inUse", { count: dependentCount })}
              </span>
            </div>
            <p className="text-[13px] text-text-muted leading-relaxed mb-2">
              {skill.description || t("noDescription")}
            </p>
            <p className="font-mono text-caption text-text-subtle truncate">
              {skill.id}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {skill.source_url && (
            <a
              href={skill.source_url}
              target="_blank"
              rel="noreferrer"
              data-testid="skill-source-link"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text-muted hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
            >
              <Icon name="external-link" size={12} />
              {t("sourceLink")}
            </a>
          )}
          {skill.source !== "builtin" && (
            <button
              onClick={onDelete}
              data-testid="skill-delete"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-danger/30 bg-danger-soft text-[12px] font-semibold text-danger hover:bg-danger/15 transition duration-base"
            >
              <Icon name="trash-2" size={12} />
              {t("uninstall")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm p-5">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-border-strong), transparent)",
          opacity: 0.6,
        }}
      />
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-muted text-primary">
            <Icon name={icon} size={14} strokeWidth={2} />
          </span>
          <h2 className="text-sm font-semibold text-text">{title}</h2>
        </div>
        {action}
      </header>
      <div className="border-t border-border -mx-5 mb-4" />
      {children}
    </section>
  );
}

function MetaGrid({
  items,
}: {
  items: ReadonlyArray<{ k: string; v: React.ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
      {items.map((it, idx) => (
        <div key={idx} className="flex flex-col gap-1 min-w-0">
          <dt className="font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold">
            {it.k}
          </dt>
          <dd
            className={`text-sm text-text break-all ${
              it.mono ? "font-mono" : ""
            }`}
          >
            {it.v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({
  skill,
  dependents,
}: {
  skill: Skill;
  dependents: Employee[];
}) {
  const t = useTranslations("skills.detail.overview");
  return (
    <div data-testid="tab-panel-overview" className="space-y-5">
      <SkillExplainer skillId={skill.id} />
      <Section title={t("metadata")} icon="info">
        <MetaGrid
          items={[
            { k: t("version"), v: `v${skill.version}`, mono: true },
            { k: t("source"), v: skill.source, mono: true },
            {
              k: t("installedAt"),
              v: skill.installed_at ? formatTime(skill.installed_at) : "—",
              mono: true,
            },
            { k: t("tools"), v: String(skill.tool_ids.length), mono: true },
            {
              k: t("localPath"),
              v: skill.path ?? "—",
              mono: true,
            },
          ]}
        />
      </Section>

      <Section title={t("depTools", { count: skill.tool_ids.length })} icon="zap">
        {skill.tool_ids.length === 0 ? (
          <p className="text-sm text-text-muted leading-relaxed">
            {t("depToolsEmpty")}
          </p>
        ) : (
          <ul
            data-testid="tool-id-list"
            className="flex flex-col gap-1.5"
          >
            {skill.tool_ids.map((tid) => (
              <li
                key={tid}
                data-testid={`tool-id-${tid}`}
                className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-surface-2 border border-border font-mono text-[12px] text-text"
              >
                <Icon
                  name="zap"
                  size={11}
                  className="text-primary shrink-0"
                />
                <span className="truncate">{tid}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <SkillReferencesSection skillId={skill.id} />

      <Section
        title={t("dependents", { count: dependents.length })}
        icon="users"
      >
        {dependents.length === 0 ? (
          <p
            data-testid="dependents-empty"
            className="text-sm text-text-muted leading-relaxed"
          >
            {t("dependentsEmpty")}
          </p>
        ) : (
          <div
            data-testid="dependents-list"
            className="grid grid-cols-1 md:grid-cols-2 gap-2"
          >
            {dependents.map((e) => (
              <Link
                key={e.id}
                href={`/employees/${encodeURIComponent(e.id)}`}
                data-testid={`dependent-${e.id}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 hover:border-border-strong hover:shadow-soft-sm transition duration-base min-w-0"
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-muted text-primary shrink-0">
                  <Icon name="user" size={13} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-text truncate">
                      {e.name}
                    </span>
                    {e.is_lead_agent && (
                      <span className="inline-flex items-center h-4 px-1.5 rounded-sm bg-primary-muted text-primary text-caption font-mono font-semibold uppercase tracking-wider shrink-0">
                        {t("leadBadge")}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-caption text-text-subtle truncate">
                    {e.id}
                  </p>
                </div>
                <Icon
                  name="arrow-right"
                  size={13}
                  className="text-text-subtle shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition duration-base"
                />
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

type SkillFileEntry = { relative_path: string; size_bytes: number };

/**
 * SkillReferencesSection · 2026-04-26 · 显示这个 skill 的 references /
 * templates 子文件 · 拉自 GET /api/skills/{id}/files。
 *
 * 没文件时整个 section 不渲染(避免给用户「这是错」的感觉)。
 */
function SkillReferencesSection({ skillId }: { skillId: string }) {
  const t = useTranslations("skills.detail.references");
  const [files, setFiles] = useState<SkillFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/files`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { files: SkillFileEntry[] };
        if (!cancelled) setFiles(body.files);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  if (error) return null;
  if (!files || files.length === 0) return null;

  return (
    <Section title={t("section", { count: files.length })} icon="book-open">
      <ul className="flex flex-col gap-1.5">
        {files.map((f) => (
          <li
            key={f.relative_path}
            className="inline-flex items-center justify-between gap-3 h-9 px-3 rounded-lg bg-surface-2 border border-border"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="file" size={11} className="text-text-muted shrink-0" />
              <span className="font-mono text-[12px] text-text truncate">
                {f.relative_path}
              </span>
            </div>
            <span className="font-mono text-[10px] text-text-subtle shrink-0">
              {formatBytes(f.size_bytes)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">
        {t("hint")}
      </p>
    </Section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function PromptTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills.detail.prompt");
  return (
    <div data-testid="tab-panel-prompt" className="space-y-5">
      <Section title={t("section")} icon="file-code-2">
        {skill.prompt_fragment ? (
          <pre
            data-testid="prompt-fragment"
            className="text-[12px] font-mono text-text bg-surface-2 border border-border rounded-lg p-4 whitespace-pre-wrap break-words leading-relaxed"
          >
            {skill.prompt_fragment}
          </pre>
        ) : (
          <p
            data-testid="prompt-empty"
            className="text-sm text-text-muted leading-relaxed"
          >
            {t("empty")}
          </p>
        )}
      </Section>

      <Section title={t("sample")} icon="sparkles">
        <p className="text-sm text-text-muted leading-relaxed mb-3">
          {t("sampleBefore")}{" "}
          <span className="font-mono text-text bg-surface-2 px-1.5 py-0.5 rounded border border-border">
            {skill.id}
          </span>{" "}
          {t.rich("sampleAfter", {
            mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
          })}
        </p>
        {skill.tool_ids.length === 0 ? (
          <p className="text-sm text-text-subtle italic">{t("noToolDeps")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {skill.tool_ids.map((tid) => (
              <li
                key={tid}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-surface-2 border border-border font-mono text-caption text-text-muted"
              >
                <Icon name="zap" size={10} className="text-primary" />
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
  const t = useTranslations("skills.detail.versions");
  return (
    <div data-testid="tab-panel-versions" className="space-y-5">
      <Section title={t("section")} icon="clock">
        <MetaGrid
          items={[
            { k: t("version"), v: `v${skill.version}`, mono: true },
            {
              k: t("installedAt"),
              v: skill.installed_at ? formatTime(skill.installed_at) : "—",
              mono: true,
            },
            {
              k: t("sourceUrl"),
              v: skill.source_url ?? "—",
              mono: true,
            },
          ]}
        />
      </Section>
      <div data-testid="version-history-empty">
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    </div>
  );
}

function DependenciesTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills.detail.dependencies");
  return (
    <div data-testid="tab-panel-dependencies" className="space-y-5">
      <Section
        title={t("section", { count: skill.tool_ids.length })}
        icon="share-2"
      >
        <p className="text-sm text-text-muted leading-relaxed mb-4">
          {t("intro")}
        </p>
        {skill.tool_ids.length === 0 ? (
          <p data-testid="dep-empty" className="text-sm text-text-muted">
            {t("empty")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className="text-left py-2 px-3 font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold w-12">
                    {t("thIndex")}
                  </th>
                  <th className="text-left py-2 px-3 font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold">
                    {t("thToolId")}
                  </th>
                  <th className="text-left py-2 px-3 font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold w-24">
                    {t("thKind")}
                  </th>
                </tr>
              </thead>
              <tbody data-testid="dep-table-body">
                {skill.tool_ids.map((tid, idx) => {
                  const kind = tid.startsWith("allhands.mcp.")
                    ? "mcp"
                    : tid.startsWith("allhands.builtin.")
                      ? "builtin"
                      : "unknown";
                  const kindChip =
                    kind === "mcp"
                      ? "text-primary bg-primary-muted border-primary/20"
                      : kind === "builtin"
                        ? "text-text-muted bg-surface-2 border-border"
                        : "text-warning bg-warning-soft border-warning/30";
                  return (
                    <tr
                      key={tid}
                      data-testid={`dep-row-${tid}`}
                      className="border-t border-border"
                    >
                      <td className="py-2 px-3 font-mono text-caption text-text-subtle tabular-nums">
                        {String(idx + 1).padStart(2, "0")}
                      </td>
                      <td className="py-2 px-3">
                        <Link
                          href={`/gateway?tool=${encodeURIComponent(tid)}`}
                          className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text hover:text-primary transition duration-base"
                        >
                          <Icon name="zap" size={11} className="text-primary" />
                          {tid}
                        </Link>
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex items-center h-5 px-1.5 rounded-md border font-mono text-caption font-medium ${kindChip}`}
                        >
                          {kind}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
