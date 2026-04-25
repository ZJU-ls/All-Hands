"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, use } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, LoadingState } from "@/components/state";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * Channel detail page · ADR 0016 V2 Azure Live polish.
 *
 * Breadcrumb · gradient hero (kind-specific tile · direction chips · enable
 * state) · sectioned body for config / subscriptions (add-form + list) /
 * message timeline with in/out direction coloring + status chips. All fetch /
 * mutation / navigation preserved verbatim.
 */

type ChannelKind =
  | "telegram"
  | "bark"
  | "wecom"
  | "feishu"
  | "email"
  | "pushdeer";

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
};

type Subscription = {
  id: string;
  channel_id: string;
  topic: string;
  filter: Record<string, unknown> | null;
  enabled: boolean;
  created_at: string;
};

type Message = {
  id: string;
  channel_id: string;
  direction: "in" | "out";
  topic: string | null;
  payload: Record<string, unknown>;
  conversation_id: string | null;
  external_id: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

const KIND_ICON: Record<ChannelKind, IconName> = {
  telegram: "send",
  bark: "bell",
  wecom: "message-square",
  feishu: "message-square",
  email: "mail",
  pushdeer: "zap",
};

export default function ChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = useTranslations("channels.detail");
  const tKindLabel = useTranslations("channels.detail.kindLabel");
  const { id } = use(params);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [newFilter, setNewFilter] = useState("");
  const [addingSub, setAddingSub] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [c, s, m] = await Promise.all([
        fetch(`/api/channels/${id}`).then((r) => {
          if (!r.ok) throw new Error(`channel ${r.status}`);
          return r.json() as Promise<Channel>;
        }),
        fetch(`/api/channels/${id}/subscriptions`).then((r) => {
          if (!r.ok) throw new Error(`subs ${r.status}`);
          return r.json() as Promise<Subscription[]>;
        }),
        fetch(`/api/channels/${id}/messages?limit=50`).then((r) => {
          if (!r.ok) throw new Error(`messages ${r.status}`);
          return r.json() as Promise<Message[]>;
        }),
      ]);
      setChannel(c);
      setSubs(s);
      setMessages(m);
      setStatus("ready");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddSub() {
    if (!newTopic.trim()) return;
    setAddingSub(true);
    try {
      let filter: Record<string, unknown> | null = null;
      if (newFilter.trim()) {
        try {
          filter = JSON.parse(newFilter) as Record<string, unknown>;
        } catch {
          setError(t("filterInvalid"));
          setAddingSub(false);
          return;
        }
      }
      await fetch(`/api/channels/${id}/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: newTopic, filter }),
      });
      setNewTopic("");
      setNewFilter("");
      await load();
    } finally {
      setAddingSub(false);
    }
  }

  async function handleDeleteSub(subId: string) {
    await fetch(`/api/channels/subscriptions/${subId}`, { method: "DELETE" });
    await load();
  }

  return (
    <AppShell title={channel ? channel.display_name : t("fallbackTitle")}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          <Breadcrumb name={channel?.display_name} />

          {status === "loading" && <LoadingState title={t("loading")} />}

          {status === "error" && (
            <div className="rounded-xl border border-danger/30 bg-danger-soft p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-danger/15 text-danger shrink-0">
                  <Icon name="alert-circle" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-danger mb-1">
                    {t("loadFailed")}
                  </p>
                  <p className="text-xs font-mono text-text-muted break-all">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {status === "ready" && channel && (
            <>
              <Hero channel={channel} />

              <Section title={t("sectionInfo")} icon="info">
                <MetaGrid
                  items={[
                    { k: t("metaId"), v: channel.id, mono: true },
                    { k: t("metaKind"), v: tKindLabel(channel.kind), mono: true },
                    {
                      k: t("metaInbound"),
                      v: (
                        <DirectionTag
                          enabled={channel.inbound_enabled}
                          direction="in"
                        />
                      ),
                    },
                    {
                      k: t("metaOutbound"),
                      v: (
                        <DirectionTag
                          enabled={channel.outbound_enabled}
                          direction="out"
                        />
                      ),
                    },
                    {
                      k: t("metaAutoApprove"),
                      v: channel.auto_approve_outbound ? (
                        <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-warning/30 bg-warning-soft text-warning text-caption font-mono font-medium">
                          <Icon
                            name="shield-check"
                            size={10}
                            strokeWidth={2.25}
                          />
                          {t("autoApproveSkip")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
                          <Icon name="lock" size={10} strokeWidth={2.25} />
                          {t("autoApproveNo")}
                        </span>
                      ),
                    },
                    {
                      k: t("metaWebhookUrl"),
                      v: `/api/channels/${channel.id}/webhook`,
                      mono: true,
                    },
                    {
                      k: t("metaCreatedAt"),
                      v: new Date(channel.created_at).toLocaleString(),
                      mono: true,
                    },
                  ]}
                />
              </Section>

              <Section
                title={t("sectionSubs", { count: subs.length })}
                icon="bell"
                subtitle={t("sectionSubsSubtitle")}
              >
                <div className="flex flex-col gap-2">
                  {subs.length === 0 && (
                    <p className="text-sm text-text-muted leading-relaxed">
                      {t("noSubs")}
                    </p>
                  )}
                  {subs.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[12px] text-text font-semibold truncate">
                          {s.topic}
                        </p>
                        {s.filter && (
                          <p className="font-mono text-caption text-text-subtle truncate mt-0.5">
                            {t("filterPrefix")} {JSON.stringify(s.filter)}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteSub(s.id)}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-caption font-medium text-danger hover:bg-danger-soft transition duration-base shrink-0"
                      >
                        <Icon name="trash-2" size={11} />
                        {t("remove")}
                      </button>
                    </div>
                  ))}
                  <div className="pt-3 mt-2 border-t border-border flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      placeholder={t("topicPlaceholder")}
                      className="flex-1 rounded-lg bg-surface border border-border px-3 py-2 text-sm font-mono text-text placeholder-text-subtle focus:outline-none focus:border-primary shadow-soft-sm transition duration-base"
                    />
                    <input
                      type="text"
                      value={newFilter}
                      onChange={(e) => setNewFilter(e.target.value)}
                      placeholder={t("filterPlaceholder")}
                      className="flex-1 rounded-lg bg-surface border border-border px-3 py-2 text-sm font-mono text-text placeholder-text-subtle focus:outline-none focus:border-primary shadow-soft-sm transition duration-base"
                    />
                    <button
                      onClick={handleAddSub}
                      disabled={addingSub}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-primary text-primary-fg text-[12px] font-semibold shadow-soft-sm hover:bg-primary-hover disabled:opacity-40 transition duration-base shrink-0"
                    >
                      {addingSub ? (
                        <>
                          <Icon
                            name="loader"
                            size={12}
                            className="animate-spin-slow"
                          />
                          {t("addingSub")}
                        </>
                      ) : (
                        <>
                          <Icon name="plus" size={12} />
                          {t("addSub")}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </Section>

              <Section
                title={t("sectionMessages")}
                icon="message-square"
                subtitle={t("sectionMessagesSubtitle")}
              >
                <div className="flex flex-col gap-2">
                  {messages.length === 0 && <EmptyState title={t("noMessages")} />}
                  {messages.map((m) => (
                    <MessageRow key={m.id} m={m} />
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Breadcrumb({ name }: { name?: string }) {
  const t = useTranslations("channels.detail");
  return (
    <div className="flex items-center gap-1.5 font-mono text-caption uppercase tracking-wider text-text-subtle">
      <Link
        href="/channels"
        className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-text-muted hover:text-primary hover:bg-primary-muted transition duration-base"
      >
        <Icon name="arrow-left" size={11} strokeWidth={2} />
        {t("breadcrumb")}
      </Link>
      <Icon name="chevron-right" size={11} className="text-text-subtle" />
      <span className="text-text truncate max-w-[30ch]">{name ?? "…"}</span>
    </div>
  );
}

function Hero({ channel }: { channel: Channel }) {
  const t = useTranslations("channels.detail");
  const tKindLabel = useTranslations("channels.detail.kindLabel");
  const icon = KIND_ICON[channel.kind];
  const enabledDot = channel.enabled ? "bg-success" : "bg-text-subtle";
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
      <div className="flex items-start gap-4 flex-wrap min-w-0">
        <div
          className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name={icon} size={26} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className={`inline-block h-2 w-2 rounded-full ${enabledDot}`}
              aria-hidden="true"
            />
            <h1 className="text-xl font-bold tracking-tight text-text truncate">
              {channel.display_name}
            </h1>
            <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border bg-surface-2 text-text-muted text-caption font-mono">
              <Icon name={icon} size={10} strokeWidth={2.25} />
              {tKindLabel(channel.kind)}
            </span>
            <DirectionTag
              enabled={channel.inbound_enabled}
              direction="in"
              compact
            />
            <DirectionTag
              enabled={channel.outbound_enabled}
              direction="out"
              compact
            />
            {channel.auto_approve_outbound && (
              <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-warning/30 bg-warning-soft text-warning text-caption font-mono font-medium">
                <Icon name="shield-check" size={10} strokeWidth={2.25} />
                {t("autoApproveBadge")}
              </span>
            )}
          </div>
          <p className="font-mono text-caption text-text-subtle truncate">
            {channel.id}
          </p>
        </div>
      </div>
    </div>
  );
}

function DirectionTag({
  enabled,
  direction,
  compact = false,
}: {
  enabled: boolean;
  direction: "in" | "out";
  compact?: boolean;
}) {
  const icon: IconName =
    direction === "in"
      ? enabled
        ? "arrow-down"
        : "x"
      : enabled
        ? "arrow-up"
        : "x";
  const cls = enabled
    ? direction === "in"
      ? "text-role-user border-role-user/30 bg-role-user/10"
      : "text-role-lead border-role-lead/30 bg-role-lead/10"
    : "text-text-subtle border-border bg-surface-2";
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-caption font-mono font-medium ${cls}`}
    >
      <Icon name={icon} size={10} strokeWidth={2.25} />
      {compact
        ? direction
        : direction === "in"
          ? enabled
            ? "← in"
            : "✕ in"
          : enabled
            ? "→ out"
            : "✕ out"}
    </span>
  );
}

function Section({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string;
  icon: IconName;
  subtitle?: string;
  children: React.ReactNode;
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
      <header className="flex items-center gap-3 mb-4">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-muted text-primary">
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {subtitle && (
            <p className="font-mono text-caption text-text-subtle mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
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

function MessageRow({ m }: { m: Message }) {
  const dirMeta =
    m.direction === "in"
      ? {
          icon: "arrow-down" as IconName,
          cls: "text-role-user border-role-user/30 bg-role-user/10",
          label: "← in",
        }
      : {
          icon: "arrow-up" as IconName,
          cls: "text-role-lead border-role-lead/30 bg-role-lead/10",
          label: "→ out",
        };
  const statusMeta = messageStatusMeta(m.status);
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 hover:border-border-strong transition duration-base">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span
          className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border font-mono text-caption font-medium ${dirMeta.cls}`}
        >
          <Icon name={dirMeta.icon} size={10} strokeWidth={2.25} />
          {dirMeta.label}
        </span>
        {m.topic && (
          <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-surface border border-border font-mono text-caption text-text-muted">
            {m.topic}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border font-mono text-caption font-medium ${statusMeta.chip}`}
        >
          <Icon name={statusMeta.icon} size={10} strokeWidth={2.25} />
          {m.status}
        </span>
        <span className="ml-auto font-mono text-caption text-text-subtle">
          {new Date(m.created_at).toLocaleTimeString()}
        </span>
      </div>
      <pre className="text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all leading-relaxed">
        {JSON.stringify(m.payload, null, 0).slice(0, 400)}
      </pre>
      {m.error_message && (
        <p className="font-mono text-caption text-danger mt-1">
          {m.error_message}
        </p>
      )}
    </div>
  );
}

function messageStatusMeta(status: string): { icon: IconName; chip: string } {
  if (status === "delivered" || status === "received") {
    return {
      icon: "check-circle-2",
      chip: "text-success border-success/30 bg-success-soft",
    };
  }
  if (status === "failed") {
    return {
      icon: "alert-circle",
      chip: "text-danger border-danger/30 bg-danger-soft",
    };
  }
  return {
    icon: "clock",
    chip: "text-text-muted border-border bg-surface",
  };
}
