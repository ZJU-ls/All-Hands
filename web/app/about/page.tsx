"use client";
import { AppShell } from "@/components/shell/AppShell";
import { Icon } from "@/components/ui/icon";

export default function AboutPage() {
  return (
    <AppShell title="关于">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-12 animate-fade-up">
          {/* Hero card */}
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-10 shadow-soft-sm">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-70"
              style={{
                background:
                  "radial-gradient(600px 300px at 20% 0%, var(--color-primary-soft) 0%, transparent 60%), radial-gradient(500px 300px at 80% 100%, var(--color-accent) 0%, transparent 65%)",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, var(--color-border) 1px, transparent 0)",
                backgroundSize: "24px 24px",
                opacity: 0.3,
              }}
            />
            <div className="relative">
              <div
                className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft-lg"
                style={{
                  background:
                    "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
                }}
              >
                <Icon name="sparkles" size={26} />
              </div>
              <h1 className="mt-6 text-[36px] font-bold leading-tight tracking-tight">
                <span
                  className="bg-gradient-to-r from-primary via-accent to-primary-glow bg-clip-text text-transparent"
                >
                  allhands
                </span>
              </h1>
              <p className="mt-3 text-base text-text">
                One for All — 开源自部署的数字员工组织平台。
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-muted">
                通过与 Lead Agent 对话来设计、调度并观测一支员工团队。所有能力以 Tool 的形式注册,前端菜单只是入口,后端遵循 Tool First 原则。
              </p>
              <div className="mt-6 inline-flex h-6 items-center gap-2 rounded-full border border-border bg-surface px-2.5 shadow-soft-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="font-mono text-caption text-text-muted uppercase tracking-wider">
                  v0 · mvp
                </span>
              </div>
            </div>
          </div>

          {/* Quick facts grid */}
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Fact
              icon="layout-grid"
              label="核心原则"
              body="Tool First · 统一 React Agent · Pure Query Loop · Skill 渐进加载 · Subagent 组合 · L4 护栏"
            />
            <Fact
              icon="users"
              label="数字员工"
              body="每个 agent 都是配置 (model · skills · tools · system prompt) · 没有 mode 字段"
            />
            <Fact
              icon="shield-check"
              label="护栏可控"
              body="Tool 必须声明 scope · WRITE 默认要确认 · IRREVERSIBLE 走双重确认"
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Fact({
  icon,
  label,
  body,
}: {
  icon: "layout-grid" | "users" | "shield-check";
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-soft-sm transition duration-base hover:border-border-strong hover:shadow-soft hover:-translate-y-px">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary-muted text-primary">
        <Icon name={icon} size={16} />
      </div>
      <div className="mt-3 text-sm font-semibold tracking-tight text-text">{label}</div>
      <p className="mt-1 text-caption leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}
