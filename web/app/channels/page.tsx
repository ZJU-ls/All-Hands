"use client";

/**
 * Notification channels · V2 Azure Live admin console (ADR 0016).
 *
 * Users register platform-level notification targets (Telegram / Bark / WeCom
 * / Feishu / Email / PushDeer) that any skill · trigger · agent can hit via
 * the `send_notification` tool. The page follows the shared V2 pattern:
 *   1. Eyebrow + h1 + primary CTA (Add channel).
 *   2. Summary KPIs — total / active / inbound-wired / outbound-auto (first
 *      card carries the primary gradient).
 *   3. Channel grid — 2-col xl cards · kind icon tile · enabled chip ·
 *      inbound/outbound wiring chips · target in mono · last-test result ·
 *      inline test/delete actions.
 *   4. Create form — sectioned · kind radio cards (six types) · kind-specific
 *      mono inputs with focus glow · toggles for inbound/outbound/auto-approve.
 *   5. Empty state — mesh hero + floating bell tile + preset kind chips.
 *
 * Data/state/fetch/mutation contracts are preserved from the previous version,
 * all `data-testid` values and user-facing Chinese labels are kept for e2e
 * compatibility.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/icon";

type ChannelKind = "telegram" | "bark" | "wecom" | "feishu" | "email" | "pushdeer";

type Channel = {
  id: string;
  kind: ChannelKind;
  display_name: string;
  config: Record<string, unknown>;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  auto_approve_outbound: boolean;
  webhook_secret: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type TestOutcome = { ok: boolean; detail: string; latency_ms: number };

type Tab = "registered" | "add";

const KIND_LABEL: Record<ChannelKind, string> = {
  telegram: "Telegram",
  bark: "Bark (iOS)",
  wecom: "企业微信",
  feishu: "飞书",
  email: "邮件 (SMTP)",
  pushdeer: "PushDeer",
};

const KIND_HINT: Record<ChannelKind, string> = {
  telegram: "bot_token + chat_id · 双向",
  bark: "device_key · 单向 iOS 推送",
  wecom: "corp_id + corp_secret + agent_id · v0 stub",
  feishu: "webhook_url + signing_secret · v0 stub",
  email: "SMTP host/port/credentials · v0 stub",
  pushdeer: "push_key · v0 stub",
};

const KIND_CONFIG_FIELDS: Record<ChannelKind, string[]> = {
  telegram: ["bot_token", "chat_id"],
  bark: ["device_key", "server_url"],
  wecom: ["corp_id", "corp_secret", "agent_id", "to_user"],
  feishu: ["webhook_url", "signing_secret"],
  email: ["smtp_host", "smtp_port", "username", "password", "from_addr", "to_addr"],
  pushdeer: ["push_key", "server_url"],
};

const KIND_ICON: Record<ChannelKind, IconName> = {
  telegram: "send",
  bark: "bell",
  wecom: "message-square",
  feishu: "message-square",
  email: "mail",
  pushdeer: "zap",
};

const KINDS: ChannelKind[] = ["telegram", "bark", "wecom", "feishu", "email", "pushdeer"];

type CreateDraft = {
  kind: ChannelKind;
  display_name: string;
  config: Record<string, string>;
  inbound_enabled: boolean;
  outbound_enabled: boolean;
  auto_approve_outbound: boolean;
  webhook_secret: string;
};

function emptyDraft(kind: ChannelKind = "telegram"): CreateDraft {
  const config: Record<string, string> = {};
  for (const f of KIND_CONFIG_FIELDS[kind]) config[f] = "";
  return {
    kind,
    display_name: "",
    config,
    inbound_enabled: kind === "telegram",
    outbound_enabled: true,
    auto_approve_outbound: false,
    webhook_secret: "",
  };
}

export default function ChannelsPage() {
  const [tab, setTab] = useState<Tab>("registered");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testingId, setTestingId] = useState<string>("");
  const [testResult, setTestResult] = useState<Record<string, TestOutcome>>({});

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/channels");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setChannels((await res.json()) as Channel[]);
      setStatus("ready");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTest(ch: Channel) {
    setTestingId(ch.id);
    try {
      const res = await fetch(`/api/channels/${ch.id}/test`, { method: "POST" });
      const data = (await res.json()) as TestOutcome;
      setTestResult((prev) => ({ ...prev, [ch.id]: data }));
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [ch.id]: { ok: false, detail: String(err), latency_ms: 0 },
      }));
    } finally {
      setTestingId("");
    }
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/channels/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const kpis = useMemo(() => buildKpis(channels), [channels]);

  return (
    <AppShell title="通知渠道">
      <div className="h-full overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 md:px-8 py-8 space-y-6 animate-fade-up">
          {/* Hero · eyebrow + h1 + primary CTA */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-text-subtle">
                <span className="inline-block h-1 w-1 rounded-full bg-primary" />
                Platform Notifications
              </div>
              <h1 className="mt-1.5 text-[26px] md:text-[28px] font-bold tracking-tight text-text leading-tight">
                通知{" "}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(120deg, var(--color-primary), color-mix(in srgb, var(--color-accent, var(--color-primary)) 85%, var(--color-primary)))",
                  }}
                >
                  渠道
                </span>
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-text-muted leading-relaxed">
                平台级通知出口 · 任何 skill / trigger / agent 调用{" "}
                <span className="font-mono text-text">send_notification</span>{" "}
                即可触达用户 · Telegram 与 Bark 为 v0 真实可用,其他为 stub
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
                data-testid="new-channel"
                onClick={() => setTab("add")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-semibold text-primary-fg shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
              >
                <Icon name="plus" size={14} />
                注册渠道
              </button>
            </div>
          </div>

          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="channels-kpis">
            <KpiCard
              variant="gradient"
              icon="bell"
              label="注册总数"
              value={kpis.total}
              hint={kpis.total === 0 ? "尚未注册" : "所有 kind"}
            />
            <KpiCard
              icon="check-circle-2"
              label="启用中"
              value={kpis.active}
              hint={
                kpis.total > 0 && kpis.active === kpis.total
                  ? "全部启用"
                  : `${kpis.total - kpis.active} 个已停用`
              }
              tone={kpis.total > 0 && kpis.active === kpis.total ? "success" : "neutral"}
            />
            <KpiCard
              icon="arrow-down"
              label="入站已接"
              value={kpis.inbound}
              hint={kpis.inbound === 0 ? "无双向渠道" : "可接收用户回复"}
            />
            <KpiCard
              icon="shield-check"
              label="自动批准"
              value={kpis.autoApprove}
              hint={kpis.autoApprove === 0 ? "全走 Gate" : "跳过 ConfirmationGate"}
              tone={kpis.autoApprove > 0 ? "warning" : "neutral"}
            />
          </div>

          {/* Tabs */}
          <div role="tablist" className="flex items-center gap-1 border-b border-border">
            {(
              [
                ["registered", "已注册", "list"],
                ["add", "注册新渠道", "plus"],
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
                {key === "registered" && channels.length > 0 && (
                  <span className="font-mono text-[10px] text-text-subtle">
                    · {channels.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === "registered" && status === "loading" && (
            <div data-testid="channels-loading">
              <ChannelsSkeleton />
            </div>
          )}

          {tab === "registered" && status === "error" && (
            <div
              data-testid="channels-error"
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger-soft p-4"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger shrink-0">
                <Icon name="alert-circle" size={16} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-danger">加载渠道失败</p>
                <p className="mt-0.5 text-xs text-text-muted font-mono truncate">{error}</p>
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

          {tab === "registered" && status === "ready" && channels.length === 0 && (
            <EmptyChannels onAdd={() => setTab("add")} />
          )}

          {tab === "registered" && status === "ready" && channels.length > 0 && (
            <ChannelsList
              channels={channels}
              testingId={testingId}
              testResult={testResult}
              onTest={(c) => void handleTest(c)}
              onDelete={(c) => setDeleteTarget(c)}
            />
          )}

          {tab === "add" && (
            <CreateForm
              onCreated={async () => {
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
        title="删除渠道?"
        message={
          deleteTarget
            ? `该操作不可撤销。渠道 ${deleteTarget.display_name} 的订阅和消息审计都会被级联删除。`
            : ""
        }
        confirmLabel={deleting ? "删除中…" : "删除"}
        cancelLabel="取消"
        danger
        busy={deleting}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteTarget(null)}
      />
    </AppShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Summary KPIs
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

function buildKpis(channels: Channel[]) {
  const total = channels.length;
  const active = channels.filter((c) => c.enabled).length;
  const inbound = channels.filter((c) => c.inbound_enabled).length;
  const autoApprove = channels.filter((c) => c.auto_approve_outbound).length;
  return { total, active, inbound, autoApprove };
}

// ────────────────────────────────────────────────────────────────────────────
// Channel card target summary
// ────────────────────────────────────────────────────────────────────────────

function targetSummary(ch: Channel): string {
  const cfg = ch.config as Record<string, unknown>;
  const str = (k: string): string =>
    typeof cfg[k] === "string" ? (cfg[k] as string) : "";
  switch (ch.kind) {
    case "telegram": {
      const chat = str("chat_id");
      return chat ? `chat_id=${chat}` : "未配置 chat_id";
    }
    case "bark": {
      const key = str("device_key");
      return key ? `device=${maskTail(key)}` : "未配置 device_key";
    }
    case "email": {
      const to = str("to_addr");
      const host = str("smtp_host");
      if (to) return `→ ${to}`;
      return host ? `smtp=${host}` : "未配置 SMTP";
    }
    case "feishu": {
      const url = str("webhook_url");
      return url ? url : "未配置 webhook_url";
    }
    case "wecom": {
      const corp = str("corp_id");
      const agent = str("agent_id");
      if (corp) return `corp=${corp}${agent ? ` · agent=${agent}` : ""}`;
      return "未配置 corp_id";
    }
    case "pushdeer": {
      const key = str("push_key");
      return key ? `push_key=${maskTail(key)}` : "未配置 push_key";
    }
    default:
      return JSON.stringify(ch.config);
  }
}

function maskTail(v: string): string {
  if (v.length <= 6) return "***";
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Registered list + card
// ────────────────────────────────────────────────────────────────────────────

function ChannelsList({
  channels,
  testingId,
  testResult,
  onTest,
  onDelete,
}: {
  channels: Channel[];
  testingId: string;
  testResult: Record<string, TestOutcome>;
  onTest: (c: Channel) => void;
  onDelete: (c: Channel) => void;
}) {
  // Feature the first enabled channel; fall back to first in list.
  const featuredId = (channels.find((c) => c.enabled) ?? channels[0])?.id;
  return (
    <ul
      data-testid="channels-list"
      className="grid grid-cols-1 xl:grid-cols-2 gap-4 list-none p-0 m-0"
    >
      {channels.map((ch) => (
        <li key={ch.id}>
          <ChannelCard
            channel={ch}
            featured={ch.id === featuredId}
            testing={testingId === ch.id}
            testOutcome={testResult[ch.id]}
            onTest={onTest}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}

function ChannelCard({
  channel,
  featured,
  testing,
  testOutcome,
  onTest,
  onDelete,
}: {
  channel: Channel;
  featured: boolean;
  testing: boolean;
  testOutcome: TestOutcome | undefined;
  onTest: (c: Channel) => void;
  onDelete: (c: Channel) => void;
}) {
  const cardClass = featured
    ? "group relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 via-surface to-surface shadow-soft-lg hover:shadow-soft-lg hover:-translate-y-px transition duration-base"
    : "group relative overflow-hidden rounded-xl border border-border bg-surface shadow-soft-sm hover:border-border-strong hover:shadow-soft hover:-translate-y-px transition duration-base";

  const statusChip = channel.enabled
    ? "text-success border-success/30 bg-success-soft"
    : "text-text-muted border-border bg-surface-2";
  const statusDot = channel.enabled ? "bg-success" : "bg-text-subtle";
  const statusLabel = channel.enabled ? "启用" : "停用";

  return (
    <div data-testid={`channel-${channel.id}`} className={cardClass}>
      <div className="p-5">
        <div className="flex items-start gap-3">
          {/* Kind tile */}
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
            <Icon name={KIND_ICON[channel.kind]} size={18} />
          </div>

          {/* Name + meta chips */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href={`/channels/${channel.id}`}
                className="text-[15px] font-semibold tracking-tight text-text hover:text-primary transition-colors duration-fast truncate"
              >
                {channel.display_name}
              </Link>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border bg-surface-2 text-text-muted text-[10px] font-mono">
                {KIND_LABEL[channel.kind]}
              </span>
              <span
                className={`inline-flex items-center gap-1 h-5 px-2 rounded-full border text-[10px] font-medium ${statusChip}`}
                aria-label={statusLabel}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot}`} />
                {statusLabel}
              </span>
              {channel.inbound_enabled && (
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border bg-surface-2 text-text-muted text-[10px] font-medium">
                  <Icon name="arrow-down" size={10} className="text-text-subtle" />
                  in
                </span>
              )}
              {channel.outbound_enabled && (
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-border bg-surface-2 text-text-muted text-[10px] font-medium">
                  <Icon name="arrow-up" size={10} className="text-text-subtle" />
                  out
                </span>
              )}
              {channel.auto_approve_outbound && (
                <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-warning/30 bg-warning-soft text-warning text-[10px] font-medium">
                  <Icon name="shield-check" size={10} />
                  自动批准
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Target mono row */}
        <div className="mt-3 rounded-lg border border-border bg-bg px-3 py-2 min-w-0">
          <p className="text-[11px] font-mono text-text-muted truncate">
            {targetSummary(channel)}
          </p>
        </div>

        {/* Footer — last test + actions */}
        <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t border-border">
          <span className="inline-flex items-center gap-1.5 text-[11px] min-w-0">
            {testOutcome ? (
              testOutcome.ok ? (
                <>
                  <Icon name="check-circle-2" size={11} className="text-success" />
                  <span className="text-success font-mono tabular-nums">
                    ok · {testOutcome.latency_ms}ms
                  </span>
                </>
              ) : (
                <>
                  <Icon name="alert-circle" size={11} className="text-danger" />
                  <span className="text-danger font-mono truncate">
                    fail · {testOutcome.detail || "错误"}
                  </span>
                </>
              )
            ) : (
              <>
                <Icon name="clock" size={11} className="text-text-subtle" />
                <span className="text-text-subtle">尚未测试</span>
              </>
            )}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onTest(channel)}
              disabled={testing}
              data-testid={`test-${channel.id}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-text hover:border-primary hover:text-primary disabled:opacity-40 transition duration-base"
            >
              {testing ? (
                <>
                  <Icon name="loader" size={11} className="animate-spin-slow" />
                  测试中
                </>
              ) : (
                <>
                  <Icon name="send" size={11} />
                  测试
                </>
              )}
            </button>
            <Link
              href={`/channels/${channel.id}`}
              data-testid={`edit-${channel.id}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-text hover:border-border-strong transition duration-base"
            >
              <Icon name="edit" size={11} />
              编辑
            </Link>
            <button
              type="button"
              onClick={() => onDelete(channel)}
              data-testid={`delete-${channel.id}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-danger hover:border-danger/40 hover:bg-danger-soft transition duration-base"
            >
              <Icon name="trash-2" size={11} />
              删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Skeleton + empty
// ────────────────────────────────────────────────────────────────────────────

function ChannelsSkeleton() {
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

function EmptyChannels({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      data-testid="channels-empty"
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
          <Icon name="bell" size={36} strokeWidth={1.5} />
        </div>
        <h3 className="mt-6 text-display font-bold tracking-tight text-text">
          Connect your first channel
        </h3>
        <p className="mt-2 max-w-md text-[13px] leading-relaxed text-text-muted">
          注册一个通知出口,任何 skill / trigger / agent 调用{" "}
          <span className="font-mono text-text">send_notification</span> 就能触达你。或在对话里让
          Lead Agent 用 <span className="font-mono text-text">register_channel</span> 代办。
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onAdd}
            data-testid="empty-add-channel"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary text-primary-fg text-[13px] font-semibold shadow-soft hover:bg-primary-hover hover:-translate-y-px transition duration-base"
          >
            <Icon name="plus" size={14} />
            注册渠道
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
          {KINDS.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-surface-2 border border-border text-text-muted font-mono font-medium"
            >
              <Icon name={KIND_ICON[k]} size={10} className="text-text-subtle" />
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Create form — sectioned · kind radio cards · kind-specific fields
// ────────────────────────────────────────────────────────────────────────────

function CreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft("telegram"));
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestOutcome | null>(null);
  const [err, setErr] = useState("");

  function setKind(kind: ChannelKind) {
    setDraft(emptyDraft(kind));
    setTestResult(null);
    setErr("");
  }

  async function handleSubmit() {
    setErr("");
    if (!draft.display_name.trim()) {
      setErr("请填 display_name");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          display_name: draft.display_name,
          config: draft.config,
          inbound_enabled: draft.inbound_enabled,
          outbound_enabled: draft.outbound_enabled,
          auto_approve_outbound: draft.auto_approve_outbound,
          webhook_secret: draft.webhook_secret || null,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }
      await onCreated();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestDelivery() {
    setErr("");
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/channels/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: draft.kind,
          config: draft.config,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<TestOutcome>;
      if (!res.ok) {
        throw new Error(data.detail || `HTTP ${res.status}`);
      }
      setTestResult({
        ok: Boolean(data.ok),
        detail: data.detail ?? "",
        latency_ms: data.latency_ms ?? 0,
      });
    } catch (e) {
      setTestResult({ ok: false, detail: String(e), latency_ms: 0 });
    } finally {
      setTesting(false);
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
          <Icon name="bell" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-text leading-tight">
            注册新渠道
          </h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            选择 kind · 填写连接参数 · 建议先「测试投递」再提交
          </p>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5">
        {/* Section 1 · Kind radio cards */}
        <Section icon="layout-grid" title="Kind">
          <div
            role="radiogroup"
            aria-label="渠道 kind"
            data-testid="kind-select"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
          >
            {KINDS.map((k) => {
              const active = draft.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`kind-${k}`}
                  onClick={() => setKind(k)}
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
                      <Icon name={KIND_ICON[k]} size={13} />
                    </span>
                    <span
                      className={`text-[12px] font-semibold ${
                        active ? "text-primary" : "text-text"
                      }`}
                    >
                      {KIND_LABEL[k]}
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
                    className={`mt-1.5 text-[11px] leading-snug font-mono ${
                      active ? "text-primary/80" : "text-text-muted"
                    }`}
                  >
                    {KIND_HINT[k]}
                  </p>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Section 2 · Basics */}
        <Section icon="info" title="基础信息">
          <Field
            label="显示名称"
            value={draft.display_name}
            onChange={(v) => setDraft((d) => ({ ...d, display_name: v }))}
            placeholder="例如:我的 Telegram Bot"
            testid="field-display-name"
          />
        </Section>

        {/* Section 3 · Kind-specific config */}
        <Section icon="settings" title={`${KIND_LABEL[draft.kind]} · 配置`}>
          <div className="flex flex-col gap-3">
            {KIND_CONFIG_FIELDS[draft.kind].map((field) => (
              <Field
                key={field}
                label={`config.${field}`}
                mono
                value={draft.config[field] ?? ""}
                onChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    config: { ...d.config, [field]: v },
                  }))
                }
                testid={`field-${field}`}
              />
            ))}
            <Field
              label="webhook_secret (可选)"
              mono
              value={draft.webhook_secret}
              onChange={(v) => setDraft((d) => ({ ...d, webhook_secret: v }))}
              testid="field-webhook-secret"
            />
          </div>
        </Section>

        {/* Section 4 · Toggles */}
        <Section icon="shield-check" title="路由与策略">
          <div className="flex flex-col gap-2">
            <ToggleRow
              label="接收入站消息 (inbound)"
              hint="用户可从此渠道回复 · 仅 Telegram 在 v0 生效"
              checked={draft.inbound_enabled}
              onChange={(v) => setDraft((d) => ({ ...d, inbound_enabled: v }))}
              testid="toggle-inbound"
            />
            <ToggleRow
              label="允许出站 (outbound)"
              hint="关闭则 send_notification 会报错"
              checked={draft.outbound_enabled}
              onChange={(v) => setDraft((d) => ({ ...d, outbound_enabled: v }))}
              testid="toggle-outbound"
            />
            <ToggleRow
              label="自动批准出站"
              hint="跳过 ConfirmationGate · 仅限低风险渠道"
              checked={draft.auto_approve_outbound}
              onChange={(v) =>
                setDraft((d) => ({ ...d, auto_approve_outbound: v }))
              }
              testid="toggle-auto-approve"
              warn
            />
          </div>
        </Section>

        {/* Inline test result */}
        {testResult && (
          <div
            data-testid="form-test-result"
            role="status"
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${
              testResult.ok
                ? "border-success/40 bg-success-soft text-success"
                : "border-danger/40 bg-danger-soft text-danger"
            }`}
          >
            <Icon
              name={testResult.ok ? "check-circle-2" : "alert-circle"}
              size={13}
              className="mt-0.5 shrink-0"
            />
            <span className="font-mono min-w-0 break-words">
              {testResult.ok
                ? `投递成功 · ${testResult.latency_ms}ms`
                : `投递失败 · ${testResult.detail || "unknown"}`}
            </span>
          </div>
        )}

        {err && (
          <div
            data-testid="form-error"
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
            onClick={() => void handleTestDelivery()}
            disabled={testing || submitting}
            data-testid="form-test"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] font-medium text-text hover:border-primary hover:text-primary disabled:opacity-40 transition duration-base"
          >
            {testing ? (
              <>
                <Icon name="loader" size={13} className="animate-spin-slow" />
                投递中
              </>
            ) : (
              <>
                <Icon name="send" size={13} />
                测试投递
              </>
            )}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[12px] font-medium text-text-muted hover:text-text hover:border-border-strong disabled:opacity-40 transition duration-base"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !draft.display_name}
              data-testid="form-submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-fg shadow-soft hover:bg-primary-hover hover:-translate-y-px disabled:opacity-40 disabled:hover:translate-y-0 transition duration-base"
            >
              {submitting ? (
                <>
                  <Icon name="loader" size={13} className="animate-spin-slow" />
                  创建中
                </>
              ) : (
                <>
                  <Icon name="plus" size={13} />
                  创建渠道
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Form primitives
// ────────────────────────────────────────────────────────────────────────────

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  testid?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-text-muted block mb-1">{label}</span>
      <input
        data-testid={testid}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg bg-bg border border-border py-2 px-3 text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:border-primary focus:shadow-glow-sm transition duration-base ${
          mono ? "font-mono" : ""
        }`}
      />
    </label>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  testid,
  warn = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testid?: string;
  warn?: boolean;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 rounded-lg border p-3 cursor-pointer transition duration-base ${
        checked
          ? warn
            ? "border-warning/40 bg-warning-soft"
            : "border-primary/40 bg-primary/5"
          : "border-border bg-surface hover:border-border-strong"
      }`}
    >
      <div className="min-w-0">
        <div
          className={`text-[12px] font-medium ${
            checked && warn ? "text-warning" : "text-text"
          }`}
        >
          {label}
        </div>
        {hint && (
          <div className="mt-0.5 text-[11px] text-text-muted leading-snug">{hint}</div>
        )}
      </div>
      <input
        data-testid={testid}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-primary shrink-0"
      />
    </label>
  );
}
