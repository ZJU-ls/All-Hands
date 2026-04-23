"use client";

/**
 * MCP servers · V2 Azure Live admin console (ADR 0016).
 *
 * Users manage external MCP (Model Context Protocol) servers here — register,
 * test connectivity, inspect the tool catalogue, remove. The layout follows
 * the shared V2 pattern:
 *   1. Eyebrow + H1 + primary CTA (Add server).
 *   2. Summary strip — total / online / tools exposed / last sync (first card
 *      carries the primary gradient).
 *   3. Server grid — 2-col xl cards · plug tile · status chip · transport +
 *      URL in mono · tool-count chip · inline test/tools/delete actions · an
 *      expandable tools panel.
 *   4. Create form — sectioned · transport radio cards (stdio / http / sse)
 *      · mono inputs with focus glow.
 *   5. Empty state — mesh hero + floating plug tile + preset CTA chips.
 *
 * Data/state/fetch/mutation contracts are preserved from the previous version,
 * all `data-testid` values and user-facing Chinese labels are kept for e2e
 * compatibility.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/icon";

type Transport = "stdio" | "sse" | "http";
type Health = "unknown" | "ok" | "unreachable" | "auth_failed";

type Server = {
  id: string;
  name: string;
  transport: Transport;
  config: Record<string, unknown>;
  enabled: boolean;
  exposed_tool_ids: string[];
  last_handshake_at: string | null;
  health: Health;
};

type ToolInfo = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type Tab = "registered" | "add";

export default function McpServersPage() {
  const [tab, setTab] = useState<Tab>("registered");
  const [servers, setServers] = useState<Server[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string>("");
  const [toolsByServer, setToolsByServer] = useState<
    Record<string, ToolInfo[] | { error: string }>
  >({});
  const [expanded, setExpanded] = useState<string>("");

  const load = async () => {
    setLoadStatus("loading");
    try {
      const res = await fetch("/api/mcp-servers");
      if (!res.ok) throw new Error(`mcp HTTP ${res.status}`);
      setServers((await res.json()) as Server[]);
      setLoadStatus("ready");
    } catch (err) {
      setLoadError(String(err));
      setLoadStatus("error");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function handleTest(server: Server) {
    setBusyId(server.id);
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}/test`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setBusyId("");
    }
  }

  async function handleListTools(server: Server) {
    if (expanded === server.id) {
      setExpanded("");
      return;
    }
    setExpanded(server.id);
    setBusyId(server.id);
    try {
      const res = await fetch(`/api/mcp-servers/${server.id}/tools`);
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        setToolsByServer((m) => ({
          ...m,
          [server.id]: { error: body.detail || `HTTP ${res.status}` },
        }));
      } else {
        const data = (await res.json()) as ToolInfo[];
        setToolsByServer((m) => ({
          ...m,
          [server.id]: data,
        }));
      }
    } finally {
      setBusyId("");
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/mcp-servers/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const kpis = useMemo(() => buildKpis(servers), [servers]);

  return (
    <AppShell title="MCP 服务器">
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-8 space-y-6 animate-fade-up">
          {/* Hero · eyebrow + h1 + primary CTA */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-text-subtle">
                <span className="inline-block h-1 w-1 rounded-full bg-primary" />
                Model Context Protocol
              </div>
              <h1 className="mt-1.5 text-[26px] md:text-[28px] font-bold tracking-tight text-text leading-tight">
                MCP{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(120deg, var(--color-primary), color-mix(in srgb, var(--color-accent, var(--color-primary)) 85%, var(--color-primary)))",
                  }}
                >
                  服务器
                </span>
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-text-muted leading-relaxed">
                接入外部 MCP 服务器以扩展工具集 · 支持 stdio / sse / http 三种 transport · 测试连通性后工具即被 Lead Agent 调用
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] font-medium text-text hover:border-border-strong hover:shadow-soft-sm transition duration-base"
                aria-label="刷新"
              >
                <Icon name="refresh" size={14} />
                刷新
              </button>
              <button
                type="button"
                data-testid="tab-add"
                onClick={() => setTab("add")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-fg shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
              >
                <Icon name="plus" size={14} />
                添加服务器
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="mcp-kpis">
            <KpiCard
              variant="gradient"
              icon="server"
              label="注册总数"
              value={kpis.total}
              hint="所有 transport"
            />
            <KpiCard
              icon="check-circle-2"
              label="在线"
              value={kpis.online}
              hint={kpis.online === kpis.total ? "全部可达" : `${kpis.total - kpis.online} 个需排查`}
              tone={kpis.online === kpis.total && kpis.total > 0 ? "success" : "neutral"}
            />
            <KpiCard
              icon="zap"
              label="工具总数"
              value={kpis.tools}
              hint="已暴露给 Lead Agent"
            />
            <KpiCard
              icon="clock"
              label="上次握手"
              value={kpis.lastSyncLabel}
              hint={kpis.lastSyncSub}
              valueClass="text-[15px]"
            />
          </div>

          {/* Tabs */}
          <div role="tablist" className="flex items-center gap-1 border-b border-border">
            {(
              [
                ["registered", "已注册", "list"],
                ["add", "添加", "plus"],
              ] as [Tab, string, IconName][]
            ).map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                data-testid={`tab-${key}`}
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors duration-base ${
                  tab === key
                    ? "text-primary border-primary"
                    : "text-text-muted border-transparent hover:text-text"
                }`}
              >
                <Icon name={icon} size={13} />
                {label}
                {key === "registered" && servers.length > 0 && (
                  <span className="font-mono text-[10px] text-text-subtle">· {servers.length}</span>
                )}
              </button>
            ))}
          </div>

          {tab === "registered" && loadStatus === "loading" && (
            <div data-testid="mcp-loading">
              <RegisteredSkeleton />
            </div>
          )}

          {tab === "registered" && loadStatus === "error" && (
            <div
              data-testid="mcp-error"
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft p-4"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger shrink-0">
                <Icon name="alert-circle" size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-danger">加载 MCP 服务器失败</p>
                <p className="mt-0.5 text-xs text-text-muted font-mono truncate">{loadError}</p>
              </div>
              <button
                onClick={() => void load()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-text hover:border-border-strong hover:shadow-soft-sm transition duration-base"
              >
                <Icon name="refresh" size={12} />
                重试
              </button>
            </div>
          )}

          {tab === "registered" && loadStatus === "ready" && (
            <RegisteredList
              servers={servers}
              busyId={busyId}
              expanded={expanded}
              toolsByServer={toolsByServer}
              onTest={(s) => void handleTest(s)}
              onListTools={(s) => void handleListTools(s)}
              onDelete={(s) => setDeleteTarget(s)}
              onSwitchToAdd={() => setTab("add")}
            />
          )}

          {tab === "add" && (
            <AddForm
              onAdded={async () => {
                setTab("registered");
                await load();
              }}
              onCancel={() => setTab("registered")}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除 MCP 服务器 ${deleteTarget?.name ?? ""}?`}
        message="此操作会永久移除注册记录,不影响外部服务本身。"
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Summary KPI card
// ────────────────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  hint,
  variant = "plain",
  tone = "neutral",
  valueClass,
}: {
  icon: IconName;
  label: string;
  value: number | string;
  hint?: string;
  variant?: "plain" | "gradient";
  tone?: "neutral" | "success" | "warning";
  valueClass?: string;
}) {
  if (variant === "gradient") {
    return (
      <div
        className="relative overflow-hidden rounded-xl p-4 shadow-soft text-primary-fg"
        style={{
          background:
            "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.25) 1px, transparent 1px)",
            backgroundSize: "14px 14px",
          }}
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-80">
              {label}
            </span>
            <Icon name={icon} size={14} className="opacity-80" />
          </div>
          <div
            className={`mt-2 font-semibold tabular-nums leading-none ${
              valueClass ?? "text-[26px]"
            }`}
          >
            {value}
          </div>
          {hint && <p className="mt-1.5 text-[11px] opacity-80">{hint}</p>}
        </div>
      </div>
    );
  }
  const toneRing =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : "text-text-subtle";
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm hover:border-border-strong hover:shadow-soft transition duration-base">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-subtle">
          {label}
        </span>
        <Icon name={icon} size={14} className={toneRing} />
      </div>
      <div
        className={`mt-2 font-semibold tabular-nums leading-none text-text ${
          valueClass ?? "text-[26px]"
        }`}
      >
        {value}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

function buildKpis(servers: Server[]) {
  const total = servers.length;
  const online = servers.filter((s) => s.health === "ok").length;
  const tools = servers.reduce((acc, s) => acc + (s.exposed_tool_ids?.length ?? 0), 0);
  const lastTimestamps = servers
    .map((s) => (s.last_handshake_at ? Date.parse(s.last_handshake_at) : NaN))
    .filter((t) => !Number.isNaN(t));
  const latest = lastTimestamps.length > 0 ? Math.max(...lastTimestamps) : null;
  const lastSyncLabel = latest !== null ? formatRelative(latest) : "—";
  const lastSyncSub = latest !== null ? formatAbsolute(latest) : "尚未连接";
  return { total, online, tools, lastSyncLabel, lastSyncSub };
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s 前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  const d = Math.floor(h / 24);
  return `${d}d 前`;
}

function formatAbsolute(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Health + transport visual language
// ────────────────────────────────────────────────────────────────────────────

function healthMeta(h: Health): {
  label: string;
  dot: string;
  chip: string;
  icon: IconName;
} {
  if (h === "ok") {
    return {
      label: "在线",
      dot: "bg-success",
      chip: "text-success border-success/30 bg-success-soft",
      icon: "check-circle-2",
    };
  }
  if (h === "unreachable") {
    return {
      label: "不可达",
      dot: "bg-danger",
      chip: "text-danger border-danger/30 bg-danger-soft",
      icon: "alert-circle",
    };
  }
  if (h === "auth_failed") {
    return {
      label: "鉴权失败",
      dot: "bg-danger",
      chip: "text-danger border-danger/30 bg-danger-soft",
      icon: "lock",
    };
  }
  return {
    label: "未知",
    dot: "bg-text-subtle",
    chip: "text-text-muted border-border bg-surface-2",
    icon: "circle-help",
  };
}

function transportMeta(t: Transport): { icon: IconName; label: string } {
  if (t === "stdio") return { icon: "terminal", label: "stdio" };
  if (t === "sse") return { icon: "activity", label: "sse" };
  return { icon: "link", label: "http" };
}

function configSummary(s: Server): string {
  const cfg = s.config as Record<string, unknown>;
  if (s.transport === "stdio") {
    const cmd = typeof cfg.command === "string" ? cfg.command : "";
    const args = Array.isArray(cfg.args) ? (cfg.args as unknown[]).join(" ") : "";
    return `${cmd}${args ? " " + args : ""}`.trim() || JSON.stringify(cfg);
  }
  const url = typeof cfg.url === "string" ? cfg.url : "";
  return url || JSON.stringify(cfg);
}

// ────────────────────────────────────────────────────────────────────────────
// Registered server list
// ────────────────────────────────────────────────────────────────────────────

function RegisteredList({
  servers,
  busyId,
  expanded,
  toolsByServer,
  onTest,
  onListTools,
  onDelete,
  onSwitchToAdd,
}: {
  servers: Server[];
  busyId: string;
  expanded: string;
  toolsByServer: Record<string, ToolInfo[] | { error: string }>;
  onTest: (s: Server) => void;
  onListTools: (s: Server) => void;
  onDelete: (s: Server) => void;
  onSwitchToAdd: () => void;
}) {
  if (servers.length === 0) {
    return <EmptyServers onAdd={onSwitchToAdd} />;
  }

  // Pick a "featured" server to render as the gradient default: online w/ most
  // tools, falling back to first server. Purely visual hierarchy.
  const featured = [...servers]
    .filter((s) => s.health === "ok")
    .sort((a, b) => (b.exposed_tool_ids?.length ?? 0) - (a.exposed_tool_ids?.length ?? 0))[0];
  const featuredId = featured?.id ?? servers[0]?.id;

  return (
    <div
      data-testid="mcp-list"
      className="grid grid-cols-1 xl:grid-cols-2 gap-4"
    >
      {servers.map((s) => (
        <ServerCard
          key={s.id}
          server={s}
          featured={s.id === featuredId}
          busy={busyId === s.id}
          expanded={expanded === s.id}
          tools={toolsByServer[s.id]}
          onTest={onTest}
          onListTools={onListTools}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function ServerCard({
  server,
  featured,
  busy,
  expanded,
  tools,
  onTest,
  onListTools,
  onDelete,
}: {
  server: Server;
  featured: boolean;
  busy: boolean;
  expanded: boolean;
  tools: ToolInfo[] | { error: string } | undefined;
  onTest: (s: Server) => void;
  onListTools: (s: Server) => void;
  onDelete: (s: Server) => void;
}) {
  const h = healthMeta(server.health);
  const t = transportMeta(server.transport);
  const toolCount = server.exposed_tool_ids?.length ?? 0;
  const cardClass = featured
    ? "group relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 via-surface to-surface shadow-soft-lg hover:shadow-soft-lg hover:-translate-y-px transition duration-base"
    : "group relative overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm hover:border-border-strong hover:shadow-soft hover:-translate-y-px transition duration-base";

  return (
    <div data-testid={`mcp-${server.name}`} className={cardClass}>
      {featured && (
        <span
          className="absolute top-3 right-3 inline-flex items-center gap-1 h-5 px-2 rounded-full bg-primary text-primary-fg text-[10px] font-semibold shadow-soft-sm"
          aria-hidden="true"
        >
          <Icon name="sparkles" size={10} />
          featured
        </span>
      )}
      <div className="p-5">
        <div className="flex items-start gap-3">
          {/* Plug tile */}
          <div
            className={`grid h-11 w-11 place-items-center rounded-xl shrink-0 ${
              featured
                ? "text-primary-fg shadow-soft-sm"
                : "bg-surface-2 text-primary border border-border"
            }`}
            style={
              featured
                ? {
                    background:
                      "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
                  }
                : undefined
            }
            aria-hidden="true"
          >
            <Icon name="plug" size={18} />
          </div>

          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href={`/mcp-servers/${encodeURIComponent(server.id)}`}
                data-testid={`mcp-link-${server.name}`}
                className="text-[15px] font-semibold tracking-tight text-text hover:text-primary transition-colors duration-fast truncate"
              >
                {server.name}
              </Link>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border bg-surface-2 text-text-muted text-[10px] font-mono">
                <Icon name={t.icon} size={10} />
                {t.label}
              </span>
              <span
                data-testid={`health-${server.name}`}
                className={`inline-flex items-center gap-1 h-5 px-2 rounded-full border text-[10px] font-medium ${h.chip}`}
                aria-label={`health ${server.health}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${h.dot}`} />
                {h.label}
              </span>
              <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border bg-surface-2 text-text-muted text-[10px] font-medium">
                <Icon name="zap" size={10} className="text-text-subtle" />
                <span className="tabular-nums font-semibold text-text">{toolCount}</span>
                tools
              </span>
            </div>
          </div>
        </div>

        {/* URL / command mono line */}
        <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2 min-w-0">
          <p className="text-[11px] font-mono text-text-muted truncate">
            {configSummary(server)}
          </p>
        </div>

        {/* Footer — last handshake + actions */}
        <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-border">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-subtle min-w-0">
            <Icon name="clock" size={11} />
            <span className="truncate">
              {server.last_handshake_at
                ? `上次握手 ${formatRelative(Date.parse(server.last_handshake_at))}`
                : "尚未握手"}
            </span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onTest(server)}
              disabled={busy}
              data-testid={`test-${server.name}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-text hover:border-primary hover:text-primary disabled:opacity-40 transition duration-base"
            >
              {busy ? (
                <>
                  <Icon name="loader" size={11} className="animate-spin-slow" />
                  测试中
                </>
              ) : (
                <>
                  <Icon name="refresh" size={11} />
                  测试
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onListTools(server)}
              data-testid={`tools-${server.name}`}
              aria-expanded={expanded}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] font-medium transition duration-base ${
                expanded
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-surface text-text hover:border-border-strong"
              }`}
            >
              <Icon name={expanded ? "chevron-up" : "chevron-down"} size={11} />
              工具
            </button>
            <button
              type="button"
              onClick={() => onDelete(server)}
              data-testid={`delete-${server.name}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-danger hover:border-danger/40 hover:bg-danger-soft transition duration-base"
            >
              <Icon name="trash-2" size={11} />
              删除
            </button>
          </div>
        </div>

        {/* Expandable tool list */}
        {expanded && (
          <div
            data-testid={`tools-panel-${server.name}`}
            className="mt-3 rounded-lg border border-border bg-bg p-3"
          >
            {tools === undefined && (
              <p className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
                <Icon name="loader" size={11} className="animate-spin-slow" />
                加载工具…
              </p>
            )}
            {tools && "error" in tools && (
              <p
                className="inline-flex items-start gap-1.5 text-[11px] text-danger font-mono"
                data-testid={`tools-error-${server.name}`}
              >
                <Icon name="alert-circle" size={11} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-all">{tools.error}</span>
              </p>
            )}
            {tools && Array.isArray(tools) && tools.length === 0 && (
              <p className="text-[11px] text-text-muted">该服务器未声明任何工具。</p>
            )}
            {tools && Array.isArray(tools) && tools.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {tools.map((tool) => (
                  <li
                    key={tool.name}
                    data-testid={`tool-${server.name}-${tool.name}`}
                    className="flex items-start gap-2 text-[11px]"
                  >
                    <Icon
                      name="zap"
                      size={11}
                      className="mt-0.5 text-primary shrink-0"
                    />
                    <div className="min-w-0">
                      <span className="font-mono text-text">{tool.name}</span>
                      {tool.description && (
                        <span className="text-text-muted"> — {tool.description}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton + empty
// ────────────────────────────────────────────────────────────────────────────

function RegisteredSkeleton() {
  const shimmer =
    "animate-shimmer bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]";
  return (
    <div aria-hidden="true" className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-surface shadow-soft-sm p-5 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl ${shimmer}`} />
            <div className="flex-1 space-y-2">
              <div className={`h-3.5 w-36 rounded ${shimmer}`} />
              <div className="h-2.5 w-24 rounded bg-surface-2" />
            </div>
          </div>
          <div className="h-8 rounded-lg bg-surface-2" />
          <div className="pt-3 border-t border-border flex gap-2 justify-between">
            <div className="h-3 w-24 rounded bg-surface-2" />
            <div className="flex gap-1">
              <div className="h-6 w-12 rounded bg-surface-2" />
              <div className="h-6 w-12 rounded bg-surface-2" />
              <div className="h-6 w-12 rounded bg-surface-2" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyServers({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      data-testid="mcp-empty"
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
          <Icon name="plug" size={36} strokeWidth={1.5} />
        </div>
        <h3 className="mt-6 text-display font-bold tracking-tight text-text">
          Add your first MCP server
        </h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-muted">
          通过 MCP 把外部系统(GitHub、文件系统、数据库等)接成 Lead Agent 可调用的工具。或在对话里让 Lead Agent 用{" "}
          <span className="font-mono text-text">register_mcp_server</span> 代办。
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onAdd}
            data-testid="empty-add-server"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary text-primary-fg text-[13px] font-semibold shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
          >
            <Icon name="plus" size={14} />
            添加 MCP 服务器
          </button>
          <Link
            href="/chat"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-surface border border-border text-[13px] font-semibold text-text hover:border-primary hover:text-primary hover:-translate-y-px transition duration-base"
          >
            <Icon name="sparkles" size={14} />
            让 Lead Agent 代办
          </Link>
        </div>
        <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-text-subtle flex-wrap">
          <span className="font-mono uppercase tracking-wider">Popular presets</span>
          {["github-official", "filesystem", "postgres", "slack"].map((p) => (
            <span
              key={p}
              className="inline-flex items-center h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-mono font-medium"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Add form — sectioned · transport radio cards · focus-glow inputs
// ────────────────────────────────────────────────────────────────────────────

const TRANSPORT_OPTIONS: {
  value: Transport;
  label: string;
  desc: string;
  icon: IconName;
}[] = [
  {
    value: "stdio",
    label: "stdio",
    desc: "本地子进程 · 低延迟",
    icon: "terminal",
  },
  {
    value: "http",
    label: "http",
    desc: "远端 HTTP 请求响应",
    icon: "link",
  },
  {
    value: "sse",
    label: "sse",
    desc: "远端 Server-Sent Events",
    icon: "activity",
  },
];

function AddForm({
  onAdded,
  onCancel,
}: {
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<Transport>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function buildConfig(): Record<string, unknown> | string {
    if (transport === "stdio") {
      if (!command) return "请填写 command";
      const argList = args
        ? args
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean)
        : [];
      const env: Record<string, string> = {};
      for (const line of envText.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) return `环境变量行格式应为 KEY=VALUE: ${trimmed}`;
        env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
      }
      return { command, args: argList, env };
    }
    if (!url) return "请填写 URL";
    const headers: Record<string, string> = {};
    for (const line of headersText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx <= 0) return `Header 行格式应为 Key: Value: ${trimmed}`;
      headers[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return { url, headers };
  }

  async function submit() {
    if (!name) {
      setErr("请填写名称");
      return;
    }
    const cfg = buildConfig();
    if (typeof cfg === "string") {
      setErr(cfg);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, transport, config: cfg }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { detail?: string };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setName("");
      setCommand("");
      setArgs("");
      setEnvText("");
      setUrl("");
      setHeadersText("");
      await onAdded();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    const cfg = buildConfig();
    if (typeof cfg === "string") {
      setErr(cfg);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/mcp-servers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transport, config: cfg }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-soft-sm overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-surface-2/60">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl text-primary-fg shadow-soft-sm shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="plug" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-text leading-tight">
            注册新 MCP 服务器
          </h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            填写连接参数 · 建议先「测试连接」再提交
          </p>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5">
        {/* Section 1 · Basics */}
        <Section icon="info" title="基础信息">
          <Field
            label="名称"
            value={name}
            onChange={setName}
            placeholder="例如 github-official"
          />
        </Section>

        {/* Section 2 · Transport radio cards */}
        <Section icon="share-2" title="传输协议">
          <div
            role="radiogroup"
            aria-label="传输协议"
            data-testid="transport-select"
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            {TRANSPORT_OPTIONS.map((opt) => {
              const active = transport === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`transport-${opt.value}`}
                  onClick={() => setTransport(opt.value)}
                  className={`group relative text-left rounded-xl border p-3 transition duration-base ${
                    active
                      ? "border-primary bg-primary/10 shadow-soft-sm"
                      : "border-border bg-surface hover:border-border-strong hover:shadow-soft-sm"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-lg ${
                        active
                          ? "bg-primary text-primary-fg"
                          : "bg-surface-2 text-text-muted border border-border"
                      }`}
                      aria-hidden="true"
                    >
                      <Icon name={opt.icon} size={13} />
                    </span>
                    <span
                      className={`font-mono text-[12px] font-semibold ${
                        active ? "text-primary" : "text-text"
                      }`}
                    >
                      {opt.label}
                    </span>
                    {active && (
                      <Icon
                        name="check-circle-2"
                        size={13}
                        className="ml-auto text-primary"
                      />
                    )}
                  </div>
                  <p
                    className={`mt-1.5 text-[11px] leading-snug ${
                      active ? "text-primary/80" : "text-text-muted"
                    }`}
                  >
                    {opt.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Section 3 · transport-specific config */}
        <Section
          icon={transport === "stdio" ? "terminal" : "link"}
          title={transport === "stdio" ? "命令与环境" : "端点与头部"}
        >
          {transport === "stdio" ? (
            <div className="flex flex-col gap-3">
              <Field
                label="Command"
                mono
                value={command}
                onChange={setCommand}
                placeholder="npx"
                testid="field-command"
              />
              <Field
                label="Args (逗号分隔)"
                mono
                value={args}
                onChange={setArgs}
                placeholder="-y, @modelcontextprotocol/server-github"
                testid="field-args"
              />
              <TextareaField
                label="Env (每行 KEY=VALUE)"
                testid="field-env"
                value={envText}
                onChange={setEnvText}
                placeholder={"GITHUB_TOKEN=ghp_xxx"}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <Field
                label="URL"
                mono
                value={url}
                onChange={setUrl}
                placeholder="https://example.com/mcp"
                testid="field-url"
                leading="external-link"
              />
              <TextareaField
                label="Headers (每行 Key: Value)"
                testid="field-headers"
                value={headersText}
                onChange={setHeadersText}
                placeholder={"Authorization: Bearer xxx"}
              />
            </div>
          )}
        </Section>

        {err && (
          <div
            data-testid="add-error"
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger"
          >
            <Icon name="alert-circle" size={13} className="mt-0.5 shrink-0" />
            <span className="font-mono min-w-0 break-words">{err}</span>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={busy}
            data-testid="add-test"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] font-medium text-text hover:border-primary hover:text-primary disabled:opacity-40 transition duration-base"
          >
            {busy ? (
              <>
                <Icon name="loader" size={13} className="animate-spin-slow" />
                测试中
              </>
            ) : (
              <>
                <Icon name="zap" size={13} />
                测试连接
              </>
            )}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] font-medium text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition duration-base"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !name}
              data-testid="add-submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-fg shadow-soft hover:bg-primary-hover hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0 transition duration-base"
            >
              {busy ? (
                <>
                  <Icon name="loader" size={13} className="animate-spin-slow" />
                  注册中
                </>
              ) : (
                <>
                  <Icon name="plus" size={13} />
                  注册
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon name={icon} size={12} className="text-text-subtle" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-subtle">
          {title}
        </span>
        <span className="flex-1 h-px bg-border ml-1" aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  testid,
  leading,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  testid?: string;
  leading?: IconName;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-text-muted block mb-1">{label}</span>
      <div className="relative">
        {leading && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none">
            <Icon name={leading} size={13} />
          </span>
        )}
        <input
          data-testid={testid}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg bg-bg border border-border py-2 text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:border-primary focus:shadow-glow-sm transition duration-base ${
            mono ? "font-mono" : ""
          } ${leading ? "pl-8 pr-3" : "px-3"}`}
        />
      </div>
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testid?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-text-muted block mb-1">{label}</span>
      <textarea
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-lg bg-bg border border-border px-3 py-2 text-[13px] text-text font-mono placeholder:text-text-subtle focus:outline-none focus:border-primary focus:shadow-glow-sm transition duration-base resize-y"
      />
    </label>
  );
}
