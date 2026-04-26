"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { AgentMarkdown } from "@/components/chat/AgentMarkdown";

/**
 * Skills page · ADR 0016 V2 Azure Live polish.
 *
 * Hero eyebrow + h1 · KPI strip (gradient hero + stat cards) · pill-style
 * filter group · richer skill cards (icon tile · source badge · meta row ·
 * sliding hover arrow) · mesh-hero empty state · shimmer skeleton.
 *
 * Data / state / fetch / navigation / testids are preserved verbatim.
 */

type Skill = {
  id: string;
  name: string;
  description: string;
  tool_ids: string[];
  prompt_fragment: string | null;
  version: string;
  source: string;
  source_url: string | null;
  installed_at: string | null;
  path: string | null;
};

type MarketEntry = {
  slug: string;
  name: string;
  description: string;
  source_url: string;
  version: string;
  tags: string[];
};

type MarketPreview = {
  slug: string;
  name: string;
  description: string;
  version: string;
  source_url: string;
  skill_md: string;
  files: string[];
};

type Tab = "builtin" | "installed" | "market" | "github" | "upload";

// 2026-04-26 · 平台内建 / 我安装的 拆成两个 tab(原本混在 「已安装」 一锅)
// 默认进 「我安装的」 — 用户最关心自己装的那 N 个 · builtin 是只读参考
const TAB_KEYS: ReadonlyArray<Tab> = ["installed", "builtin", "market", "github", "upload"];

