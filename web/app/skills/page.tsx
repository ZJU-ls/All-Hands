"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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
};

type Tab = "installed" | "market" | "github" | "upload";

export default function SkillsPage() {
  const [tab, setTab] = useState<Tab>("installed");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [market, setMarket] = useState<MarketEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busySlug, setBusySlug] = useState<string>("");

  const load = async () => {
    setLoadStatus("loading");
    try {
      const [sRes, mRes] = await Promise.all([
        fetch("/api/skills"),
        fetch("/api/skills/market"),
      ]);
      if (!sRes.ok) throw new Error(`skills HTTP ${sRes.status}`);
      if (!mRes.ok) throw new Error(`market HTTP ${mRes.status}`);
      setSkills((await sRes.json()) as Skill[]);
      setMarket((await mRes.json()) as MarketEntry[]);
      setLoadStatus("ready");
    } catch (err) {
      setLoadError(String(err));
      setLoadStatus("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
        <div className="max-w-3xl mx-auto px-8 py-8">
          <p className="mb-6 text-sm text-text-muted">
            技能包 = 工具 ID 列表 + 提示片段。可从 GitHub、官方市场或本地 .zip 安装,并分配给任意员工。
          </p>

          <div
            role="tablist"
            className="mb-6 flex items-center gap-1 border-b border-border"
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
            <div
              data-testid="skills-loading"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted">加载中…</p>
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
              installedSlugs={installedSlugs}
              busySlug={busySlug}
              onInstall={(slug) => void handleInstallMarket(slug)}
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
      <div
        data-testid="skills-empty"
        className="rounded-xl border border-dashed border-border p-10 text-center"
      >
        <p className="text-sm text-text-muted">
          尚未安装任何技能。切换到&ldquo;官方市场&rdquo;开始。
        </p>
      </div>
    );
  }
  return (
    <div data-testid="skills-list" className="flex flex-col gap-2">
      {skills.map((s) => (
        <div
          key={s.id}
          data-testid={`skill-${s.name}`}
          className="rounded-xl border border-border bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
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
            </div>
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
  installedSlugs,
  busySlug,
  onInstall,
}: {
  entries: MarketEntry[];
  installedSlugs: Set<string>;
  busySlug: string;
  onInstall: (slug: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <div
        data-testid="market-empty"
        className="rounded-xl border border-dashed border-border p-10 text-center"
      >
        <p className="text-sm text-text-muted">市场目录为空。</p>
      </div>
    );
  }
  return (
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
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-text">{e.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
                    v{e.version}
                  </span>
                </div>
                <p className="text-xs text-text-muted mb-2">{e.description}</p>
                <p className="text-xs font-mono text-text-subtle truncate">
                  {e.source_url}
                </p>
              </div>
              <button
                onClick={() => onInstall(e.slug)}
                disabled={installed || busy}
                data-testid={`install-${e.slug}`}
                className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 transition-colors shrink-0"
              >
                {installed ? "已安装" : busy ? "安装中…" : "安装"}
              </button>
            </div>
          </div>
        );
      })}
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
