"use client";

/**
 * /welcome · first-run hero greeting.
 *
 * Visual vocabulary inherited from /design-lab (ADR 0016 · Brand Blue Dual
 * Theme): massive gradient h1, mesh-gradient + masked grid backdrop,
 * floating accent orbs, eyebrow chip with pulse dot, miniature workspace
 * preview, and pill highlight cards. Tokens-only colours, no `dark:`
 * variants — the theme pack handles light/dark via CSS variables.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/icon";
import { LogoDotgrid } from "@/components/ui/icons";
import { markFirstRunCompleted } from "@/lib/first-run";

export const FIRST_RUN_SCOPE = "welcome";

type Highlight = {
  icon: IconName;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
};

const HIGHLIGHTS: Highlight[] = [
  {
    icon: "sparkles",
    eyebrow: "01 · Lead Agent",
    title: "对话即操作",
    body: "把「管理一支团队」压缩成和一个 Agent 聊天。它替你设计员工、调度任务、读取观测。",
    bullets: ["自然语言创建员工", "复杂任务一句话委派", "随时打断、追加上下文"],
  },
  {
    icon: "users",
    eyebrow: "02 · 数字员工组织",
    title: "员工 / Skill / Tool 都是一等公民",
    body: "统一 ReAct runner · 没有 mode 字段 · 加新角色 = 加 Skill / Tool · 不是给数据库加枚举。",
    bullets: ["10 层架构 · 边界清晰", "Skill 渐进加载", "MCP 即插即用"],
  },
  {
    icon: "shield-check",
    eyebrow: "03 · 护栏与可观测",
    title: "默认安全 · 全链路追踪",
    body: "WRITE 以上 Tool 自动接 Confirmation Gate · 每一步都进 Trace · 进程重启可 resume。",
    bullets: ["写操作必须确认", "事件日志 + 投影", "LangFuse 全链可视化"],
  },
];

const STATS: Array<{ value: string; label: string }> = [
  { value: "10", label: "层架构 · 单向依赖" },
  { value: "8", label: "条核心设计原则" },
  { value: "∞", label: "可注册 Tool / Skill" },
];

export default function WelcomePage() {
  const router = useRouter();

  const handleStart = useCallback(() => {
    markFirstRunCompleted(FIRST_RUN_SCOPE);
    router.replace("/chat");
  }, [router]);

  const handleSkip = useCallback(() => {
    markFirstRunCompleted(FIRST_RUN_SCOPE);
    router.replace("/");
  }, [router]);

  return (
    <main
      data-testid="welcome-page"
      className="relative h-screen w-full overflow-x-hidden overflow-y-auto bg-bg"
    >
      {/* ─── Mesh-gradient backdrop · radial blobs in light + dark via tokens. ─── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 540px at 18% -10%, var(--color-primary-soft) 0%, transparent 55%)," +
            "radial-gradient(720px 460px at 90% 5%, var(--color-primary-muted) 0%, transparent 60%)," +
            "radial-gradient(700px 500px at 50% 110%, color-mix(in srgb, var(--color-accent) 30%, transparent) 0%, transparent 70%)",
        }}
      />
      {/* ─── Masked grid backdrop · fades out at edges, no hard lines on the page chrome. ─── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          opacity: 0.18,
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 70% at 50% 0%, #000 0%, rgba(0,0,0,0.4) 60%, transparent 100%)",
        }}
      />
      {/* ─── Floating orbs · CSS keyframes only (§3.8 #5). ─── */}
      <div
        aria-hidden
        className="pointer-events-none fixed -top-10 left-[8%] h-56 w-56 animate-float rounded-full opacity-50 blur-3xl"
        style={{ background: "var(--color-accent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-12 right-[10%] h-72 w-72 animate-float rounded-full opacity-40 blur-3xl"
        style={{
          background: "var(--color-primary-glow)",
          animationDelay: "2s",
        }}
      />

      {/* ─── Top-right skip · low-emphasis but always reachable. ─── */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-6 sm:px-10">
        <div className="inline-flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-white shadow-glow-sm">
            <LogoDotgrid size={18} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-text">
            allhands
          </span>
        </div>
        <button
          type="button"
          data-testid="welcome-skip"
          onClick={handleSkip}
          className="text-caption text-text-subtle transition-colors duration-fast hover:text-text-muted"
        >
          稍后再说 →
        </button>
      </div>

      <div className="relative mx-auto max-w-[1200px] px-6 pb-20 pt-12 sm:px-10 sm:pt-16">
        {/* ─── Hero ─── */}
        <section className="animate-fade-up">
          {/* Eyebrow chip · live-pulse dot */}
          <div className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-3 shadow-soft-sm">
            <span className="relative h-2 w-2">
              <span className="absolute inset-0 animate-pulse-soft rounded-full bg-primary opacity-60" />
              <span className="absolute inset-0 rounded-full bg-primary" />
            </span>
            <span className="text-caption font-mono uppercase tracking-wider text-text-muted">
              v0 · Open Source · Self-hosted
            </span>
          </div>

          {/* Massive h1 · gradient on the second line */}
          <h1 className="mt-7 max-w-5xl text-[44px] font-bold leading-[0.98] tracking-[-0.04em] text-text sm:text-[64px] lg:text-[80px]">
            欢迎来到 allhands。
            <br />
            <span className="bg-gradient-to-r from-primary via-accent to-primary-glow bg-clip-text text-transparent">
              一个 Lead Agent · 搞定一切。
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-7 max-w-2xl text-lg leading-relaxed text-text-muted">
            和你的首席数字员工对话,把「会写代码、查数据、推消息」的一支团队
            搭起来 —— 不写工作流、不点表单、不加枚举字段。
          </p>

          {/* CTAs */}
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="welcome-start"
              onClick={handleStart}
              className="group inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary-glow to-accent px-6 text-base font-semibold text-primary-fg shadow-glow transition-transform duration-base hover:-translate-y-px"
            >
              <Icon name="sparkles" size={16} />
              开始使用
              <Icon
                name="arrow-right"
                size={16}
                className="transition-transform duration-base group-hover:translate-x-0.5"
              />
            </button>
            <Link
              href="/design-lab"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-surface px-6 text-base font-medium text-text shadow-soft-sm transition-colors duration-fast hover:bg-surface-2"
            >
              <Icon name="layout-grid" size={16} className="text-primary" />
              浏览设计系统
            </Link>
          </div>

          {/* Mini stat strip */}
          <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3">
            {STATS.map((s, i) => (
              <div key={s.label} className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-text">
                  {s.value}
                </span>
                <span className="text-caption text-text-muted">{s.label}</span>
                {i < STATS.length - 1 ? (
                  <span aria-hidden className="ml-2 text-text-subtle">
                    ·
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {/* ─── Workspace preview · floats below hero, browser-chrome card. ─── */}
        <section
          className="relative mt-16 animate-fade-up"
          style={{ animationDelay: "120ms" }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft-lg">
            {/* Browser chrome */}
            <div className="flex h-10 items-center gap-2 border-b border-border bg-surface-2/60 px-4 backdrop-blur-md">
              <span className="h-3 w-3 rounded-full bg-danger/70" />
              <span className="h-3 w-3 rounded-full bg-warning/70" />
              <span className="h-3 w-3 rounded-full bg-success/70" />
              <span className="ml-3 text-caption font-mono text-text-muted">
                allhands.local / chat
              </span>
            </div>

            <div className="grid grid-cols-12">
              {/* Mini sidebar */}
              <aside className="col-span-3 space-y-1 border-r border-border bg-surface-2/40 p-4">
                <div className="relative flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-primary-fg shadow-soft-sm">
                  <Icon name="message-square" size={14} />
                  <span className="text-sm font-medium">对话</span>
                  <span className="ml-auto rounded bg-primary-fg/20 px-1.5 text-caption font-mono">
                    42
                  </span>
                </div>
                {(
                  [
                    { l: "员工", i: "users" },
                    { l: "Skills", i: "wand-2" },
                    { l: "Gateway", i: "plug" },
                    { l: "Traces", i: "activity" },
                  ] as { l: string; i: IconName }[]
                ).map((x) => (
                  <div
                    key={x.l}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-text-muted"
                  >
                    <Icon name={x.i} size={14} />
                    <span className="text-sm">{x.l}</span>
                  </div>
                ))}
              </aside>

              {/* Main pane · stylised chat */}
              <div className="col-span-9 space-y-4 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-primary-fg shadow-glow-sm">
                      <LogoDotgrid size={13} />
                    </span>
                    <h3 className="text-base font-semibold tracking-tight text-text">
                      Lead Agent
                    </h3>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-caption font-mono text-text-subtle">
                      gpt-4o-mini
                    </span>
                  </div>
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
                    在线
                  </span>
                </div>

                {/* User bubble */}
                <div className="flex justify-end">
                  <div className="max-w-md rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-fg shadow-soft-sm">
                    帮我招一个研究员,每天读 5 篇 Hacker News 头条。
                  </div>
                </div>

                {/* Assistant bubble */}
                <div className="flex justify-start">
                  <div className="max-w-xl space-y-2 rounded-2xl rounded-bl-sm border border-border bg-surface-2/70 px-4 py-3 text-sm text-text shadow-soft-sm">
                    <p>
                      已为你创建员工{" "}
                      <span className="font-mono font-medium text-primary">
                        hn-researcher
                      </span>
                      ,挂上了 fetch_url + summarize 两个 Tool。
                    </p>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
                      <Icon
                        name="check-circle-2"
                        size={14}
                        className="text-success"
                      />
                      <span className="text-caption font-mono text-text-muted">
                        create_employee
                      </span>
                      <span className="ml-auto text-caption text-success">
                        ok · 320ms
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Highlights ─── */}
        <section
          className="mt-20 animate-fade-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="mb-8 flex items-end justify-between gap-6">
            <div className="space-y-2">
              <div className="text-caption font-mono uppercase tracking-[0.16em] text-primary">
                What you get
              </div>
              <h2 className="max-w-xl text-2xl font-semibold tracking-tight text-text sm:text-3xl">
                以平台的方式做 AI 应用 · 不是又一个 Agent demo。
              </h2>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {HIGHLIGHTS.map((h) => (
              <article
                key={h.title}
                className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-soft-sm transition-colors duration-base hover:border-border-strong hover:bg-surface-2"
              >
                {/* Top hairline accent on hover */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent opacity-0 transition-opacity duration-base group-hover:opacity-100"
                />
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-muted text-primary">
                    <Icon name={h.icon} size={18} />
                  </span>
                  <span className="text-caption font-mono uppercase tracking-wider text-text-subtle">
                    {h.eyebrow}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-tight text-text">
                  {h.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">
                  {h.body}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {h.bullets.map((b) => (
                    <li
                      key={b}
                      className="flex items-start gap-2 text-caption text-text-muted"
                    >
                      <Icon
                        name="check"
                        size={12}
                        className="mt-1 shrink-0 text-primary"
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* ─── Footer CTA · "ready to start" reprise ─── */}
        <section
          className="mt-20 animate-fade-up"
          style={{ animationDelay: "280ms" }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-surface to-accent/10 px-8 py-10 shadow-soft-lg">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 animate-float rounded-full opacity-40 blur-3xl"
              style={{ background: "var(--color-primary-glow)" }}
            />
            <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
              <div className="space-y-2">
                <h3 className="text-2xl font-semibold tracking-tight text-text">
                  准备好搭你的第一支团队了吗?
                </h3>
                <p className="text-sm text-text-muted">
                  下一步:对 Lead Agent 说一句「帮我招一个 X」,剩下的它来。
                </p>
              </div>
              <button
                type="button"
                onClick={handleStart}
                className="group inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary-glow to-accent px-6 text-base font-semibold text-primary-fg shadow-glow transition-transform duration-base hover:-translate-y-px"
              >
                进入工作区
                <Icon
                  name="arrow-right"
                  size={16}
                  className="transition-transform duration-base group-hover:translate-x-0.5"
                />
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
