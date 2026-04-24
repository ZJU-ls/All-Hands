"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Logo } from "@/components/brand/Logo";
import { Icon, type IconName } from "@/components/ui/icon";

/**
 * Welcome / landing screen — shown to first-time visitors.
 *
 * Standalone layout (no AppShell). Brand-first, CTA-driven. Entering the
 * app sets a `allhands:visited` flag in localStorage so the root route
 * stops redirecting here on subsequent loads. Visitors can still reach
 * /welcome directly at any time.
 */

const VISITED_KEY = "allhands:visited";

type Pillar = {
  icon: IconName;
  title: string;
  body: string;
};

const PILLARS: Pillar[] = [
  {
    icon: "message-square",
    title: "对话即编排",
    body:
      "与 Lead Agent 对话,设计员工、派发任务、观测结果。不用可视化工作流,也不用写 YAML。",
  },
  {
    icon: "users",
    title: "数字员工组织",
    body:
      "员工有身份、有技能、有上下级。Lead 派遣,员工协作,驾驶舱里所有动作透明可审。",
  },
  {
    icon: "plug",
    title: "可扩展的能力层",
    body:
      "Tool · Skill · MCP Server 三层叠加。接入任意模型供应商,挂载任意外部服务,自部署一次性交付。",
  },
];

export function WelcomeScreen() {
  const router = useRouter();

  const enterApp = useCallback(() => {
    try {
      window.localStorage.setItem(VISITED_KEY, "1");
    } catch {
      /* storage disabled — keep flow. */
    }
    router.push("/");
  }, [router]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-bg text-text">
      <MeshBackdrop />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 lg:px-10">
        {/* Topbar */}
        <header className="flex items-center justify-between">
          <Logo
            variant="full"
            size={28}
            className="text-primary"
            label="allhands"
          />
          <div className="flex items-center gap-2 font-mono text-caption text-text-subtle">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            <span className="uppercase tracking-[0.18em]">open source · self-hosted</span>
          </div>
        </header>

        {/* Hero */}
        <section className="flex flex-1 flex-col items-center justify-center py-14 text-center animate-fade-up">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 font-mono text-caption uppercase tracking-[0.18em] text-text-muted backdrop-blur">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse-soft" />
            Lead Agent · Digital Workforce
          </span>

          <h1
            className="max-w-3xl bg-clip-text text-transparent"
            style={{
              fontSize: "clamp(2.5rem, 5vw + 1rem, 4.25rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              fontWeight: 700,
              backgroundImage:
                "linear-gradient(120deg, var(--color-text) 0%, var(--color-primary) 55%, var(--color-accent) 100%)",
            }}
          >
            One Lead Agent,
            <br />a team of employees.
          </h1>

          <p className="mt-5 max-w-xl text-balance text-lg text-text-muted">
            allhands 是一个开源自部署的「数字员工组织」平台。
            <br className="hidden sm:block" />
            你只需要和 Lead Agent 对话,它替你搭建团队、调度任务、可观测地交付。
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={enterApp}
              className="group inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-fg shadow-glow-lg transition duration-base hover:bg-primary-hover hover:-translate-y-px"
            >
              进入驾驶舱
              <Icon
                name="arrow-right"
                size={16}
                className="transition-transform duration-base group-hover:translate-x-0.5"
              />
            </button>
            <a
              href="/about"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-surface/60 px-5 text-sm font-medium text-text-muted backdrop-blur transition duration-base hover:border-border-strong hover:bg-surface hover:text-text"
            >
              <Icon name="book-open" size={16} />
              了解架构
            </a>
          </div>

          <div className="mt-6 font-mono text-caption uppercase tracking-[0.18em] text-text-subtle">
            docker compose up · 一键自部署
          </div>
        </section>

        {/* Pillars */}
        <section className="mt-auto grid gap-4 pb-4 sm:grid-cols-3">
          {PILLARS.map((pillar, idx) => (
            <PillarCard key={pillar.title} pillar={pillar} index={idx} />
          ))}
        </section>

        {/* Footer */}
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-caption text-text-subtle">
          <span className="font-mono uppercase tracking-[0.18em]">
            allhands · built with Claude + LangGraph
          </span>
          <div className="flex items-center gap-4">
            <a href="/about" className="hover:text-text transition duration-fast">
              关于
            </a>
            <a href="/settings" className="hover:text-text transition duration-fast">
              设置
            </a>
            <button
              type="button"
              onClick={enterApp}
              className="font-medium text-primary hover:text-primary-hover transition duration-fast"
            >
              Skip →
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function PillarCard({ pillar, index }: { pillar: Pillar; index: number }) {
  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-border bg-surface/70 p-5 backdrop-blur transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft-lg"
      style={{
        animation: `ah-fade-up 400ms var(--ease-out-expo) ${index * 80 + 120}ms both`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px opacity-0 transition duration-base group-hover:opacity-100"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-primary), transparent)",
        }}
      />
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted text-primary">
        <Icon name={pillar.icon} size={16} />
      </div>
      <h3 className="text-base font-semibold tracking-tight">{pillar.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{pillar.body}</p>
    </article>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Mesh backdrop — 3 floating orbs + dot-grid veil. Fully token-driven.
// ────────────────────────────────────────────────────────────────────────────

function MeshBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* dot-grid veil */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border-strong) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, #000 20%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, #000 20%, transparent 75%)",
        }}
      />
      {/* orb 1 — primary, top-left */}
      <div
        className="absolute animate-float"
        style={{
          top: "-12%",
          left: "-8%",
          width: "44rem",
          height: "44rem",
          borderRadius: "9999px",
          background:
            "radial-gradient(circle at 35% 35%, var(--color-primary) 0%, transparent 60%)",
          opacity: 0.35,
          filter: "blur(60px)",
        }}
      />
      {/* orb 2 — accent, bottom-right */}
      <div
        className="absolute animate-float"
        style={{
          bottom: "-15%",
          right: "-10%",
          width: "40rem",
          height: "40rem",
          borderRadius: "9999px",
          background:
            "radial-gradient(circle at 50% 50%, var(--color-accent) 0%, transparent 65%)",
          opacity: 0.28,
          filter: "blur(70px)",
          animationDelay: "-3s",
        }}
      />
      {/* orb 3 — indigo, center, subtle */}
      <div
        className="absolute"
        style={{
          top: "40%",
          left: "55%",
          width: "28rem",
          height: "28rem",
          borderRadius: "9999px",
          background:
            "radial-gradient(circle at 50% 50%, var(--color-role-lead) 0%, transparent 65%)",
          opacity: 0.18,
          filter: "blur(80px)",
        }}
      />
    </div>
  );
}
