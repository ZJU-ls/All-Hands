"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/state";

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

const TABS: [Tab, string][] = [
  ["overview", "概览"],
  ["tools", "工具"],
  ["logs", "日志"],
  ["health", "健康时间线"],
];

export default function McpServerDetailPage() {
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
    <AppShell title={server?.name ?? "MCP 服务器"}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <div className="mb-4">
            <Link
              href="/mcp-servers"
              className="text-xs text-text-muted hover:text-text transition-colors duration-base"
            >
              ← 返回 MCP 服务器列表
            </Link>
          </div>

          {status === "loading" && (
            <div data-testid="mcp-detail-loading">
              <LoadingState title="加载 MCP 服务器详情" />
            </div>
          )}

          {status === "notfound" && (
            <div data-testid="mcp-detail-notfound">
              <EmptyState
                title={`MCP 服务器 ${id} 不存在`}
                description="可能已被删除,或 URL 拼写有误。"
              >
                <Link
                  href="/mcp-servers"
                  className="inline-block mt-2 rounded border border-border px-3 py-1.5 text-[12px] text-text hover:bg-surface-2 transition-colors duration-base"
                >
                  回到列表
                </Link>
              </EmptyState>
            </div>
          )}

          {status === "error" && (
            <div data-testid="mcp-detail-error">
              <ErrorState
                title="加载 MCP 服务器失败"
                detail={error}
                action={{ label: "重试", onClick: () => void load() }}
              />
            </div>
          )}

          {status === "ready" && server && (
            <>
              <Header
                server={server}
                dependentCount={dependents.length}
                busy={busy}
                onReconnect={() => void handleReconnect()}
                onDelete={() => setConfirmDelete(true)}
              />

              <div
                role="tablist"
                className="mb-5 flex items-center gap-1 border-b border-border"
              >
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    data-testid={`tab-${key}`}
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={`px-3 py-2 text-xs font-medium transition-colors duration-base border-b-2 -mb-px ${
                      tab === key
                        ? "text-text border-primary"
                        : "text-text-muted border-transparent hover:text-text"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "overview" && (
                <Overview server={server} dependents={dependents} />
              )}
              {tab === "tools" && (
                <ToolsTab
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
        title={`删除 MCP 服务器 ${server?.name ?? ""}?`}
        message="此操作会永久移除注册记录,不影响外部服务本身。"
        confirmLabel="删除"
        danger
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </AppShell>
  );
}

function healthLabel(h: Health): string {
  if (h === "ok") return "健康";
  if (h === "unreachable") return "不可达";
  if (h === "auth_failed") return "鉴权失败";
  return "未知";
}

function healthDotClass(h: Health): string {
  if (h === "ok") return "bg-success";
  if (h === "unreachable" || h === "auth_failed") return "bg-danger";
  return "bg-border-strong";
}

function Header({
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
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            data-testid="mcp-health-dot"
            className={`inline-block h-2 w-2 rounded-full ${healthDotClass(server.health)}`}
            aria-label={`health ${server.health}`}
          />
          <h2
            data-testid="mcp-name"
            className="text-lg font-semibold tracking-tight text-text"
          >
            {server.name}
          </h2>
          <span
            data-testid="mcp-transport"
            className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted font-mono"
          >
            {server.transport}
          </span>
          <span
            data-testid="mcp-health-label"
            className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted"
          >
            {healthLabel(server.health)}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted">
            {server.enabled ? "已启用" : "已停用"}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-surface-2 text-text-muted">
            {dependentCount} 员工引用
          </span>
        </div>
        <p className="text-[11px] font-mono text-text-subtle mt-1 truncate">
          {server.id}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onReconnect}
          disabled={busy !== ""}
          data-testid="mcp-reconnect"
          className="text-xs px-3 py-1.5 rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text disabled:opacity-40 transition-colors duration-base"
        >
          {busy === "reconnect" ? "重连中…" : "重连"}
        </button>
        <button
          onClick={onDelete}
          data-testid="mcp-delete"
          className="text-xs px-3 py-1.5 rounded border border-border text-danger hover:bg-danger/10 transition-colors duration-base"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-md border border-border bg-surface p-5">
      <h3 className="text-[10px] uppercase tracking-wider font-mono text-text-subtle mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Overview({
  server,
  dependents,
}: {
  server: Server;
  dependents: Employee[];
}) {
  return (
    <div data-testid="tab-panel-overview">
      <Section title="配置">
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-xs">
          <dt className="text-text-muted">transport</dt>
          <dd className="font-mono text-text">{server.transport}</dd>
          <dt className="text-text-muted">健康</dt>
          <dd className="font-mono text-text">{server.health}</dd>
          <dt className="text-text-muted">启用</dt>
          <dd className="font-mono text-text">
            {server.enabled ? "true" : "false"}
          </dd>
          <dt className="text-text-muted">最近握手</dt>
          <dd className="font-mono text-text">
            {server.last_handshake_at
              ? formatTime(server.last_handshake_at)
              : "尚未握手"}
          </dd>
          <dt className="text-text-muted">已暴露工具</dt>
          <dd className="font-mono text-text">
            {server.exposed_tool_ids.length}
          </dd>
        </dl>
      </Section>

      <Section title="原始 config">
        <pre
          data-testid="mcp-config-pre"
          className="text-[11px] font-mono text-text bg-bg border border-border rounded p-3 whitespace-pre-wrap break-words"
        >
          {JSON.stringify(server.config, null, 2)}
        </pre>
      </Section>

      <Section title={`使用该服务器的员工 · ${dependents.length}`}>
        {dependents.length === 0 ? (
          <p data-testid="dependents-empty" className="text-xs text-text-muted">
            尚无员工引用该服务器暴露的工具。
          </p>
        ) : (
          <div data-testid="dependents-list" className="flex flex-col gap-1.5">
            {dependents.map((e) => (
              <Link
                key={e.id}
                href={`/employees/${encodeURIComponent(e.id)}`}
                data-testid={`dependent-${e.id}`}
                className="flex items-center gap-2 rounded border border-border bg-bg px-3 py-2 text-xs hover:border-border-strong hover:bg-surface-2 transition-colors duration-base"
              >
                <span className="text-text">{e.name}</span>
                {e.is_lead_agent && (
                  <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-border text-text-muted">
                    lead
                  </span>
                )}
                <span className="font-mono text-text-subtle text-[10px] truncate">
                  {e.id}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function ToolsTab({
  tools,
  loading,
  error,
  expandedTool,
  onToggleExpand,
  onRefresh,
}: {
  tools: ToolInfo[] | null;
  loading: boolean;
  error: string;
  expandedTool: string;
  onToggleExpand: (name: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div data-testid="tab-panel-tools">
      <Section title="暴露的工具">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] text-text-muted">
            点击一行查看 input_schema。
          </p>
          <button
            onClick={onRefresh}
            disabled={loading}
            data-testid="tools-refresh"
            className="text-[11px] px-2 py-1 rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text disabled:opacity-40 transition-colors duration-base"
          >
            {loading ? "拉取中…" : "刷新"}
          </button>
        </div>

        {loading && (
          <div data-testid="tools-loading">
            <LoadingState title="拉取工具清单" />
          </div>
        )}

        {!loading && error && (
          <div data-testid="tools-error">
            <ErrorState
              title="获取工具失败"
              detail={error}
              action={{ label: "重试", onClick: onRefresh }}
            />
          </div>
        )}

        {!loading && !error && tools && tools.length === 0 && (
          <div data-testid="tools-empty">
            <EmptyState
              title="该服务器未声明工具"
              description="握手成功但工具清单为空。"
            />
          </div>
        )}

        {!loading && !error && tools && tools.length > 0 && (
          <div data-testid="tools-table" className="flex flex-col gap-1">
            {tools.map((t) => {
              const expanded = expandedTool === t.name;
              return (
                <div
                  key={t.name}
                  data-testid={`tool-row-${t.name}`}
                  className="rounded border border-border bg-bg"
                >
                  <button
                    onClick={() => onToggleExpand(t.name)}
                    className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-surface-2 transition-colors duration-base"
                  >
                    <span className="font-mono text-xs text-text shrink-0">
                      {t.name}
                    </span>
                    {t.description && (
                      <span className="text-[11px] text-text-muted flex-1 truncate">
                        — {t.description}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-text-subtle shrink-0">
                      {expanded ? "−" : "+"}
                    </span>
                  </button>
                  {expanded && (
                    <div
                      data-testid={`tool-schema-${t.name}`}
                      className="border-t border-border px-3 py-2"
                    >
                      <p className="text-[10px] uppercase tracking-wider font-mono text-text-subtle mb-1.5">
                        input schema
                      </p>
                      <pre className="text-[11px] font-mono text-text whitespace-pre-wrap break-words">
                        {JSON.stringify(t.input_schema, null, 2)}
                      </pre>
                    </div>
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
  return (
    <div data-testid="tab-panel-logs">
      <Section title="MCP 通信日志">
        <div data-testid="logs-empty">
          <EmptyState
            title="暂无日志流"
            description="后端尚未暴露 MCP 通信日志接口。请关注 TRACK-F-FOLLOWUP 中记录的 logs endpoint。"
          />
        </div>
      </Section>
    </div>
  );
}

function HealthTab({ server }: { server: Server }) {
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
          ? "最近一次握手成功"
          : "最近握手出现异常"
        : "尚未握手,首次连接前状态为 unknown",
    },
  ];
  return (
    <div data-testid="tab-panel-health">
      <Section title="当前状态">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-subtle">
              <th className="pb-2 font-mono font-normal">时间</th>
              <th className="pb-2 font-mono font-normal">状态</th>
              <th className="pb-2 font-mono font-normal">备注</th>
            </tr>
          </thead>
          <tbody
            data-testid="health-table-body"
            className="border-t border-border"
          >
            {rows.map((r, idx) => (
              <tr
                key={idx}
                className="border-b border-border last:border-b-0"
              >
                <td className="py-2 font-mono text-text-muted">
                  {r.at ? formatTime(r.at) : "—"}
                </td>
                <td className="py-2 font-mono text-text">{r.state}</td>
                <td className="py-2 text-text-muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <div data-testid="health-timeline-placeholder">
        <EmptyState
          title="历史时间线待落地"
          description="当前后端仅保留最近一次握手时间。完整时间线已记入 TRACK-F-FOLLOWUP。"
        />
      </div>
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
