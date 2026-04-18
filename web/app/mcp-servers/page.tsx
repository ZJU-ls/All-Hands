"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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

  return (
    <AppShell title="MCP 服务器">
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <p className="mb-6 text-sm text-text-muted">
            接入外部 MCP 服务器以扩展工具集。支持 stdio / sse / http 三种 transport,测试连通性后可被 Lead Agent 调用。
          </p>

          <div role="tablist" className="mb-6 flex items-center gap-1 border-b border-border">
            {(
              [
                ["registered", "已注册"],
                ["add", "添加"],
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

          {tab === "registered" && loadStatus === "loading" && (
            <div
              data-testid="mcp-loading"
              className="rounded-xl border border-border bg-surface p-10 text-center"
            >
              <p className="text-sm text-text-muted">加载中…</p>
            </div>
          )}

          {tab === "registered" && loadStatus === "error" && (
            <div
              data-testid="mcp-error"
              className="rounded-xl border border-danger/30 bg-danger/5 p-6"
            >
              <p className="text-sm text-danger mb-2">加载 MCP 服务器失败</p>
              <p className="text-xs text-text-muted mb-3 font-mono">{loadError}</p>
              <button
                onClick={() => void load()}
                className="text-xs rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 text-text transition-colors"
              >
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
            />
          )}

          {tab === "add" && (
            <AddForm
              onAdded={async () => {
                setTab("registered");
                await load();
              }}
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

function healthLabel(h: Health): string {
  if (h === "ok") return "在线";
  if (h === "unreachable") return "不可达";
  if (h === "auth_failed") return "鉴权失败";
  return "未知";
}

function healthDotClass(h: Health): string {
  if (h === "ok") return "bg-success";
  if (h === "unreachable" || h === "auth_failed") return "bg-danger";
  return "bg-text-subtle";
}

function RegisteredList({
  servers,
  busyId,
  expanded,
  toolsByServer,
  onTest,
  onListTools,
  onDelete,
}: {
  servers: Server[];
  busyId: string;
  expanded: string;
  toolsByServer: Record<string, ToolInfo[] | { error: string }>;
  onTest: (s: Server) => void;
  onListTools: (s: Server) => void;
  onDelete: (s: Server) => void;
}) {
  if (servers.length === 0) {
    return (
      <div
        data-testid="mcp-empty"
        className="rounded-xl border border-dashed border-border p-10 text-center"
      >
        <p className="text-sm text-text-muted">
          尚未注册任何 MCP 服务器。切换到&ldquo;添加&rdquo;开始。
        </p>
      </div>
    );
  }
  return (
    <div data-testid="mcp-list" className="flex flex-col gap-2">
      {servers.map((s) => {
        const tools = toolsByServer[s.id];
        const isExpanded = expanded === s.id;
        const busy = busyId === s.id;
        return (
          <div
            key={s.id}
            data-testid={`mcp-${s.name}`}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-text">{s.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-muted font-mono">
                    {s.transport}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-text-muted">
                    <span
                      data-testid={`health-${s.name}`}
                      className={`inline-block h-1.5 w-1.5 rounded-full ${healthDotClass(s.health)}`}
                      aria-label={`health ${s.health}`}
                    />
                    {healthLabel(s.health)}
                  </span>
                </div>
                <p className="text-xs font-mono text-text-subtle truncate">
                  {JSON.stringify(s.config)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onTest(s)}
                  disabled={busy}
                  data-testid={`test-${s.name}`}
                  className="text-xs px-2 py-1 rounded border border-border text-text hover:bg-surface-2 disabled:opacity-40 transition-colors"
                >
                  {busy ? "…" : "测试"}
                </button>
                <button
                  onClick={() => onListTools(s)}
                  data-testid={`tools-${s.name}`}
                  className="text-xs px-2 py-1 rounded border border-border text-text hover:bg-surface-2 transition-colors"
                >
                  {isExpanded ? "收起" : "工具"}
                </button>
                <button
                  onClick={() => onDelete(s)}
                  data-testid={`delete-${s.name}`}
                  className="text-xs px-2 py-1 rounded border border-border text-danger hover:bg-danger/10 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
            {isExpanded && (
              <div
                data-testid={`tools-panel-${s.name}`}
                className="mt-3 pt-3 border-t border-border"
              >
                {tools === undefined && (
                  <p className="text-xs text-text-muted">加载工具…</p>
                )}
                {tools && "error" in tools && (
                  <p
                    className="text-xs text-danger font-mono"
                    data-testid={`tools-error-${s.name}`}
                  >
                    {tools.error}
                  </p>
                )}
                {tools && Array.isArray(tools) && tools.length === 0 && (
                  <p className="text-xs text-text-muted">该服务器未声明任何工具。</p>
                )}
                {tools && Array.isArray(tools) && tools.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {tools.map((t) => (
                      <li
                        key={t.name}
                        data-testid={`tool-${s.name}-${t.name}`}
                        className="text-xs"
                      >
                        <span className="font-mono text-text">{t.name}</span>
                        {t.description && (
                          <span className="text-text-muted"> — {t.description}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddForm({ onAdded }: { onAdded: () => Promise<void> }) {
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

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-text mb-4">注册新 MCP 服务器</h3>
      <div className="flex flex-col gap-3">
        <Field label="名称" value={name} onChange={setName} placeholder="例如 github-official" />

        <div>
          <label className="text-xs text-text-muted block mb-1">Transport</label>
          <select
            data-testid="transport-select"
            value={transport}
            onChange={(e) => setTransport(e.target.value as Transport)}
            className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-primary transition-colors"
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </div>

        {transport === "stdio" && (
          <>
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
            <div>
              <label className="text-xs text-text-muted block mb-1">Env (每行 KEY=VALUE)</label>
              <textarea
                data-testid="field-env"
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                rows={3}
                placeholder={"GITHUB_TOKEN=ghp_xxx"}
                className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text font-mono placeholder-text-subtle focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </>
        )}

        {(transport === "sse" || transport === "http") && (
          <>
            <Field
              label="URL"
              mono
              value={url}
              onChange={setUrl}
              placeholder="https://example.com/mcp"
              testid="field-url"
            />
            <div>
              <label className="text-xs text-text-muted block mb-1">
                Headers (每行 Key: Value)
              </label>
              <textarea
                data-testid="field-headers"
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                rows={3}
                placeholder={"Authorization: Bearer xxx"}
                className="w-full rounded-md bg-bg border border-border px-3 py-2 text-sm text-text font-mono placeholder-text-subtle focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </>
        )}

        {err && (
          <p className="text-xs text-danger font-mono" data-testid="add-error">
            {err}
          </p>
        )}
        <div className="pt-1">
          <button
            onClick={() => void submit()}
            disabled={busy || !name}
            data-testid="add-submit"
            className="rounded-md bg-primary text-primary-fg hover:bg-primary-hover disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
          >
            {busy ? "注册中…" : "注册"}
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
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  testid?: string;
}) {
  return (
    <div>
      <label className="text-xs text-text-muted block mb-1">{label}</label>
      <input
        data-testid={testid}
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
