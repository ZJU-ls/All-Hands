"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { use } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState, LoadingState } from "@/components/state";

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

export default function ChannelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
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
          setError("filter 不是合法 JSON");
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
    <AppShell
      title={channel ? channel.display_name : "渠道详情"}
      actions={
        <Link
          href="/channels"
          className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-border-strong transition-colors duration-base"
        >
          ← 返回列表
        </Link>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8 space-y-8">
          {status === "loading" && <LoadingState title="加载渠道" />}
          {status === "error" && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-6">
              <p className="text-sm text-danger mb-2">加载失败</p>
              <p className="text-xs font-mono text-text-muted">{error}</p>
            </div>
          )}
          {status === "ready" && channel && (
            <>
              <Card title="基本信息">
                <KVRow k="ID" v={channel.id} mono />
                <KVRow k="Kind" v={channel.kind} />
                <KVRow
                  k="Inbound / Outbound"
                  v={`${channel.inbound_enabled ? "← in" : "✕ in"}  /  ${
                    channel.outbound_enabled ? "→ out" : "✕ out"
                  }`}
                />
                <KVRow
                  k="自动批准出站"
                  v={channel.auto_approve_outbound ? "是 (跳过 Gate)" : "否"}
                />
                <KVRow
                  k="Webhook URL"
                  v={`/api/channels/${channel.id}/webhook`}
                  mono
                />
                <KVRow k="创建时间" v={new Date(channel.created_at).toLocaleString()} />
              </Card>

              <Card
                title="订阅"
                subtitle={`按 topic 接收 · ${subs.length} 条订阅`}
              >
                <div className="space-y-2">
                  {subs.length === 0 && (
                    <p className="text-xs text-text-subtle">无订阅 · 渠道不会接收按 topic 广播的通知</p>
                  )}
                  {subs.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-text">{s.topic}</p>
                        {s.filter && (
                          <p className="text-[11px] text-text-subtle font-mono truncate">
                            filter: {JSON.stringify(s.filter)}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteSub(s.id)}
                        className="text-[11px] text-danger hover:underline"
                      >
                        移除
                      </button>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-border flex gap-2">
                    <input
                      type="text"
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      placeholder="topic 例如 stock.anomaly"
                      className="flex-1 px-3 py-1.5 text-xs bg-surface border border-border rounded-md font-mono focus:border-primary focus:outline-none transition-colors duration-base"
                    />
                    <input
                      type="text"
                      value={newFilter}
                      onChange={(e) => setNewFilter(e.target.value)}
                      placeholder='filter JSON 可选 {"severity": ["P0"]}'
                      className="flex-1 px-3 py-1.5 text-xs bg-surface border border-border rounded-md font-mono focus:border-primary focus:outline-none transition-colors duration-base"
                    />
                    <button
                      onClick={handleAddSub}
                      disabled={addingSub}
                      className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-fg hover:bg-primary-hover transition-colors duration-base disabled:opacity-50"
                    >
                      {addingSub ? "…" : "+ 添加"}
                    </button>
                  </div>
                </div>
              </Card>

              <Card title="近 50 条消息" subtitle="新→旧 · 入/出混合">
                <div className="space-y-2">
                  {messages.length === 0 && (
                    <EmptyState title="暂无消息" />
                  )}
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className="border-b border-border last:border-b-0 py-2"
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                            m.direction === "in"
                              ? "bg-role-user/10 text-role-user"
                              : "bg-role-lead/10 text-role-lead"
                          }`}
                        >
                          {m.direction === "in" ? "← in" : "→ out"}
                        </span>
                        {m.topic && (
                          <span className="text-[11px] font-mono text-text-muted">
                            {m.topic}
                          </span>
                        )}
                        <span
                          className={`text-[11px] font-mono ${
                            m.status === "delivered" || m.status === "received"
                              ? "text-success"
                              : m.status === "failed"
                                ? "text-danger"
                                : "text-text-muted"
                          }`}
                        >
                          {m.status}
                        </span>
                        <span className="text-[11px] text-text-subtle ml-auto">
                          {new Date(m.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <pre className="text-[11px] font-mono text-text-muted whitespace-pre-wrap break-all">
                        {JSON.stringify(m.payload, null, 0).slice(0, 400)}
                      </pre>
                      {m.error_message && (
                        <p className="text-[11px] text-danger font-mono mt-0.5">
                          {m.error_message}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-text">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function KVRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-4 py-1">
      <span className="text-xs text-text-muted w-36 shrink-0">{k}</span>
      <span className={`text-xs text-text break-all ${mono ? "font-mono" : ""}`}>
        {v}
      </span>
    </div>
  );
}
