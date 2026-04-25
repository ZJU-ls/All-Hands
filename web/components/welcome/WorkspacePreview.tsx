"use client";

/**
 * WorkspacePreview · /welcome hero animation.
 *
 * Browser-chrome window that auto-cycles through 4 scenes mirroring the
 * real product surfaces (chat / skills / gateway / traces). Sidebar items
 * are clickable; clicking jumps + restarts the rotation timer. A progress
 * bar at the foot of the sidebar gives a clear visual cue that the
 * preview is animating — no more "is it broken?".
 *
 * Animation: opacity + small translate-y crossfade on scene change. CSS-
 * only motion (§3.8 #5).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/icon";
import { AllhandsLogo, type LogoConcept } from "@/components/brand/AllhandsLogo";
import { cn } from "@/lib/cn";

type SceneId = "chat" | "skills" | "gateway" | "traces";

const SIDEBAR: Array<{ id: SceneId; label: string; icon: IconName }> = [
  { id: "chat", label: "对话", icon: "message-square" },
  { id: "skills", label: "技能", icon: "wand-2" },
  { id: "gateway", label: "网关", icon: "plug" },
  { id: "traces", label: "追踪", icon: "activity" },
];

const ROTATE_MS = 5000;

export function WorkspacePreview({
  logoConcept = "constellation",
}: {
  logoConcept?: LogoConcept;
}) {
  const [activeId, setActiveId] = useState<SceneId>("chat");
  const startRef = useRef<number>(Date.now());
  const [progress, setProgress] = useState(0);

  // Timer drives both the active scene swap and the progress bar; pinned
  // to RAF so the bar fills smoothly instead of stepping.
  useEffect(() => {
    startRef.current = Date.now();
    setProgress(0);
    let raf = 0;
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const ratio = Math.min(elapsed / ROTATE_MS, 1);
      setProgress(ratio);
      if (ratio >= 1) {
        setActiveId((cur) => {
          const idx = SIDEBAR.findIndex((s) => s.id === cur);
          const next = SIDEBAR[(idx + 1) % SIDEBAR.length];
          return next ? next.id : cur;
        });
        return; // effect re-runs on activeId change
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeId]);

  function handleClick(id: SceneId) {
    if (id === activeId) {
      // Same scene · just restart the timer for "wait, that was cool, replay".
      startRef.current = Date.now();
      setProgress(0);
      return;
    }
    setActiveId(id);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
      {/* Browser chrome */}
      <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-2/60 px-4 backdrop-blur-md">
        <span className="h-3 w-3 rounded-full bg-danger/70" />
        <span className="h-3 w-3 rounded-full bg-warning/70" />
        <span className="h-3 w-3 rounded-full bg-success/70" />
        <span className="ml-3 text-caption font-mono text-text-muted">
          allhands.local / {activeId}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-caption text-text-subtle">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />
          点侧边栏切换 · 自动轮播
        </span>
      </div>

      <div className="grid grid-cols-12">
        {/* Sidebar · clickable items + progress bar at the foot */}
        <aside className="col-span-3 flex flex-col gap-1 border-r border-border bg-surface-2/40 p-4">
          {SIDEBAR.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleClick(item.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-base",
                  active
                    ? "bg-primary text-primary-fg shadow-soft-sm"
                    : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon name={item.icon} size={14} />
                <span className="text-sm font-medium">{item.label}</span>
                {active ? (
                  <span
                    aria-hidden
                    className="ml-auto inline-block h-1 w-1 rounded-full bg-primary-fg"
                  />
                ) : null}
                {/* Per-item progress bar — only on the active row */}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 bottom-0.5 h-[2px] overflow-hidden rounded-full bg-primary-fg/20"
                  >
                    <span
                      className="block h-full rounded-full bg-primary-fg/80"
                      style={{ width: `${progress * 100}%` }}
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </aside>

        {/* Stage · all scenes layered, transition opacity + translate */}
        <div className="relative col-span-9 min-h-[320px] p-6">
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
        "absolute inset-0 p-6 transition-[opacity,transform] duration-mid",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-1 opacity-0",
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
        <StatusPill label="在线" />
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
  // Mirrors app/skills/page.tsx — KPI strip + 3-column skill cards.
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary-muted px-2 text-caption font-mono font-semibold uppercase tracking-wider text-primary">
            <Icon name="wand-2" size={10} />
            Skills
          </span>
          <h3 className="text-base font-semibold tracking-tight text-text">
            技能
          </h3>
          <span className="font-mono text-caption text-text-subtle">· 24</span>
        </div>
        <span className="font-mono text-caption text-text-subtle">
          capability packs
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <KpiCard label="Total" value="24" hint="6 自管 · 18 内建" />
        <KpiCard label="Installed" value="6" hint="用户安装" />
        <KpiCard label="Builtin" value="18" hint="平台内建" />
        <KpiCard label="Latest" value="2h" hint="hn-digest" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          {
            n: "web-fetch",
            tag: "READ",
            desc: "抓任意 URL · 文本 / JSON",
            tagTone: "primary" as const,
          },
          {
            n: "hn-digest",
            tag: "READ",
            desc: "Hacker News 头条摘要",
            tagTone: "primary" as const,
          },
          {
            n: "slack-notify",
            tag: "WRITE",
            desc: "Slack channel · 需 confirm",
            tagTone: "warning" as const,
          },
        ].map((s) => (
          <div
            key={s.n}
            className="space-y-2 rounded-xl border border-border bg-surface-2/40 px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary-muted text-primary">
                <Icon name="wand-2" size={12} />
              </span>
              <span className="font-mono text-caption font-semibold text-text">
                {s.n}
              </span>
            </div>
            <p className="line-clamp-2 text-caption text-text-muted">
              {s.desc}
            </p>
            <span
              className={cn(
                "inline-flex h-5 items-center rounded px-1.5 text-[10px] font-mono font-semibold uppercase",
                s.tagTone === "primary"
                  ? "bg-primary-muted text-primary"
                  : "bg-warning-soft text-warning",
              )}
            >
              {s.tag}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GatewayScene() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary-muted px-2 text-caption font-mono font-semibold uppercase tracking-wider text-primary">
            <Icon name="plug" size={10} />
            Gateway
          </span>
          <h3 className="text-base font-semibold tracking-tight text-text">
            网关
          </h3>
        </div>
        <StatusPill label="5 connected" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <KpiCard label="Providers" value="5" hint="OpenAI · Anthropic · …" />
        <KpiCard label="Models" value="23" hint="across all providers" />
        <KpiCard label="Default" value="gpt-4o-mini" mono />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { p: "OpenAI", k: "openai", m: 5, ms: "287ms" },
          { p: "Anthropic", k: "anthropic", m: 4, ms: "412ms" },
          { p: "DashScope", k: "dashscope", m: 8, ms: "204ms" },
          { p: "DeepSeek", k: "deepseek", m: 3, ms: "319ms" },
        ].map((p) => (
          <div
            key={p.k}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface text-primary shadow-soft-sm">
              <Icon name="plug" size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">{p.p}</span>
                <span className="font-mono text-caption text-success">
                  ● {p.ms}
                </span>
              </div>
              <p className="text-caption text-text-muted">{p.m} models</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TracesScene() {
  // Mirrors components/traces/TraceTable.tsx headers (chinese · right-aligned ms).
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary-muted px-2 text-caption font-mono font-semibold uppercase tracking-wider text-primary">
            <Icon name="activity" size={10} />
            Traces
          </span>
          <h3 className="text-base font-semibold tracking-tight text-text">
            执行追踪
          </h3>
        </div>
        <span className="font-mono text-caption text-text-subtle">
          last 24h · 214 runs
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left">
          <thead className="bg-surface-2/60 text-caption font-mono uppercase tracking-wider text-text-subtle backdrop-blur-sm">
            <tr>
              <th className="px-3 py-2">trace</th>
              <th className="px-3 py-2">员工</th>
              <th className="px-3 py-2">工具</th>
              <th className="px-3 py-2 text-right">ms</th>
              <th className="px-3 py-2 text-right">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {ROWS.map((r) => (
              <tr key={r.id} className="bg-surface">
                <td className="truncate px-3 py-2 font-mono text-caption text-text-muted">
                  {r.id}
                </td>
                <td className="px-3 py-2 font-mono text-caption text-text">
                  {r.emp}
                </td>
                <td className="px-3 py-2 font-mono text-caption text-text">
                  {r.op}
                </td>
                <td className="px-3 py-2 text-right font-mono text-caption tabular-nums text-text-muted">
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

// ───────────────────────── Primitives ─────────────────────────

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
      {label}
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

function KpiCard({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-xl border border-border bg-surface-2/40 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {label}
      </div>
      <div
        className={cn(
          "font-semibold text-text",
          mono ? "font-mono text-sm" : "text-lg",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-caption text-text-subtle">{hint}</div> : null}
    </div>
  );
}
