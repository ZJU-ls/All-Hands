"use client";

/**
 * WorkspacePreview · /welcome hero animation.
 *
 * A miniature browser-chrome window that auto-cycles through 4 scenes —
 * chat · skills · gateway · traces — so a first-time visitor sees what
 * the platform actually looks like, not just a copy pitch. Sidebar items
 * are clickable; clicking jumps to that scene and pauses auto-rotation
 * for ~12s so users can read.
 *
 * Animation: pure CSS opacity crossfade keyed on `activeId`. No motion
 * library (§3.8 #5).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { AllhandsLogo, type LogoConcept } from "@/components/brand/AllhandsLogo";
import { cn } from "@/lib/cn";

type SceneId = "chat" | "skills" | "gateway" | "traces";

const SIDEBAR: Array<{ id: SceneId; label: string; icon: IconName }> = [
  { id: "chat", label: "对话", icon: "message-square" },
  { id: "skills", label: "Skills", icon: "wand-2" },
  { id: "gateway", label: "Gateway", icon: "plug" },
  { id: "traces", label: "Traces", icon: "activity" },
];

const ROTATE_MS = 4500;
const PAUSE_MS = 12000;

export function WorkspacePreview({
  logoConcept = "constellation",
}: {
  logoConcept?: LogoConcept;
}) {
  const [activeId, setActiveId] = useState<SceneId>("chat");
  const [paused, setPaused] = useState(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-rotate · skips when paused (hovered, or recently clicked).
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => {
      setActiveId((cur) => {
        const idx = SIDEBAR.findIndex((s) => s.id === cur);
        const next = SIDEBAR[(idx + 1) % SIDEBAR.length];
        return next ? next.id : cur;
      });
    }, ROTATE_MS);
    return () => clearTimeout(timer);
  }, [activeId, paused]);

  function handleClick(id: SceneId) {
    setActiveId(id);
    setPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => setPaused(false), PAUSE_MS);
  }

  // Cleanup pause timer on unmount.
  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        // Don't clear a click-pause that's still running.
        if (!pauseTimerRef.current) setPaused(false);
      }}
    >
      {/* Browser chrome */}
      <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-2/60 px-4 backdrop-blur-md">
        <span className="h-3 w-3 rounded-full bg-danger/70" />
        <span className="h-3 w-3 rounded-full bg-warning/70" />
        <span className="h-3 w-3 rounded-full bg-success/70" />
        <span className="ml-3 text-caption font-mono text-text-muted">
          allhands.local / {activeId}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-caption text-text-subtle">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full",
              paused ? "bg-text-subtle" : "bg-primary animate-pulse-soft",
            )}
          />
          {paused ? "已暂停" : "自动演示中"}
        </span>
      </div>

      <div className="grid grid-cols-12">
        {/* Sidebar · clickable items, cycle highlight follows activeId */}
        <aside className="col-span-3 space-y-1 border-r border-border bg-surface-2/40 p-4">
          {SIDEBAR.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleClick(item.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-base",
                  active
                    ? "bg-primary text-primary-fg shadow-soft-sm"
                    : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon name={item.icon} size={14} />
                <span className="text-sm font-medium">{item.label}</span>
                {active ? (
                  <Icon
                    name="arrow-right"
                    size={12}
                    className="ml-auto opacity-80"
                  />
                ) : null}
              </button>
            );
          })}
        </aside>

        {/* Stage · all scenes layered, only active is fully opaque */}
        <div className="relative col-span-9 min-h-[280px] p-6">
          <Scene visible={activeId === "chat"}>
            <ChatScene logoConcept={logoConcept} />
          </Scene>
          <Scene visible={activeId === "skills"}>
            <SkillsScene />
          </Scene>
          <Scene visible={activeId === "gateway"}>
            <GatewayScene />
          </Scene>
          <Scene visible={activeId === "traces"}>
            <TracesScene />
          </Scene>
        </div>
      </div>
    </div>
  );
}

function Scene({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "absolute inset-0 p-6 transition-opacity duration-mid",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {children}
    </div>
  );
}

// ───────────────────────── Scenes ─────────────────────────

function ChatScene({ logoConcept }: { logoConcept: LogoConcept }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AllhandsLogo size={26} concept={logoConcept} />
          <h3 className="text-base font-semibold tracking-tight text-text">
            Lead Agent
          </h3>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-caption font-mono text-text-subtle">
            gpt-4o-mini
          </span>
        </div>
        <StatusPill />
      </div>

      <div className="flex justify-end">
        <div className="max-w-md rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-fg shadow-soft-sm">
          帮我招一个研究员,每天读 5 篇 Hacker News 头条。
        </div>
      </div>

      <div className="flex justify-start">
        <div className="max-w-xl space-y-2 rounded-2xl rounded-bl-sm border border-border bg-surface-2/70 px-4 py-3 text-sm text-text shadow-soft-sm">
          <p>
            已为你创建员工{" "}
            <span className="font-mono font-medium text-primary">hn-researcher</span>
            ,挂上了 fetch_url + summarize 两个 Tool。
          </p>
          <ToolRow tool="create_employee" duration="320ms" />
        </div>
      </div>
    </div>
  );
}

