"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, LoadingState } from "@/components/state";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";

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

type Tab = "installed" | "market" | "github" | "upload";

export default function SkillsPage() {
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

  return (
    <AppShell title="技能">
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-5">
          <PageHeader
            title="技能"
            count={skills.length || undefined}
            subtitle={
              <>
                技能包 = 工具 ID 列表 + 提示片段。从 GitHub、官方市场(<span className="font-mono">anthropics/skills</span>)或本地 .zip 安装,并分配给任意员工。
              </>
            }
          />

          <div
            role="tablist"
            className="flex items-center gap-1 border-b border-border"
          >
            {(
              [
                ["installed", "已安装"],
                ["market", "官方市场"],
                ["github", "GitHub 安装"],
                ["upload", "上传 .zip"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                data-testid={`tab-${key}`}
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                  tab === key
                    ? "text-text border-primary"
                    : "text-text-muted border-transparent hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loadStatus === "loading" && (
            <div data-testid="skills-loading">
              <LoadingState title="加载技能" />
            </div>
          )}

          {loadStatus === "error" && (
            <div
              data-testid="skills-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载技能失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{loadError}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {loadStatus === "ready" && tab === "installed" && (
            <InstalledList
              skills={skills}
              onDelete={(s) => setDeleteTarget(s)}
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
        title={`卸载技能 ${deleteTarget?.name ?? ""}?`}
        message={"此操作会同时删除本地目录,不可撤销。已分配该技能的员工将失去对应提示片段。"}
        confirmLabel="卸载"
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

function InstalledList({
  skills,
  onDelete,
}: {
  skills: Skill[];
  onDelete: (s: Skill) => void;
}) {
  if (skills.length === 0) {
    return (
      <div data-testid="skills-empty">
        <EmptyState
          title="尚未安装任何技能"
          description={"切换到“官方市场”开始,或直接从 GitHub 克隆"}
        />
      </div>
    );
  }
  return (
    <div data-testid="skills-list" className="flex flex-col gap-2">
      {skills.map((s) => (
        <div
          key={s.id}
          data-testid={`skill-${s.name}`}
          className="rounded-xl border border-border bg-surface p-4 hover:border-border-strong transition-colors duration-base"
        >
          <div className="flex items-start justify-between gap-3">
            <Link
              href={`/skills/${encodeURIComponent(s.id)}`}
              data-testid={`skill-link-${s.name}`}
              className="flex-1 min-w-0"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-text">{s.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted">
                  {s.source}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
                  v{s.version}
                </span>
              </div>
              <p className="text-xs text-text-muted mb-2">{s.description}</p>
              {s.source_url && (
                <p className="text-xs font-mono text-text-subtle truncate">
                  {s.source_url}
                </p>
              )}
            </Link>
            {s.source !== "builtin" && (
              <button
                onClick={() => onDelete(s)}
                data-testid={`delete-${s.name}`}
                className="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors shrink-0"
              >
                卸载
              </button>
            )}
          </div>
        </div>
      ))}
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
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索名称、描述或标签…"
          data-testid="market-search"
          aria-label="搜索官方市场"
          className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors"
        />
        {loading && (
          <span className="text-xs text-text-subtle" data-testid="market-loading">
            搜索中…
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div data-testid="market-empty">
          <EmptyState
            title={query ? `未找到匹配 "${query}" 的技能` : "市场目录为空"}
            description={query ? "换个关键词试试" : undefined}
          />
        </div>
      ) : (
        <div data-testid="market-list" className="flex flex-col gap-2">
          {entries.map((e) => {
            const installed = installedSlugs.has(e.name);
            const busy = busySlug === e.slug;
            return (
              <div
                key={e.slug}
                data-testid={`market-${e.slug}`}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-medium text-text">{e.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
                        v{e.version}
                      </span>
                      {e.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-text-muted mb-2">{e.description}</p>
                    <p className="text-xs font-mono text-text-subtle truncate">
                      {e.source_url}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      onClick={() => onPreview(e.slug)}
                      data-testid={`preview-${e.slug}`}
                      className="text-xs px-3 py-1.5 rounded-md border border-border text-text hover:bg-surface-2 transition-colors"
                    >
                      查看
                    </button>
                    <button
                      onClick={() => onInstall(e.slug)}
                      disabled={installed || busy}
                      data-testid={`install-${e.slug}`}
                      className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition-colors"
                    >
                      {installed ? "已安装" : busy ? "安装中…" : "安装"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
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
  const [preview, setPreview] = useState<MarketPreview | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const abortRef = useRef<AbortController | null>(null);

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
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-border">
          <div className="min-w-0">
            <h3
              id="preview-title"
              className="text-sm font-semibold text-text truncate"
            >
              {preview?.name ?? slug}
              {preview && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
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
          <button
            onClick={onClose}
            data-testid="preview-close"
            aria-label="关闭"
            className="text-xs text-text-muted hover:text-text transition-colors shrink-0"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {status === "loading" && (
            <p className="text-xs text-text-muted" data-testid="preview-loading">
              读取 SKILL.md…
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
                <h4 className="text-[11px] uppercase tracking-wide text-text-subtle mb-1.5">
                  文件({preview.files.length})
                </h4>
                <div className="flex flex-wrap gap-1">
                  {preview.files.map((f) => (
                    <span
                      key={f}
                      className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-2 text-text-muted"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <h4 className="text-[11px] uppercase tracking-wide text-text-subtle mb-1.5">
                SKILL.md
              </h4>
              <pre
                data-testid="preview-skill-md"
                className="text-[11px] font-mono text-text bg-bg border border-border rounded-md p-3 whitespace-pre-wrap break-words"
              >
                {preview.skill_md}
              </pre>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
          >
            关闭
          </button>
          <button
            onClick={onInstall}
            disabled={
              alreadyInstalled || installing || status !== "idle" || preview === null
            }
            data-testid="preview-install"
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
          >
            {alreadyInstalled ? "已安装" : installing ? "安装中…" : "安装"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GithubInstallForm({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("main");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!url) return;
    setBusy(true);
    setErr("");
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
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-text mb-4">从 GitHub 克隆</h3>
      <div className="flex flex-col gap-3">
        <Field
          label="仓库 URL"
          mono
          placeholder="https://github.com/anthropic/skill-xxx"
          value={url}
          onChange={setUrl}
        />
        <Field
          label="分支 / tag / commit"
          mono
          placeholder="main"
          value={ref}
          onChange={setRef}
        />
        {err && (
          <p className="text-xs text-danger font-mono" data-testid="github-error">
            {err}
          </p>
        )}
        <div className="pt-1">
          <button
            onClick={() => void submit()}
            disabled={busy || !url}
            data-testid="install-github-submit"
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
          >
            {busy ? "克隆中…" : "克隆并安装"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadForm({ onInstalled }: { onInstalled: () => Promise<void> }) {
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
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-text mb-4">上传 .zip 安装</h3>
      <p className="text-xs text-text-muted mb-3">
        .zip 解压后的根目录(或任一子目录)须存在 <span className="font-mono">SKILL.md</span>,前言至少包含 <span className="font-mono">name</span> 与 <span className="font-mono">version</span>。
      </p>
      <div className="flex flex-col gap-3">
        <input
          type="file"
          accept=".zip,application/zip"
          data-testid="upload-input"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs text-text-muted file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-1.5 file:text-xs file:text-text file:mr-3 file:cursor-pointer"
        />
        {err && (
          <p className="text-xs text-danger font-mono" data-testid="upload-error">
            {err}
          </p>
        )}
        <div>
          <button
            onClick={() => void submit()}
            disabled={busy || !file}
            data-testid="upload-submit"
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
          >
            {busy ? "上传中…" : "上传并安装"}
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
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text placeholder-text-subtle focus:outline-none focus:border-primary transition-colors ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