export default function SkillsPage() {
  const t = useTranslations("skills.list");
  const [tab, setTab] = useState<Tab>("installed");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [market, setMarket] = useState<MarketEntry[]>([]);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busySlug, setBusySlug] = useState<string>("");
  const [previewTarget, setPreviewTarget] = useState<string>("");

  const loadInstalled = useCallback(async () => {
    const res = await fetch("/api/skills");
    if (!res.ok) throw new Error(`skills HTTP ${res.status}`);
    setSkills((await res.json()) as Skill[]);
  }, []);

  const loadMarket = useCallback(async (q: string) => {
    setMarketLoading(true);
    try {
      const url = q ? `/api/skills/market?q=${encodeURIComponent(q)}` : "/api/skills/market";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`market HTTP ${res.status}`);
      setMarket((await res.json()) as MarketEntry[]);
    } finally {
      setMarketLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoadStatus("loading");
    try {
      await Promise.all([loadInstalled(), loadMarket("")]);
      setLoadStatus("ready");
    } catch (err) {
      setLoadError(String(err));
      setLoadStatus("error");
    }
  }, [loadInstalled, loadMarket]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounce search input (300ms) to avoid hammering the GitHub-backed market
  // while the user is still typing — matches the 10-min server cache cadence.
  useEffect(() => {
    if (loadStatus !== "ready") return;
    const handle = window.setTimeout(() => {
      void loadMarket(marketQuery.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [marketQuery, loadStatus, loadMarket]);

  async function handleInstallMarket(slug: string) {
    setBusySlug(slug);
    try {
      const res = await fetch("/api/skills/install/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setPreviewTarget("");
      setTab("installed");
      await load();
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setBusySlug("");
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/skills/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const installedSlugs = new Set(skills.map((s) => s.name));
  const installedCount = skills.filter((s) => s.source !== "builtin").length;
  const builtinCount = skills.filter((s) => s.source === "builtin").length;
  const latestSkill = skills.reduce<Skill | null>((acc, s) => {
    if (!s.installed_at) return acc;
    if (!acc || !acc.installed_at) return s;
    return s.installed_at > acc.installed_at ? s : acc;
  }, null);
  const latestLabel = latestSkill?.installed_at
    ? formatRelativeDate(latestSkill.installed_at)
    : "—";
  const latestHint = latestSkill?.name ?? t("kpi.latestEmpty");

  return (
    <AppShell title={t("appShellTitle")}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          {/* Eyebrow + hero header */}
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary-muted text-primary text-caption font-mono font-semibold uppercase tracking-wider">
                  <Icon name="wand-2" size={10} strokeWidth={2.25} />
                  {t("eyebrow")}
                </span>
                <span className="font-mono text-caption text-text-subtle uppercase tracking-wider">
                  {t("eyebrowHint")}
                </span>
              </div>
              <PageHeader
                title={t("pageTitle")}
                count={skills.length || undefined}
                subtitle={t.rich("subtitle", {
                  mono: (chunks) => <span className="font-mono">{chunks}</span>,
                })}
              />
            </div>
          </div>

          {/* KPI strip */}
          <div
            data-testid="skills-kpi"
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <HeroKpi
              label={t("kpi.total")}
              value={skills.length}
              icon="wand-2"
              hint={t("kpi.totalHint", { managed: installedCount, builtin: builtinCount })}
            />
            <StatKpi
              label={t("kpi.installed")}
              value={installedCount}
              icon="download"
              hint={t("kpi.installedHint")}
            />
            <StatKpi
              label={t("kpi.builtin")}
              value={builtinCount}
              icon="shield-check"
              hint={t("kpi.builtinHint")}
            />
            <StatKpi
              label={t("kpi.latest")}
              value={latestLabel}
              icon="clock"
              hint={latestHint}
              monoValue
            />
          </div>

          {/* Filter pills */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div
              role="tablist"
              aria-label={t("tabsLabel")}
              className="inline-flex items-center gap-1 rounded-xl bg-surface-2 p-1 border border-border"
            >
              {TAB_KEYS.map((key) => {
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
                    <Icon name={tabIcon(key)} size={12} strokeWidth={2} />
                    {t(`tabs.${key}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {loadStatus === "loading" && (
            <div data-testid="skills-loading">
              <SkillsSkeleton />
            </div>
          )}

          {loadStatus === "error" && (
            <div
              data-testid="skills-error"
              className="rounded-xl border border-danger/30 bg-danger-soft p-5"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger shrink-0">
                  <Icon name="alert-circle" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-danger mb-1">
                    {t("loadErrorTitle")}
                  </p>
                  <p className="text-xs text-text-muted font-mono break-all mb-3">
                    {loadError}
                  </p>
                  <button
                    onClick={() => void load()}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
                  >
                    <Icon name="refresh" size={12} />
                    {t("retry")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loadStatus === "ready" && tab === "installed" && (
            <InstalledList
              skills={skills.filter((s) => s.source !== "builtin")}
              onDelete={(s) => setDeleteTarget(s)}
              onBrowse={() => setTab("market")}
            />
          )}

          {loadStatus === "ready" && tab === "builtin" && (
            <InstalledList
              skills={skills.filter((s) => s.source === "builtin")}
              onDelete={(s) => setDeleteTarget(s)}
              onBrowse={() => setTab("market")}
            />
          )}

          {loadStatus === "ready" && tab === "market" && (
            <MarketList
              entries={market}
              query={marketQuery}
              onQueryChange={setMarketQuery}
              loading={marketLoading}
              installedSlugs={installedSlugs}
              busySlug={busySlug}
              onInstall={(slug) => void handleInstallMarket(slug)}
              onPreview={(slug) => setPreviewTarget(slug)}
            />
          )}

          {loadStatus === "ready" && tab === "github" && (
            <GithubInstallForm
              onInstalled={async () => {
                setTab("installed");
                await load();
              }}
            />
          )}

          {loadStatus === "ready" && tab === "upload" && (
            <UploadForm
              onInstalled={async () => {
                setTab("installed");
                await load();
              }}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("uninstallTitle", { name: deleteTarget?.name ?? "" })}
        message={t("uninstallMessage")}
        confirmLabel={t("uninstallConfirm")}
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteTarget(null)}
      />

      <PreviewModal
        slug={previewTarget}
        installing={previewTarget !== "" && busySlug === previewTarget}
        alreadyInstalled={installedSlugs.has(previewTarget)}
        onClose={() => setPreviewTarget("")}
        onInstall={() => void handleInstallMarket(previewTarget)}
      />
    </AppShell>
  );
}

function tabIcon(t: Tab): "layout-grid" | "shield-check" | "store" | "code" | "upload" {
  if (t === "installed") return "layout-grid";
  if (t === "builtin") return "shield-check";
  if (t === "market") return "store";
  if (t === "github") return "code";
  return "upload";
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${mo}/${day}`;
}

function HeroKpi({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: number | string;
  icon: "wand-2";
  hint?: string;
}) {
  return (
    <div
      data-testid={`kpi-${label.toLowerCase()}`}
      className="group relative overflow-hidden rounded-xl p-4 text-primary-fg shadow-soft transition duration-base hover:-translate-y-px hover:shadow-soft-lg"
      style={{
        background:
          "linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl"
        style={{ background: "var(--color-primary-glow)", opacity: 0.4 }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-12 bottom-0 h-24 w-24 rounded-full blur-2xl"
        style={{ background: "var(--color-accent, var(--color-primary))", opacity: 0.28 }}
      />
      <div className="relative flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider opacity-90">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="relative mt-3 text-xl font-bold tabular-nums leading-none">
        {value}
      </div>
      {hint && (
        <div className="relative mt-2 font-mono text-caption opacity-85 truncate">
          {hint}
        </div>
      )}
    </div>
  );
}

function StatKpi({
  label,
  value,
  icon,
  hint,
  monoValue = false,
}: {
  label: string;
  value: number | string;
  icon: "download" | "shield-check" | "clock";
  hint?: string;
  monoValue?: boolean;
}) {
  return (
    <div
      data-testid={`kpi-${label.toLowerCase()}`}
      className="group relative flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:-translate-y-px hover:shadow-soft hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-caption font-semibold uppercase tracking-wider text-text-subtle truncate">
          {label}
        </span>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
      </div>
      <div
        className={`text-xl font-bold tabular-nums leading-none text-text ${
          monoValue ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
      {hint && (
        <div className="font-mono text-caption text-text-subtle truncate">{hint}</div>
      )}
    </div>
  );
}

type InstalledSort = "recent" | "name" | "tools";

function InstalledList({
  skills,
  onDelete,
  onBrowse,
}: {
  skills: Skill[];
  onDelete: (s: Skill) => void;
  onBrowse: () => void;
}) {
  const t = useTranslations("skills.list");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<InstalledSort>("recent");
  // 2026-04-26 · 列表数量超 ~12 时,无搜索 + 无排序 = 用户找不到刚装
  // 的 skill。补本地搜索 + 三档排序。这里的过滤计算量极低(skill 数
  // ~ 数百级),不需要 debounce / virtualization。
  const lcQuery = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = skills;
    if (lcQuery) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(lcQuery) ||
          s.description.toLowerCase().includes(lcQuery) ||
          s.id.toLowerCase().includes(lcQuery),
      );
    }
    const cloned = [...list];
    if (sort === "name") {
      cloned.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "tools") {
      cloned.sort(
        (a, b) =>
          b.tool_ids.length - a.tool_ids.length ||
          a.name.localeCompare(b.name),
      );
    } else {
      // recent: 安装时间倒序;builtin 没有 installed_at,排到最后但保持
      // 字母序,避免随机抖动
      cloned.sort((a, b) => {
        const aT = a.installed_at ? Date.parse(a.installed_at) : -Infinity;
        const bT = b.installed_at ? Date.parse(b.installed_at) : -Infinity;
        if (aT !== bT) return bT - aT;
        return a.name.localeCompare(b.name);
      });
    }
    return cloned;
  }, [skills, lcQuery, sort]);

  if (skills.length === 0) {
    return <EmptySkills onBrowse={onBrowse} />;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px]">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t("searchPlaceholder")}
            count={filtered.length}
            total={skills.length}
            autoFocusOnSlash
            testId="skills-search"
          />
        </div>
        <SortPills value={sort} onChange={setSort} />
      </div>
      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-6 text-center text-[12.5px] text-text-muted">
          {t("noMatch", { query })}
        </p>
      ) : (
        <div
          data-testid="skills-list"
          className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
        >
          {filtered.map((s) => (
            <SkillCard
              key={s.id}
              skill={s}
              onDelete={onDelete}
              highlight={lcQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SortPills({
  value,
  onChange,
}: {
  value: InstalledSort;
  onChange: (v: InstalledSort) => void;
}) {
  const t = useTranslations("skills.list");
  const items: { id: InstalledSort; label: string; icon: IconName }[] = [
    { id: "recent", label: t("sortRecent"), icon: "clock" },
    { id: "name", label: t("sortName"), icon: "list" },
    { id: "tools", label: t("sortTools"), icon: "wand-2" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("sortAriaLabel")}
      className="inline-flex h-9 rounded-md border border-border bg-surface p-0.5"
    >
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(item.id)}
            data-testid={`skills-sort-${item.id}`}
            className={
              "inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[11.5px] font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 " +
              (active
                ? "bg-primary text-primary-fg shadow-soft-sm"
                : "text-text-muted hover:text-text hover:bg-surface-2")
            }
          >
            <Icon name={item.icon} size={11} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function SkillCard({
  skill,
  onDelete,
  highlight,
}: {
  skill: Skill;
  onDelete: (s: Skill) => void;
  /** Lower-cased query — when present, name/description matches get
   *  visually highlighted (R11 search-highlight feature folded in
   *  early because the SortPills is right next to it). */
  highlight?: string;
}) {
  const t = useTranslations("skills.list");
  const isBuiltin = skill.source === "builtin";
  const installedLabel = skill.installed_at
    ? formatRelativeDate(skill.installed_at)
    : isBuiltin
      ? t("builtinLabel")
      : "—";

  return (
    <div
      data-testid={`skill-${skill.name}`}
      className="group relative flex flex-col gap-3 rounded-xl bg-surface border border-border shadow-soft-sm p-4 hover:shadow-soft hover:-translate-y-px hover:border-border-strong transition duration-base min-w-0"
    >
      <Link
        href={`/skills/${encodeURIComponent(skill.id)}`}
        data-testid={`skill-link-${skill.name}`}
        className="flex items-start gap-3 min-w-0"
      >
        <div
          className="grid h-10 w-10 place-items-center rounded-xl text-primary-fg shadow-soft-sm shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="wand-2" size={18} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[14px] font-semibold text-text truncate tracking-tight">
              <Highlight text={skill.name} term={highlight} />
            </span>
            <SourceBadge source={skill.source} />
          </div>
          {skill.source_url && (
            <p className="font-mono text-[11px] text-text-subtle truncate mt-0.5">
              {skill.source_url}
            </p>
          )}
        </div>
        <Icon
          name="arrow-right"
          size={14}
          className="mt-1 shrink-0 text-text-subtle opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition duration-base"
        />
      </Link>

      {skill.description ? (
        <p className="text-[12px] text-text-muted leading-snug line-clamp-2 min-h-[32px]">
          <Highlight text={skill.description} term={highlight} />
        </p>
      ) : (
        <p className="text-[12px] text-text-subtle italic leading-snug min-h-[32px]">
          {t("noDescription")}
        </p>
      )}

      <div className="flex items-center gap-4 pt-3 mt-auto border-t border-border">
        <Stat icon="zap" label="tools" value={skill.tool_ids.length} />
        <span className="inline-flex items-center gap-1 text-text-muted">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-text">
            v{skill.version}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-text-muted">
          <Icon name="clock" size={12} className="text-text-subtle" />
          <span className="font-mono text-[11px] text-text-muted">
            {installedLabel}
          </span>
        </span>
        {!isBuiltin && (
          <button
            onClick={() => onDelete(skill)}
            data-testid={`delete-${skill.name}`}
            aria-label={t("uninstallAria", { name: skill.name })}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:text-danger hover:bg-danger-soft transition duration-base"
          >
            <Icon name="trash-2" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Highlight · 把 term 在 text 中匹配到的子串包成 <mark>。
 * 安全:仅按 lowercase indexOf 切片,无正则注入风险。空 term/text 不
 * 渲染 <mark>,直接返回原文。Linear / Algolia 通用做法。
 */
function Highlight({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  const lcText = text.toLowerCase();
  const lcTerm = term.toLowerCase();
  if (lcTerm.length === 0 || !lcText.includes(lcTerm)) return <>{text}</>;
  const parts: { value: string; match: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lcText.indexOf(lcTerm, i);
    if (idx === -1) {
      parts.push({ value: text.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ value: text.slice(i, idx), match: false });
    parts.push({ value: text.slice(idx, idx + lcTerm.length), match: true });
    i = idx + lcTerm.length;
  }
  return (
    <>
      {parts.map((p, k) =>
        p.match ? (
          <mark
            key={k}
            className="rounded-sm bg-warning-soft text-text px-0.5 -mx-0.5 font-medium"
          >
            {p.value}
          </mark>
        ) : (
          <span key={k}>{p.value}</span>
        ),
      )}
    </>
  );
}

function SourceBadge({ source }: { source: string }) {
  const isBuiltin = source === "builtin";
  const cls = isBuiltin
    ? "bg-primary-muted text-primary border-primary/20"
    : "bg-surface-2 text-text-muted border-border";
  const icon: "shield-check" | "download" = isBuiltin ? "shield-check" : "download";
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-caption font-mono font-medium shrink-0 ${cls}`}
    >
      <Icon name={icon} size={10} strokeWidth={2.25} />
      {source}
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: "zap";
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted">
      <Icon name={icon} size={12} className="text-text-subtle" />
      <span className="text-[13px] font-semibold text-text tabular-nums">{value}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {label}
      </span>
    </span>
  );
}

function SkillsSkeleton() {
  const t = useTranslations("skills.list");
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="rounded-xl bg-surface border border-border shadow-soft-sm p-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-surface-3 animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 rounded bg-surface-3 animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
              <div className="h-2.5 w-20 rounded bg-surface-2" />
            </div>
          </div>
          <div className="h-2.5 w-full rounded bg-surface-2" />
          <div className="h-2.5 w-4/5 rounded bg-surface-2" />
          <div className="pt-3 border-t border-border flex gap-3">
            <div className="h-4 w-12 rounded bg-surface-2" />
            <div className="h-4 w-14 rounded bg-surface-2" />
            <div className="ml-auto h-6 w-6 rounded bg-surface-2" />
          </div>
        </div>
      ))}
      <span className="sr-only">
        <LoadingState title={t("loadingLabel")} />
      </span>
    </div>
  );
}

function EmptySkills({ onBrowse }: { onBrowse: () => void }) {
  const t = useTranslations("skills.list.empty");
  return (
    <div
      data-testid="skills-empty"
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-sm"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px 300px at 15% 20%, var(--color-primary-muted), transparent 60%), radial-gradient(500px 400px at 85% 60%, color-mix(in srgb, var(--color-accent, var(--color-primary)) 18%, transparent), transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <div className="relative px-6 py-16 grid place-items-center text-center">
        <div
          className="grid h-20 w-20 place-items-center rounded-2xl text-primary-fg shadow-soft-lg animate-float"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="wand-2" size={36} strokeWidth={1.5} />
        </div>
        <h3 className="mt-6 text-display font-bold tracking-tight text-text">
          {t("title")}
        </h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-muted">
          {t.rich("description", {
            mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
          })}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onBrowse}
            data-testid="skills-empty-cta-market"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary text-primary-fg text-[13px] font-semibold shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
          >
            <Icon name="store" size={14} />
            {t("browseMarket")}
          </button>
          <Link
            href="/chat"
            data-testid="skills-empty-cta-chat"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-surface border border-border text-[13px] font-semibold text-text hover:border-primary hover:text-primary hover:-translate-y-px transition duration-base"
          >
            <Icon name="sparkles" size={14} />
            {t("askLeadAgent")}
          </Link>
        </div>
        <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-text-subtle flex-wrap">
          <span className="font-mono uppercase tracking-wider">{t("sources")}</span>
          <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-medium">
            <Icon name="store" size={10} />
            {t("sourceMarket")}
          </span>
          <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-medium">
            <Icon name="code" size={10} />
            {t("sourceGithub")}
          </span>
          <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-medium">
            <Icon name="upload" size={10} />
            {t("sourceUpload")}
          </span>
        </div>
      </div>
    </div>
  );
}

function MarketList({
  entries,
  query,
  onQueryChange,
  loading,
  installedSlugs,
  busySlug,
  onInstall,
  onPreview,
}: {
  entries: MarketEntry[];
  query: string;
  onQueryChange: (v: string) => void;
  loading: boolean;
  installedSlugs: Set<string>;
  busySlug: string;
  onInstall: (slug: string) => void;
  onPreview: (slug: string) => void;
}) {
  const t = useTranslations("skills.list.market");
  const [activeTag, setActiveTag] = useState<string>("");
  const [tagsExpanded, setTagsExpanded] = useState(false);
  // 2026-04-26 · R8 · 大列表 lazy render(>24 时,默认显示前 24,点
  // load-more 加 24)。原实现一次性渲染 100+ 卡片到 DOM,初次切到市场
  // tab 卡 ~600ms。state 不放 limit-字面量(因为 query / activeTag 变化
  // 后该重置 limit),用 batch 数 + 重置 effect。
  const PAGE = 24;
  const [batches, setBatches] = useState(1);

  // Collect every tag + how many skills use it. Sorted by popularity so the
  // filter row puts the most-useful pills first.
  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const allTags = Array.from(tagCounts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  // R9 · 12 个上限太死。默认收起到 12,有更多时点 + 显示完整(folded
  // 时也保证 activeTag 一定在可见列表里 — 否则用户切了某 tag,刷新后
  // 看不到选中状态)。
  const FOLDED_TAG_LIMIT = 12;
  const visibleTags = (() => {
    if (tagsExpanded) return allTags;
    const folded = allTags.slice(0, FOLDED_TAG_LIMIT);
    if (activeTag && !folded.some(([k]) => k === activeTag)) {
      const extra = allTags.find(([k]) => k === activeTag);
      if (extra) return [...folded, extra];
    }
    return folded;
  })();
  const overflowCount = Math.max(0, allTags.length - visibleTags.length);

  const filtered = activeTag
    ? entries.filter((e) => e.tags.includes(activeTag))
    : entries;

  // Reset pagination when filter changes — batches counts pages of `filtered`,
  // so a prior larger value would point past the new shorter array.
  useEffect(() => {
    setBatches(1);
  }, [query, activeTag]);

  const limit = batches * PAGE;
  const visible = filtered.slice(0, limit);
  const remaining = Math.max(0, filtered.length - limit);
  const totalInstalled = entries.filter((e) => installedSlugs.has(e.name)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Icon
            name="search"
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            data-testid="market-search"
            aria-label={t("searchAria")}
            className="w-full rounded-xl bg-surface border border-border pl-9 pr-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary shadow-soft-sm transition duration-base"
          />
        </div>
        {loading && (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-caption text-text-subtle"
            data-testid="market-loading"
          >
            <Icon name="loader" size={12} className="animate-spin-slow" />
            {t("loading")}
          </span>
        )}
      </div>

      {allTags.length > 0 && (
        <div
          data-testid="market-tag-filter"
          className="flex items-center gap-1.5 flex-wrap text-[11px]"
        >
          <span className="font-mono uppercase tracking-wider text-text-subtle mr-1">
            {t("tagsLabel")}
          </span>
          <button
            type="button"
            onClick={() => setActiveTag("")}
            aria-pressed={activeTag === ""}
            className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full border transition duration-base ${
              activeTag === ""
                ? "bg-primary text-primary-fg border-primary shadow-soft-sm"
                : "bg-surface-2 text-text-muted border-border hover:border-border-strong"
            }`}
          >
            {t("tagsAll")}
            <span className="font-mono tabular-nums opacity-80">
              {entries.length}
            </span>
          </button>
          {visibleTags.map(([tag, count]) => {
            const active = activeTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(active ? "" : tag)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full border transition duration-base ${
                  active
                    ? "bg-primary text-primary-fg border-primary shadow-soft-sm"
                    : "bg-surface-2 text-text-muted border-border hover:border-border-strong hover:text-text"
                }`}
              >
                {tag}
                <span
                  className={`font-mono tabular-nums ${
                    active ? "opacity-80" : "opacity-60"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
          {overflowCount > 0 && !tagsExpanded && (
            <button
              type="button"
              onClick={() => setTagsExpanded(true)}
              data-testid="market-tag-show-more"
              className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full border border-dashed border-border text-text-muted hover:border-primary hover:text-primary transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t("tagsShowMore", { n: overflowCount })}
            </button>
          )}
          {tagsExpanded && allTags.length > FOLDED_TAG_LIMIT && (
            <button
              type="button"
              onClick={() => setTagsExpanded(false)}
              data-testid="market-tag-show-less"
              className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full border border-dashed border-border text-text-muted hover:border-primary hover:text-primary transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {t("tagsShowLess")}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[11px] text-text-subtle">
        <span data-testid="market-summary" className="font-mono">
          {t("summary", { shown: visible.length, total: entries.length })}
          {activeTag && (
            <>
              {t("summaryWithTag")}
              <span className="text-text"> {activeTag}</span>
            </>
          )}
        </span>
        {totalInstalled > 0 && (
          <span className="font-mono">
            {t("installedSummary", { count: totalInstalled })}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div data-testid="market-empty">
          <EmptyState
            title={
              activeTag
                ? t("emptyTagged", { tag: activeTag })
                : query
                  ? t("emptyQueried", { query })
                  : t("emptyDefault")
            }
            description={activeTag || query ? t("emptyHint") : undefined}
          />
        </div>
      ) : (
        <div
          data-testid="market-list"
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          {visible.map((e) => {
            const installed = installedSlugs.has(e.name);
            const busy = busySlug === e.slug;
            return (
              <div
                key={e.slug}
                data-testid={`market-${e.slug}`}
                className="group relative flex flex-col gap-3 rounded-xl bg-surface border border-border shadow-soft-sm p-4 hover:shadow-soft hover:-translate-y-px hover:border-border-strong transition duration-base min-w-0"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className="grid h-10 w-10 place-items-center rounded-xl text-primary-fg shadow-soft-sm shrink-0"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
                    }}
                    aria-hidden="true"
                  >
                    <Icon name="store" size={18} strokeWidth={2} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[14px] font-semibold text-text truncate tracking-tight">
                        {e.name}
                      </span>
                      <span className="inline-flex items-center h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono shrink-0">
                        v{e.version}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-text-subtle truncate mt-0.5">
                      {e.source_url}
                    </p>
                  </div>
                </div>
                <p className="text-[12px] text-text-muted leading-snug line-clamp-2 min-h-[32px]">
                  {e.description}
                </p>
                {e.tags.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {e.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center h-5 px-2 rounded-full bg-surface-2 text-text-muted text-caption font-medium border border-border"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-3 mt-auto border-t border-border">
                  <button
                    onClick={() => onPreview(e.slug)}
                    data-testid={`preview-${e.slug}`}
                    className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text-muted hover:text-text hover:border-border-strong transition duration-base"
                  >
                    <Icon name="eye" size={12} />
                    {t("preview")}
                  </button>
                  <button
                    onClick={() => onInstall(e.slug)}
                    disabled={installed || busy}
                    data-testid={`install-${e.slug}`}
                    className="ml-auto inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-base"
                  >
                    {installed ? (
                      <>
                        <Icon name="check" size={12} />
                        {t("installed")}
                      </>
                    ) : busy ? (
                      <>
                        <Icon name="loader" size={12} className="animate-spin-slow" />
                        {t("installing")}
                      </>
                    ) : (
                      <>
                        <Icon name="download" size={12} />
                        {t("install")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {remaining > 0 && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            data-testid="market-load-more"
            onClick={() => setBatches((n) => n + 1)}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border border-border bg-surface text-[12.5px] font-medium text-text-muted hover:text-text hover:bg-surface-2 hover:border-border-strong transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Icon name="chevron-down" size={12} />
            {t("loadMore", { remaining, batch: Math.min(PAGE, remaining) })}
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewModal({
  slug,
  installing,
  alreadyInstalled,
  onClose,
  onInstall,
}: {
  slug: string;
  installing: boolean;
  alreadyInstalled: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const t = useTranslations("skills.list.preview");
  const [preview, setPreview] = useState<MarketPreview | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  // AI 解读 / 原文 tab. The explanation streams the moment the modal
  // opens — for a market browser the "what does this thing do" question
  // is the whole point, so we don't make the user click another button.
  const [view, setView] = useState<"ai" | "raw">("ai");
  const [aiText, setAiText] = useState("");
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [aiError, setAiError] = useState<string | null>(null);
  const aiBodyRef = useRef<HTMLDivElement>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  // Reset every time the modal target changes.
  useEffect(() => {
    if (!slug) {
      aiAbortRef.current?.abort();
      setAiText("");
      setAiState("idle");
      setAiError(null);
      setView("ai");
      return;
    }
  }, [slug]);

  // Auto-stream AI explanation when the modal opens on the AI tab. We
  // kick this off once per slug + when the user clicks "重新解读"; raw
  // SKILL.md fetch is independent and keeps the existing path.
  const startAi = useCallback(async () => {
    if (!slug) return;
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    setAiState("loading");
    setAiText("");
    setAiError(null);
    try {
      const res = await fetch(
        `/api/skills/market/${encodeURIComponent(slug)}/explain`,
        { method: "POST", signal: ctrl.signal },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`${res.status} ${body || res.statusText}`);
      }
      if (!res.body) throw new Error(t("noBody"));
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let acc = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setAiText(acc);
      }
      acc += decoder.decode();
      setAiText(acc);
      setAiState("done");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setAiError(e instanceof Error ? e.message : String(e));
      setAiState("error");
    }
  }, [slug, t]);

  useEffect(() => {
    if (slug && aiState === "idle") void startAi();
  }, [slug, aiState, startAi]);

  // Pin the AI panel to bottom while streaming so new chunks stay in
  // view — same trick as SkillExplainer / DesignForm preview.
  useEffect(() => {
    if (aiState !== "loading" || !aiBodyRef.current) return;
    aiBodyRef.current.scrollTop = aiBodyRef.current.scrollHeight;
  }, [aiText, aiState]);

  useEffect(() => {
    if (!slug) {
      setPreview(null);
      setStatus("idle");
      setErr("");
      return;
    }
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setStatus("loading");
    setPreview(null);
    setErr("");
    fetch(`/api/skills/market/${encodeURIComponent(slug)}/preview`, {
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(body.detail || `HTTP ${res.status}`);
        }
        return res.json() as Promise<MarketPreview>;
      })
      .then((p) => {
        setPreview(p);
        setStatus("idle");
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setErr(String(e));
        setStatus("error");
      });
    return () => ctrl.abort();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slug, onClose]);

  if (!slug) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      onClick={onClose}
    >
      <div
        data-testid="preview-modal"
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border bg-surface shadow-soft-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="grid h-9 w-9 place-items-center rounded-xl text-primary-fg shadow-soft-sm shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
              }}
              aria-hidden="true"
            >
              <Icon name="wand-2" size={16} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3
                id="preview-title"
                className="text-sm font-semibold text-text truncate flex items-center gap-2"
              >
                {preview?.name ?? slug}
                {preview && (
                  <span className="inline-flex items-center h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono shrink-0">
                    v{preview.version}
                  </span>
                )}
              </h3>
              {preview && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2">
                  {preview.description}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="preview-close"
            aria-label={t("close")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:text-text hover:bg-surface-2 transition duration-base shrink-0"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Tabs row — AI 解读 default, 原文 for raw SKILL.md aficionados.
            Both tabs render in the same flex-1 container so the modal
            doesn't reflow when toggling. */}
        <div
          role="tablist"
          aria-label={t("viewLabel")}
          className="flex items-center gap-1 px-5 pt-3 border-b border-border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "ai"}
            onClick={() => setView("ai")}
            data-testid="preview-view-ai"
            className={
              "inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium border-b-2 -mb-px transition-colors duration-fast " +
              (view === "ai"
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text")
            }
          >
            <Icon name="sparkles" size={12} />
            {t("ai")}
            {aiState === "loading" && (
              <Icon
                name="loader"
                size={11}
                className="animate-spin-slow text-primary/70"
              />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "raw"}
            onClick={() => setView("raw")}
            data-testid="preview-view-raw"
            className={
              "inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium border-b-2 -mb-px transition-colors duration-fast " +
              (view === "raw"
                ? "border-primary text-primary"
                : "border-transparent text-text-muted hover:text-text")
            }
          >
            <Icon name="file-code-2" size={12} />
            {t("raw")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {view === "ai" ? (
            <div ref={aiBodyRef} className="h-full">
              {status === "loading" && !aiText && (
                <p
                  className="inline-flex items-center gap-1.5 text-xs text-text-muted"
                  data-testid="preview-loading"
                >
                  <Icon name="loader" size={12} className="animate-spin-slow" />
                  {t("loadingMeta")}
                </p>
              )}
              {aiState === "error" ? (
                <div data-testid="ai-explain-error">
                  <p className="text-[12px] text-danger mb-3">{aiError}</p>
                  <button
                    type="button"
                    onClick={() => void startAi()}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-surface text-[11px] text-text-muted hover:border-primary/40 hover:text-primary transition-colors duration-fast"
                  >
                    <Icon name="refresh" size={11} />
                    {t("regenerate")}
                  </button>
                </div>
              ) : aiText ? (
                <div>
                  <AgentMarkdown
                    content={aiText}
                    className="ah-prose ah-prose-sm max-w-none"
                  />
                  {aiState === "done" && (
                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-[11px] text-text-subtle">
                        {t("aiHint")}
                      </span>
                      <button
                        type="button"
                        onClick={() => void startAi()}
                        data-testid="ai-explain-regen"
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-surface text-[11px] text-text-muted hover:border-primary/40 hover:text-primary transition-colors duration-fast"
                      >
                        <Icon name="refresh" size={11} />
                        {t("regenerate")}
                      </button>
                    </div>
                  )}
                </div>
              ) : aiState === "loading" ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  <Icon name="sparkles" size={12} className="text-primary" />
                  {t("aiWaiting")}
                </p>
              ) : null}
            </div>
          ) : (
            <>
              {status === "loading" && (
                <p
                  className="inline-flex items-center gap-1.5 text-xs text-text-muted"
                  data-testid="preview-loading"
                >
                  <Icon name="loader" size={12} className="animate-spin-slow" />
                  {t("loadingMd")}
                </p>
              )}
              {status === "error" && (
                <p className="text-xs font-mono text-danger" data-testid="preview-error">
                  {err}
                </p>
              )}
              {preview && (
                <>
                  <p className="text-[11px] font-mono text-text-subtle mb-3 break-all">
                    {preview.source_url}
                  </p>
                  <div className="mb-4">
                    <h4 className="text-[11px] uppercase tracking-wider text-text-subtle mb-1.5 font-mono font-semibold">
                      {t("filesHeading", { count: preview.files.length })}
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {preview.files.map((f) => (
                        <span
                          key={f}
                          className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-text-muted border border-border"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                  <h4 className="text-[11px] uppercase tracking-wider text-text-subtle mb-1.5 font-mono font-semibold">
                    {t("skillMdHeading")}
                  </h4>
                  <pre
                    data-testid="preview-skill-md"
                    className="text-[11px] font-mono text-text bg-surface-2 border border-border rounded-md p-3 whitespace-pre-wrap break-words"
                  >
                    {preview.skill_md}
                  </pre>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="inline-flex items-center h-9 px-4 rounded-lg border border-border bg-surface text-sm font-medium text-text-muted hover:text-text hover:border-border-strong transition duration-base"
          >
            {t("close")}
          </button>
          <button
            onClick={onInstall}
            disabled={
              alreadyInstalled || installing || status !== "idle" || preview === null
            }
            data-testid="preview-install"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-fg text-sm font-semibold shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-base"
          >
            {alreadyInstalled ? (
              <>
                <Icon name="check" size={14} />
                {t("installed")}
              </>
            ) : installing ? (
              <>
                <Icon name="loader" size={14} className="animate-spin-slow" />
                {t("installing")}
              </>
            ) : (
              <>
                <Icon name="download" size={14} />
                {t("install")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function GithubInstallForm({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const t = useTranslations("skills.list.github");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lastInstalled, setLastInstalled] = useState<string[]>([]);

  async function submit() {
    if (!url) return;
    setBusy(true);
    setErr("");
    setLastInstalled([]);
    try {
      const res = await fetch("/api/skills/install/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ref: ref || "main" }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      // Backend now returns { count, skills: [...] }. One repo can contain
      // many skills (e.g. anthropics/skills with skills/<name>/SKILL.md).
      const body = (await res.json()) as { count: number; skills: { name: string }[] };
      setLastInstalled(body.skills.map((s) => s.name));
      setUrl("");
      setRef("main");
      await onInstalled();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="code" size={16} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-text">{t("title")}</h3>
          <p className="font-mono text-caption text-text-subtle uppercase tracking-wider">
            {t("subtitle")}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Field
          label={t("repoUrl")}
          mono
          placeholder={t("repoPlaceholder")}
          value={url}
          onChange={setUrl}
        />
        <Field
          label={t("ref")}
          mono
          placeholder={t("refPlaceholder")}
          value={ref}
          onChange={setRef}
        />
        {err && (
          <div
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            data-testid="github-error"
          >
            <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
            <span className="font-mono min-w-0 break-words">{err}</span>
          </div>
        )}
        {lastInstalled.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary-muted px-3 py-2 text-[12px] text-primary"
            data-testid="github-install-ok"
          >
            <Icon name="check" size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">
              {t("okPrefix", { count: lastInstalled.length })}
              <span className="font-mono ml-1">{lastInstalled.join(" · ")}</span>
            </span>
          </div>
        )}
        <div className="pt-1">
          <p className="text-[11px] text-text-subtle mb-2 leading-relaxed">
            {t.rich("hint", {
              mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
            })}
          </p>
          <button
            onClick={() => void submit()}
            disabled={busy || !url}
            data-testid="install-github-submit"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-fg text-sm font-semibold shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-base"
          >
            {busy ? (
              <>
                <Icon name="loader" size={14} className="animate-spin-slow" />
                {t("cloning")}
              </>
            ) : (
              <>
                <Icon name="download" size={14} />
                {t("cloneInstall")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadForm({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const t = useTranslations("skills.list.upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/skills/install/upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setFile(null);
      await onInstalled();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface shadow-soft-sm p-5">
      <div className="flex items-center gap-3 mb-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary-muted text-primary">
          <Icon name="upload" size={16} />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-text">{t("title")}</h3>
          <p className="font-mono text-caption text-text-subtle uppercase tracking-wider">
            {t("subtitle")}
          </p>
        </div>
      </div>
      <p className="text-xs text-text-muted mb-3 leading-relaxed">
        {t.rich("hint", {
          mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
        })}
      </p>
      <div className="flex flex-col gap-3">
        <input
          type="file"
          accept=".zip,application/zip"
          data-testid="upload-input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs text-text-muted file:rounded-lg file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:text-text file:font-medium file:mr-3 file:cursor-pointer hover:file:border-primary hover:file:text-primary file:transition file:duration-base"
        />
        {err && (
          <div
            className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"
            data-testid="upload-error"
          >
            <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
            <span className="font-mono min-w-0 break-words">{err}</span>
          </div>
        )}
        <div>
          <button
            onClick={() => void submit()}
            disabled={busy || !file}
            data-testid="upload-submit"
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-fg text-sm font-semibold shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-base"
          >
            {busy ? (
              <>
                <Icon name="loader" size={14} className="animate-spin-slow" />
                {t("uploading")}
              </>
            ) : (
              <>
                <Icon name="upload" size={14} />
                {t("uploadInstall")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1 font-medium">{label}</label>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary shadow-soft-sm transition duration-base ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
