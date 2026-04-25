"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { LogoDotgrid } from "@/components/ui/icons";
import { markFirstRunCompleted } from "@/lib/first-run";

export const FIRST_RUN_SCOPE = "welcome";

const HIGHLIGHTS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "sparkles",
    title: "一个 Lead Agent · 搞定一切",
    body: "对话即操作 · Lead Agent 通过自然语言帮你设计、调度、观测一支数字员工团队。",
  },
  {
    icon: "users",
    title: "数字员工组织",
    body: "员工 / Skill / Tool / MCP 都是一等公民 · 任何能力都能通过对话或独立页面创建与编排。",
  },
  {
    icon: "shield-check",
    title: "护栏与可观测",
    body: "写操作走 Confirmation Gate · 所有 Trace 实时可观测 · 重要状态可 checkpoint 与 resume。",
  },
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
      className="relative flex h-screen w-full items-center justify-center overflow-hidden bg-bg px-6"
    >
      {/* Mesh hero backdrop — dual-theme via tokens, no dark: classes. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(640px 380px at 18% 12%, var(--color-primary-muted), transparent 70%)," +
            "radial-gradient(520px 320px at 86% 84%, color-mix(in srgb, var(--color-accent) 26%, transparent), transparent 68%)," +
            "radial-gradient(900px 540px at 50% 110%, color-mix(in srgb, var(--color-primary) 14%, transparent), transparent 80%)",
        }}
      />
      {/* Floating accent orbs — pure CSS animation, allowed by §3.8 #5. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[8%] top-[18%] h-32 w-32 rounded-full bg-primary/10 blur-2xl animate-float"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[10%] bottom-[14%] h-40 w-40 rounded-full bg-accent/15 blur-2xl animate-float"
        style={{ animationDelay: "1.6s" }}
      />

      <section
        role="region"
        aria-label="欢迎使用 allhands"
        className="relative w-full max-w-3xl rounded-3xl border border-border bg-surface/85 px-10 py-12 shadow-soft-lg backdrop-blur-md"
      >
        {/* Top hairline accent */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
        />

        <header className="flex flex-col items-center gap-4 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-white shadow-glow-lg">
            <LogoDotgrid size={26} />
          </div>
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-text-subtle">
            One for All
          </p>
          <h1 className="bg-gradient-to-br from-text via-primary to-accent bg-clip-text text-display font-semibold leading-tight text-transparent">
            欢迎来到 allhands
          </h1>
          <p className="max-w-xl text-base text-text-muted">
            一个开源、自部署的数字员工组织平台 ——
            和 Lead Agent 对话,把一支会写代码、查数据、推消息的团队搭起来。
          </p>
        </header>

        <ul className="mt-10 grid gap-3 sm:grid-cols-3">
          {HIGHLIGHTS.map((h) => (
            <li
              key={h.title}
              className="group relative flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 py-4 transition-colors duration-base hover:border-border-strong hover:bg-surface-2"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary-muted text-primary">
                <Icon name={h.icon} size={16} />
              </span>
              <h2 className="text-sm font-semibold text-text">{h.title}</h2>
              <p className="text-caption text-text-muted">{h.body}</p>
            </li>
          ))}
        </ul>

        <footer className="mt-10 flex flex-col items-center gap-3">
          <button
            type="button"
            data-testid="welcome-start"
            onClick={handleStart}
            className="group inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-br from-primary to-accent px-6 text-sm font-semibold text-white shadow-glow transition-transform duration-base hover:-translate-y-px"
          >
            开始使用
            <Icon
              name="arrow-right"
              size={14}
              className="transition-transform duration-base group-hover:translate-x-0.5"
            />
          </button>
          <button
            type="button"
            data-testid="welcome-skip"
            onClick={handleSkip}
            className="text-caption text-text-subtle transition-colors duration-fast hover:text-text-muted"
          >
            稍后再说
          </button>
        </footer>
      </section>
    </main>
  );
}
