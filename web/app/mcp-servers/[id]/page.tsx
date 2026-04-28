"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * MCP server detail page · ADR 0016 V2 Azure Live polish.
 *
 * Breadcrumb · gradient hero (plug tile · health dot + chip · transport chip ·
 * exposed-tool count · enable state) · tab pills · sectioned body cards for
 * config / raw JSON / tools list (expandable schema) / health timeline /
 * dependents. All fetch / mutation / navigation / data-testid preserved.
 */

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

type Employee = {
  id: string;
  name: string;
  is_lead_agent: boolean;
  tool_ids: string[];
};

type Tab = "overview" | "tools" | "logs" | "health";

type LoadStatus = "loading" | "ready" | "notfound" | "error";

const TABS: ReadonlyArray<readonly [Tab, IconName]> = [
  ["overview", "layout-grid"],
  ["tools", "zap"],
  ["logs", "terminal"],
  ["health", "activity"],
];

export default function McpServerDetailPage() {
  const t = useTranslations("mcp.detail");
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [server, setServer] = useState<Server | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [toolsError, setToolsError] = useState("");
  const [toolsLoading, setToolsLoading] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string>("");
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<"reconnect" | "">("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setStatus("loading");
    try {
      const [sRes, eRes] = await Promise.all([
        fetch(`/api/mcp-servers/${encodeURIComponent(id)}`),
        fetch("/api/employees"),
      ]);
      if (sRes.status === 404) {
        setStatus("notfound");
        return;
      }
      if (!sRes.ok) throw new Error(`server HTTP ${sRes.status}`);
      if (!eRes.ok) throw new Error(`employees HTTP ${eRes.status}`);
      setServer((await sRes.json()) as Server);
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

  const loadTools = useCallback(async () => {
    if (!server) return;
    setToolsLoading(true);
    setToolsError("");
    try {
      const res = await fetch(
        `/api/mcp-servers/${encodeURIComponent(server.id)}/tools`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setTools((await res.json()) as ToolInfo[]);
    } catch (e) {
      setToolsError(String(e));
      setTools(null);
    } finally {
      setToolsLoading(false);
    }
  }, [server]);

  useEffect(() => {
    if (tab === "tools" && server && tools === null && !toolsLoading) {
      void loadTools();
    }
  }, [tab, server, tools, toolsLoading, loadTools]);

  async function handleReconnect() {
    if (!server) return;
    setBusy("reconnect");
    try {
      const res = await fetch(
        `/api/mcp-servers/${encodeURIComponent(server.id)}/test`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(body.detail || `HTTP ${res.status}`);
      }
      setTools(null);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }

  async function handleDelete() {
    if (!server) return;
    setDeleting(true);
    try {
      await fetch(`/api/mcp-servers/${encodeURIComponent(server.id)}`, {
        method: "DELETE",
      });
      window.location.href = "/mcp-servers";
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  }

  const dependents = server
    ? employees.filter((e) =>
        e.tool_ids.some((tid) => server.exposed_tool_ids.includes(tid)),
      )
    : [];

  return (
    <AppShell title={server?.name ?? t("appShellFallback")}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          <Breadcrumb name={server?.name} />

          {status === "loading" && (
            <div data-testid="mcp-detail-loading">
              <LoadingState title={t("loadingTitle")} />
            </div>
          )}

          {status === "notfound" && (
            <div data-testid="mcp-detail-notfound">
              <EmptyState
                title={t("notFoundTitle", { id })}
                description={t("notFoundDescription")}
              >
                <Link
                  href="/mcp-servers"
                  className="inline-flex items-center gap-1.5 mt-2 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
                >
                  <Icon name="arrow-left" size={12} />
                  {t("backToList")}
                </Link>
              </EmptyState>
            </div>
          )}

          {status === "error" && (
            <div data-testid="mcp-detail-error">
              <ErrorState
                title={t("loadErrorTitle")}
                detail={error}
                action={{ label: t("retry"), onClick: () => void load() }}
              />
            </div>
          )}

          {status === "ready" && server && (
            <>
              <Hero
                server={server}
                dependentCount={dependents.length}
                busy={busy}
                onReconnect={() => void handleReconnect()}
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
                <Overview server={server} dependents={dependents} />
              )}
              {tab === "tools" && (
                <ToolsTab
                  serverId={server.id}
                  tools={tools}
                  loading={toolsLoading}
                  error={toolsError}
                  expandedTool={expandedTool}
                  onToggleExpand={(name) =>
                    setExpandedTool((prev) => (prev === name ? "" : name))
                  }
                  onRefresh={() => {
                    setTools(null);
                    void loadTools();
                  }}
                />
              )}
              {tab === "logs" && <LogsTab />}
              {tab === "health" && <HealthTab server={server} />}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t("deleteTitle", { name: server?.name ?? "" })}
        message={t("deleteMessage")}
        confirmLabel={t("deleteConfirm")}
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}

function Breadcrumb({ name }: { name?: string }) {
  const t = useTranslations("mcp.detail");
  return (
    <div className="flex items-center gap-1.5 font-mono text-caption uppercase tracking-wider text-text-subtle">
      <Link
        href="/mcp-servers"
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

type Translator = ReturnType<typeof useTranslations>;

function healthMeta(h: Health, t: Translator): {
  label: string;
  dot: string;
  chip: string;
  icon: IconName;
} {
  if (h === "ok")
    return {
      label: t("health.ok"),
      dot: "bg-success",
      chip: "text-success border-success/30 bg-success-soft",
      icon: "check-circle-2",
    };
  if (h === "unreachable")
    return {
      label: t("health.unreachable"),
      dot: "bg-danger",
      chip: "text-danger border-danger/30 bg-danger-soft",
      icon: "alert-circle",
    };
  if (h === "auth_failed")
    return {
      label: t("health.authFailed"),
      dot: "bg-danger",
      chip: "text-danger border-danger/30 bg-danger-soft",
      icon: "lock",
    };
  return {
    label: t("health.unknown"),
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

function Hero({
  server,
  dependentCount,
  busy,
  onReconnect,
  onDelete,
}: {
  server: Server;
  dependentCount: number;
  busy: "reconnect" | "";
  onReconnect: () => void;
  onDelete: () => void;
}) {
  const tr = useTranslations("mcp.detail");
  const trHero = useTranslations("mcp.detail.hero");
  const h = healthMeta(server.health, tr);
  const tp = transportMeta(server.transport);
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
            <Icon name="plug" size={26} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                data-testid="mcp-health-dot"
                className={`inline-block h-2 w-2 rounded-full ${h.dot}`}
                aria-label={`health ${server.health}`}
              />
              <h1
                data-testid="mcp-name"
                className="text-xl font-bold tracking-tight text-text truncate"
              >
                {server.name}
              </h1>
              <span
                data-testid="mcp-transport"
                className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono"
              >
                <Icon name={tp.icon} size={10} strokeWidth={2.25} />
                {tp.label}
              </span>
              <span
                data-testid="mcp-health-label"
                className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-caption font-mono font-medium ${h.chip}`}
              >
                <Icon name={h.icon} size={10} strokeWidth={2.25} />
                {h.label}
              </span>
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                <Icon
                  name={server.enabled ? "check" : "pause"}
                  size={10}
                  strokeWidth={2.25}
                />
                {server.enabled ? trHero("enabled") : trHero("disabled")}
              </span>
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                <Icon name="zap" size={10} strokeWidth={2.25} />
                {trHero("tools", { count: server.exposed_tool_ids.length })}
              </span>
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                <Icon name="users" size={10} strokeWidth={2.25} />
                {trHero("dependents", { count: dependentCount })}
              </span>
            </div>
            <p className="font-mono text-caption text-text-subtle truncate">
              {server.id}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onReconnect}
            disabled={busy !== ""}
            data-testid="mcp-reconnect"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm disabled:opacity-40 transition duration-base"
          >
            {busy === "reconnect" ? (
              <>
                <Icon name="loader" size={12} className="animate-spin-slow" />
                {trHero("reconnecting")}
              </>
            ) : (
              <>
                <Icon name="refresh" size={12} />
                {trHero("reconnect")}
              </>
            )}
          </button>
          <button
            onClick={onDelete}
            data-testid="mcp-delete"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-danger/30 bg-danger-soft text-[12px] font-semibold text-danger hover:bg-danger/15 transition duration-base"
          >
            <Icon name="trash-2" size={12} />
            {trHero("delete")}
          </button>
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
  server,
  dependents,
}: {
  server: Server;
  dependents: Employee[];
}) {
  const t = useTranslations("mcp.detail.overview");
  const locale = useLocale();
  return (
    <div data-testid="tab-panel-overview" className="space-y-5">
      <Section title={t("config")} icon="settings">
        <MetaGrid
          items={[
            { k: t("transport"), v: server.transport, mono: true },
            { k: t("health"), v: server.health, mono: true },
            {
              k: t("enabled"),
              v: server.enabled ? "true" : "false",
              mono: true,
            },
            {
              k: t("lastHandshake"),
              v: server.last_handshake_at
                ? formatTime(server.last_handshake_at, locale)
                : t("neverHandshake"),
              mono: true,
            },
            {
              k: t("exposedTools"),
              v: String(server.exposed_tool_ids.length),
              mono: true,
            },
          ]}
        />
      </Section>

      <Section title={t("rawConfig")} icon="code">
        <pre
          data-testid="mcp-config-pre"
          className="text-[11px] font-mono text-text bg-surface-2 border border-border rounded-lg p-4 whitespace-pre-wrap break-words leading-relaxed"
        >
          {JSON.stringify(server.config, null, 2)}
        </pre>
      </Section>

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

function ToolsTab({
  serverId,
  tools,
  loading,
  error,
  expandedTool,
  onToggleExpand,
  onRefresh,
}: {
  serverId: string;
  tools: ToolInfo[] | null;
  loading: boolean;
  error: string;
  expandedTool: string;
  onToggleExpand: (name: string) => void;
  onRefresh: () => void;
}) {
  const tr = useTranslations("mcp.detail.tools");
  return (
    <div data-testid="tab-panel-tools" className="space-y-5">
      <Section
        title={tr("section")}
        icon="zap"
        action={
          <button
            onClick={onRefresh}
            disabled={loading}
            data-testid="tools-refresh"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text-muted hover:text-text hover:border-border-strong shadow-soft-sm disabled:opacity-40 transition duration-base"
          >
            {loading ? (
              <>
                <Icon name="loader" size={12} className="animate-spin-slow" />
                {tr("fetching")}
              </>
            ) : (
              <>
                <Icon name="refresh" size={12} />
                {tr("refresh")}
              </>
            )}
          </button>
        }
      >
        <p className="text-sm text-text-muted leading-relaxed mb-4">
          {tr.rich("intro", {
            mono: (chunks) => <span className="font-mono text-text">{chunks}</span>,
          })}
        </p>

        {loading && (
          <div data-testid="tools-loading">
            <LoadingState title={tr("loading")} />
          </div>
        )}

        {!loading && error && (
          <div data-testid="tools-error">
            <ErrorState
              title={tr("errorTitle")}
              detail={error}
              action={{ label: tr("retry"), onClick: onRefresh }}
            />
          </div>
        )}

        {!loading && !error && tools && tools.length === 0 && (
          <div data-testid="tools-empty">
            <EmptyState
              title={tr("emptyTitle")}
              description={tr("emptyDescription")}
            />
          </div>
        )}

        {!loading && !error && tools && tools.length > 0 && (
          <div data-testid="tools-table" className="flex flex-col gap-2">
            {tools.map((tool) => {
              const expanded = expandedTool === tool.name;
              return (
                <div
                  key={tool.name}
                  data-testid={`tool-row-${tool.name}`}
                  className="rounded-lg border border-border bg-surface-2 overflow-hidden"
                >
                  <button
                    onClick={() => onToggleExpand(tool.name)}
                    className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-3 transition duration-base"
                  >
                    <Icon
                      name="zap"
                      size={13}
                      className="text-primary shrink-0 mt-0.5"
                    />
                    <span className="font-mono text-[12px] font-semibold text-text shrink-0">
                      {tool.name}
                    </span>
                    {tool.description && (
                      <span className="text-[12px] text-text-muted flex-1 truncate">
                        {tool.description}
                      </span>
                    )}
                    <Icon
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={13}
                      className="text-text-subtle shrink-0 mt-0.5"
                    />
                  </button>
                  {expanded && (
                    <ToolTryPanel serverId={serverId} tool={tool} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

function LogsTab() {
  const t = useTranslations("mcp.detail.logs");
  return (
    <div data-testid="tab-panel-logs" className="space-y-5">
      <Section title={t("section")} icon="terminal">
        <div data-testid="logs-empty">
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        </div>
      </Section>
    </div>
  );
}

function HealthTab({ server }: { server: Server }) {
  const tr = useTranslations("mcp.detail");
  const trH = useTranslations("mcp.detail.healthTab");
  const locale = useLocale();
  const rows: {
    at: string | null;
    state: Health;
    note: string;
  }[] = [
    {
      at: server.last_handshake_at,
      state: server.health,
      note: server.last_handshake_at
        ? server.health === "ok"
          ? trH("noteOk")
          : trH("noteFail")
        : trH("noteNever"),
    },
  ];
  return (
    <div data-testid="tab-panel-health" className="space-y-5">
      <Section title={trH("section")} icon="activity">
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2">
                <th className="text-left py-2 px-3 font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold">
                  {trH("thTime")}
                </th>
                <th className="text-left py-2 px-3 font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold">
                  {trH("thState")}
                </th>
                <th className="text-left py-2 px-3 font-mono text-caption uppercase tracking-wider text-text-subtle font-semibold">
                  {trH("thNote")}
                </th>
              </tr>
            </thead>
            <tbody data-testid="health-table-body">
              {rows.map((r, idx) => {
                const m = healthMeta(r.state, tr);
                return (
                  <tr key={idx} className="border-t border-border">
                    <td className="py-2 px-3 font-mono text-[12px] text-text-muted">
                      {r.at ? formatTime(r.at, locale) : "—"}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border font-mono text-caption font-medium ${m.chip}`}
                      >
                        <Icon name={m.icon} size={10} strokeWidth={2.25} />
                        {r.state}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[12px] text-text-muted">
                      {r.note}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <div data-testid="health-timeline-placeholder">
        <EmptyState
          title={trH("timelineTitle")}
          description={trH("timelineDescription")}
        />
      </div>
    </div>
  );
}

function formatTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(locale);
  } catch {
    return iso;
  }
}

/**
 * ToolTryPanel · in-place "Try it" runner for a single MCP tool.
 *
 * Schema-driven form: each top-level property in ``tool.input_schema``
 * becomes a labeled input. Supported types map directly:
 *   - string            → single-line input
 *   - integer / number  → number input
 *   - boolean           → checkbox
 *   - object / array    → JSON textarea (caller types JSON)
 *
 * Anything richer falls back to a JSON textarea — this stays useful for
 * unusual schemas without invented UX. Calls ``POST /mcp-servers/{id}/invoke``;
 * shows raw result on success, error message on failure. ESC clears.
 */
function ToolTryPanel({
  serverId,
  tool,
}: {
  serverId: string;
  tool: ToolInfo;
}) {
  const tr = useTranslations("mcp.detail.tools.tryPanel");
  type RunState =
    | { status: "idle" }
    | { status: "running" }
    | { status: "ok"; result: unknown }
    | { status: "error"; message: string };
  const [args, setArgs] = useState<Record<string, unknown>>(() =>
    initialArgsFromSchema(tool.input_schema),
  );
  const [run, setRun] = useState<RunState>({ status: "idle" });

  const props = readSchemaProperties(tool.input_schema);
  const required = readSchemaRequired(tool.input_schema);

  const setArg = (key: string, value: unknown) =>
    setArgs((prev) => ({ ...prev, [key]: value }));

  async function invoke() {
    setRun({ status: "running" });
    try {
      const res = await fetch(
        `/api/mcp-servers/${encodeURIComponent(serverId)}/invoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool_name: tool.name, arguments: args }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          (body && typeof body === "object" && "detail" in body
            ? String((body as { detail: unknown }).detail)
            : "") || `${res.status} ${res.statusText}`;
        setRun({ status: "error", message: detail });
        return;
      }
      setRun({ status: "ok", result: body });
    } catch (e) {
      setRun({
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const reset = () => {
    setArgs(initialArgsFromSchema(tool.input_schema));
    setRun({ status: "idle" });
  };

  return (
    <div
      data-testid={`tool-try-${tool.name}`}
      className="border-t border-border px-3 py-3 bg-bg space-y-3"
    >
      <p className="text-caption uppercase tracking-wider font-mono text-text-subtle font-semibold">
        {tr("title")}
      </p>
      {props.length === 0 ? (
        <p className="text-[12px] text-text-muted">{tr("noArgs")}</p>
      ) : (
        <div className="space-y-2.5">
          {props.map(({ key, schema }) => (
            <SchemaField
              key={key}
              name={key}
              required={required.includes(key)}
              schema={schema}
              value={args[key]}
              onChange={(v) => setArg(key, v)}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void invoke()}
          disabled={run.status === "running"}
          data-testid={`tool-try-run-${tool.name}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-fg text-[12px] font-medium hover:bg-primary-hover disabled:opacity-40 transition duration-base"
        >
          {run.status === "running" ? (
            <>
              <Icon name="loader" size={12} className="animate-spin-slow" />
              {tr("running")}
            </>
          ) : (
            <>
              <Icon name="play" size={12} />
              {tr("run")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-surface text-[12px] text-text-muted hover:text-text hover:border-border-strong transition duration-base"
        >
          {tr("reset")}
        </button>
        {run.status === "ok" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-success font-mono">
            <Icon name="check" size={12} />
            {tr("ok")}
          </span>
        )}
        {run.status === "error" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-danger font-mono">
            <Icon name="alert-circle" size={12} />
            {tr("err")}
          </span>
        )}
      </div>
      {run.status === "ok" && (
        <div data-testid={`tool-try-result-${tool.name}`}>
          <p className="text-caption uppercase tracking-wider font-mono text-text-subtle font-semibold mb-1">
            {tr("result")}
          </p>
          <pre className="text-[11px] font-mono text-text whitespace-pre-wrap break-words leading-relaxed bg-surface-2 border border-border rounded-md p-2 max-h-[280px] overflow-auto">
            {JSON.stringify(run.result, null, 2)}
          </pre>
        </div>
      )}
      {run.status === "error" && (
        <div
          data-testid={`tool-try-error-${tool.name}`}
          className="text-[12px] text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2"
        >
          {run.message}
        </div>
      )}
    </div>
  );
}

// ── schema helpers · pure ─────────────────────────────────────────────

type SchemaProp = { key: string; schema: Record<string, unknown> };

function readSchemaProperties(schema: Record<string, unknown>): SchemaProp[] {
  const props = schema.properties;
  if (!props || typeof props !== "object") return [];
  return Object.entries(props as Record<string, unknown>).map(([key, s]) => ({
    key,
    schema: (s as Record<string, unknown>) ?? {},
  }));
}

function readSchemaRequired(schema: Record<string, unknown>): string[] {
  const r = schema.required;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
}

function initialArgsFromSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, schema: s } of readSchemaProperties(schema)) {
    if ("default" in s) {
      out[key] = (s as { default: unknown }).default;
      continue;
    }
    const t = (s.type as string | undefined) ?? "string";
    if (t === "boolean") out[key] = false;
    else if (t === "integer" || t === "number") out[key] = 0;
    else out[key] = "";
  }
  return out;
}

function SchemaField({
  name,
  required,
  schema,
  value,
  onChange,
}: {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const tr = useTranslations("mcp.detail.tools.tryPanel");
  const t = (schema.type as string | undefined) ?? "string";
  const description = (schema.description as string | undefined) ?? "";
  const label = (
    <label className="block text-[11px] font-mono text-text-muted">
      {name}
      {required ? <span className="text-danger ml-1">*</span> : null}
      {description ? (
        <span className="ml-2 text-text-subtle font-sans">· {description}</span>
      ) : null}
    </label>
  );

  if (t === "boolean") {
    return (
      <div className="space-y-1">
        {label}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-border bg-surface text-primary"
        />
      </div>
    );
  }
  if (t === "integer" || t === "number") {
    return (
      <div className="space-y-1">
        {label}
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const n = e.target.value === "" ? 0 : Number(e.target.value);
            onChange(t === "integer" ? Math.trunc(n) : n);
          }}
          className="block w-full h-8 px-2 rounded-md border border-border bg-surface text-[12px] font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    );
  }
  if (t === "object" || t === "array") {
    const text =
      typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
    return (
      <div className="space-y-1">
        {label}
        <textarea
          value={text}
          onChange={(e) => {
            const raw = e.target.value;
            try {
              onChange(JSON.parse(raw));
            } catch {
              onChange(raw); // store raw string · invoke will likely 502 with msg
            }
          }}
          rows={3}
          placeholder={tr("jsonPlaceholder")}
          className="block w-full px-2 py-1 rounded-md border border-border bg-surface text-[12px] font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    );
  }
  // default string
  return (
    <div className="space-y-1">
      {label}
      <input
        type="text"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full h-8 px-2 rounded-md border border-border bg-surface text-[12px] font-mono text-text focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}
