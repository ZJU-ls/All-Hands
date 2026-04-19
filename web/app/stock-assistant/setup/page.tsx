"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";

type StepStatus = "pending" | "done" | "skipped";

type StepDef = {
  key: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  check: (ctx: SetupContext) => boolean;
};

type SetupContext = {
  channelCount: number;
  watchedCount: number;
  holdingsCount: number;
  skillEnabled: boolean;
  triggerCount: number;
};

const EMPTY: SetupContext = {
  channelCount: 0,
  watchedCount: 0,
  holdingsCount: 0,
  skillEnabled: false,
  triggerCount: 0,
};

const STEPS: StepDef[] = [
  {
    key: "channel",
    title: "1 · 注册通知渠道",
    description:
      "至少一个启用的渠道(Telegram 双向推荐,或 Bark 单向)。后续 briefing / 异动提醒都走这里。",
    cta: "去注册",
    href: "/channels",
    check: (c) => c.channelCount > 0,
  },
  {
    key: "watch",
    title: "2 · 添加自选 / 持仓",
    description:
      "至少加一只自选股或持仓。poller 订阅的就是 watched ∪ holdings。",
    cta: "去添加",
    href: "/market",
    check: (c) => c.watchedCount + c.holdingsCount > 0,
  },
  {
    key: "skill",
    title: "3 · 启用『老张』员工",
    description:
      "在 /employees 里挂上 allhands.skills.stock_assistant skill · 或直接用内置 persona。",
    cta: "去启用",
    href: "/employees",
    check: (c) => c.skillEnabled,
  },
  {
    key: "triggers",
    title: "4 · 启用 3 个预设 trigger",
    description:
      "在 /triggers 导入 anomaly_to_telegram · opening_briefing_cron · closing_journal_cron。",
    cta: "去启用",
    href: "/triggers",
    check: (c) => c.triggerCount >= 3,
  },
  {
    key: "poller",
    title: "5 · 启动 market-ticker-poller",
    description:
      "在 /market 顶部按 ▶ 启 poller · 让它开始 3 秒级的异动检测。",
    cta: "去启动",
    href: "/market",
    check: () => false, // always show as actionable — status is visible on /market
  },
];

export default function StockAssistantSetupPage() {
  const [ctx, setCtx] = useState<SetupContext>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [channels, watched, holdings, employees, triggers] = await Promise.all([
        fetch("/api/channels").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/market/watched").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/market/holdings").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/employees")
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        fetch("/api/triggers")
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);
      const empList = Array.isArray(employees) ? employees : [];
      const trgList = Array.isArray(triggers) ? triggers : [];
      setCtx({
        channelCount: Array.isArray(channels) ? channels.length : 0,
        watchedCount: Array.isArray(watched) ? watched.length : 0,
        holdingsCount: Array.isArray(holdings) ? holdings.length : 0,
        skillEnabled: empList.some(
          (e: { skill_ids?: string[] }) =>
            e.skill_ids?.includes("allhands.skills.stock_assistant")
        ),
        triggerCount: trgList.length,
      });
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doneCount = STEPS.filter((s) => s.check(ctx)).length;

  return (
    <AppShell
      title="Stock Assistant · Setup"
      actions={
        <button
          onClick={load}
          className="text-xs px-3 py-1.5 rounded-md border border-border hover:border-border-strong transition-colors duration-base"
        >
          ↻ 刷新
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          <header>
            <h1 className="text-lg font-medium text-text">5 步就绪</h1>
            <p className="text-sm text-text-muted mt-1">
              目标:10 分钟内让&ldquo;老张&rdquo;能发出第一条 briefing。已完成 {doneCount} /{" "}
              {STEPS.length}。
            </p>
          </header>

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-5">
              <p className="text-sm text-danger font-mono">{error}</p>
            </div>
          )}

          {loading && !error && (
            <div className="rounded-xl border border-border bg-surface p-6 text-center">
              <p className="text-sm text-text-muted">检测状态中…</p>
            </div>
          )}

          {!loading && (
            <ul className="space-y-3" data-testid="setup-steps">
              {STEPS.map((step) => {
                const status: StepStatus = step.check(ctx) ? "done" : "pending";
                return (
                  <li
                    key={step.key}
                    className="rounded-xl border border-border bg-surface px-5 py-4"
                    data-testid={`step-${step.key}`}
                    data-status={status}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-mono ${
                          status === "done"
                            ? "bg-success/10 text-success"
                            : "bg-surface-2 text-text-muted"
                        }`}
                      >
                        {status === "done" ? "✓" : "·"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text">{step.title}</p>
                        <p className="text-xs text-text-muted mt-0.5">{step.description}</p>
                      </div>
                      <Link
                        href={step.href}
                        className={`text-xs px-3 py-1.5 rounded-md border transition-colors duration-base ${
                          status === "done"
                            ? "border-border text-text-muted hover:border-border-strong"
                            : "border-primary text-primary hover:bg-primary/5"
                        }`}
                      >
                        {status === "done" ? "重看" : step.cta + " →"}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!loading && doneCount === STEPS.length && (
            <div
              className="rounded-xl border border-success/30 bg-success/5 p-5"
              data-testid="setup-ready"
            >
              <p className="text-sm text-success">已就绪</p>
              <p className="text-xs text-text-muted mt-1">
                下一笔异动会自动走 channel 推到你的手机。打开 /chat 跟&ldquo;老张&rdquo;说&ldquo;看看今天&rdquo;验证一下。
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