function SkillsScene() {
  const SKILLS: Array<{
    name: string;
    desc: string;
    state: "installed" | "installing" | "available";
  }> = [
    {
      name: "skill:web-fetch",
      desc: "抓任意 URL → 文本/JSON · scope=READ",
      state: "installed",
    },
    {
      name: "skill:hn-digest",
      desc: "Hacker News 头条 · 拉 + 摘要 · 适合研究员",
      state: "installing",
    },
    {
      name: "skill:slack-notify",
      desc: "推送到 Slack channel · scope=WRITE · 需 confirm",
      state: "available",
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight text-text">
          Skills · 能力包
        </h3>
        <span className="text-caption font-mono text-text-subtle">3 / 24</span>
      </div>
      <ul className="space-y-2">
        {SKILLS.map((s) => (
          <li
            key={s.name}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-3"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted text-primary">
              <Icon name="wand-2" size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-medium text-text">
                  {s.name}
                </span>
              </div>
              <p className="truncate text-caption text-text-muted">{s.desc}</p>
            </div>
            <SkillBadge state={s.state} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkillBadge({
  state,
}: {
  state: "installed" | "installing" | "available";
}) {
  if (state === "installed") {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success">
        <Icon name="check" size={11} />
        已安装
      </span>
    );
  }
  if (state === "installing") {
    return (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-primary-muted px-2.5 text-caption font-medium text-primary">
        <Icon name="loader" size={11} className="animate-spin" />
        安装中
      </span>
    );
  }
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-border bg-surface px-2.5 text-caption font-medium text-text-muted">
      可安装
    </span>
  );
}

function GatewayScene() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight text-text">
          Gateway · 模型路由
        </h3>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
          5 connected
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { p: "OpenAI", m: "gpt-4o · gpt-4o-mini · …", ms: "287ms" },
          { p: "Anthropic", m: "claude-opus-4-7 · sonnet-4-6", ms: "412ms" },
          { p: "DashScope", m: "qwen-max · qwen-plus · …", ms: "204ms" },
          { p: "DeepSeek", m: "deepseek-chat · deepseek-coder", ms: "319ms" },
        ].map((p) => (
          <div
            key={p.p}
            className="rounded-xl border border-border bg-surface-2/40 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text">{p.p}</span>
              <span className="text-caption font-mono text-success">
                ● {p.ms}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-caption text-text-muted">
              {p.m}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TracesScene() {
  const ROWS = [
    { id: "trc_47b1", emp: "hn-researcher", op: "fetch_url", ms: 312, ok: true },
    {
      id: "trc_47b0",
      emp: "lead-agent",
      op: "dispatch_employee",
      ms: 38,
      ok: true,
    },
    {
      id: "trc_47af",
      emp: "market-watcher",
      op: "fetch_quote",
      ms: 1208,
      ok: true,
    },
    { id: "trc_47ae", emp: "lead-agent", op: "create_employee", ms: 324, ok: true },
    {
      id: "trc_47ad",
      emp: "slack-notifier",
      op: "post_message",
      ms: 894,
      ok: false,
    },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight text-text">
          Traces · 执行追踪
        </h3>
        <div className="flex items-center gap-2 text-caption text-text-subtle">
          <Icon name="search" size={12} />
          <span className="font-mono">last 24h · 214 runs</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left">
          <thead className="bg-surface-2/40 text-caption font-mono uppercase tracking-wider text-text-subtle">
            <tr>
              <th className="px-3 py-2">id</th>
              <th className="px-3 py-2">employee</th>
              <th className="px-3 py-2">tool</th>
              <th className="px-3 py-2 text-right">ms</th>
              <th className="px-3 py-2 text-right">status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {ROWS.map((r) => (
              <tr key={r.id} className="bg-surface">
                <td className="px-3 py-2 font-mono text-caption text-text-muted">
                  {r.id}
                </td>
                <td className="px-3 py-2 font-mono text-caption text-text">
                  {r.emp}
                </td>
                <td className="px-3 py-2 font-mono text-caption text-text">
                  {r.op}
                </td>
                <td className="px-3 py-2 text-right font-mono text-caption text-text-muted">
                  {r.ms}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.ok ? (
                    <span className="inline-flex items-center gap-1 text-caption text-success">
                      <Icon name="check-circle-2" size={11} /> ok
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-caption text-danger">
                      <Icon name="alert-circle" size={11} /> err
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill() {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
      在线
    </span>
  );
}

function ToolRow({ tool, duration }: { tool: string; duration: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <Icon name="check-circle-2" size={14} className="text-success" />
      <span className="text-caption font-mono text-text-muted">{tool}</span>
      <span className="ml-auto text-caption text-success">ok · {duration}</span>
    </div>
  );
}
