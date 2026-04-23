"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Stock assistant setup · first-run wizard (ADR 0016 · V2 Azure Live).
 *
 * Hero header with gradient progress bar + KPI. Step cards show status pill
 * (done / pending), pulse ring on the first pending step, gradient
 * completion panel when everything is ready. Data fetch / mutation /
 * navigation unchanged.
 */

type StepStatus = "pending" | "done";

type StepDef = {
  key: string;
  order: number;
  title: string;
  description: string;
  cta: string;
  href: string;
  icon: IconName;
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
    order: 1,
    title: "注册通知渠道",
    description:
      "至少一个启用的渠道(Telegram 双向推荐 · 或 Bark 单向)。之后 briefing / 异动提醒都走这里。",
    cta: "去注册",
    href: "/channels",
    icon: "bell",
    check: (c) => c.channelCount > 0,
  },
  {
    key: "watch",
    order: 2,
    title: "添加自选 / 持仓",
    description: "至少加一只自选或持仓。poller 订阅的就是 watched ∪ holdings。",
    cta: "去添加",
    href: "/market",
    icon: "eye",
    check: (c) => c.watchedCount + c.holdingsCount > 0,
  },
  {
    key: "skill",
    order: 3,
    title: "启用『老张』员工",
    description:
      "在 /employees 里给员工挂上 allhands.skills.stock_assistant · 或直接用内置 persona。",
    cta: "去启用",
    href: "/employees",
    icon: "users",
    check: (c) => c.skillEnabled,
  },
  {
    key: "triggers",
    order: 4,
    title: "启用 3 个预设 trigger",
    description:
      "在 /triggers 里导入 anomaly_to_telegram · opening_briefing_cron · closing_journal_cron。",
    cta: "去启用",
    href: "/triggers",
    icon: "zap",
    check: (c) => c.triggerCount >= 3,
  },
  {
    key: "poller",
    order: 5,
    title: "启动 market-ticker-poller",
    description:
      "在 /market 顶部按 ▶ 启动 poller,让它开始 3 秒级的异动检测。",
    cta: "去启动",
    href: "/market",
    icon: "activity",
    check: () => false, // 状态由 /market 顶部实时显示,这里永远可操作
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
            e.skill_ids?.includes("allhands.skills.stock_assistant"),
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
  const totalCount = STEPS.length;
  const pct = Math.round((doneCount / totalCount) * 100);
  const allDone = doneCount === totalCount;

  // The first pending step is the "current" one — gets the pulse-ring
  // treatment. Stock-assistant-setup has a linear logical order.
  const firstPendingKey =
    STEPS.find((s) => !s.check(ctx))?.key ?? null;

  return (
    <AppShell
      title="Stock Assistant · Setup"
      actions={
        <button
          onClick={load}
          disabled={loading}
          data-testid="setup-refresh"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[12px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition-colors duration-fast disabled:opacity-60"
        >
          <Icon
            name="refresh"
            size={12}
            className={loading ? "animate-spin" : ""}
          />
          刷新
        </button>
      }
    >
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-6 animate-fade-up">
          <PageHeader
            title="5 步就绪"
            subtitle={
              <>
                目标:10 分钟内让&ldquo;老张&rdquo;能发出第一条 briefing。
                <span className="ml-1 font-mono text-text">
                  {doneCount} / {totalCount} 已完成
                </span>
                。
              </>
            }
          />

          <ProgressHero pct={pct} doneCount={doneCount} totalCount={totalCount} />

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              <Icon name="alert-circle" size={14} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words font-mono">{error}</span>
            </div>
          )}

          {loading && !error && doneCount === 0 ? (
            <StepsSkeleton />
          ) : (
            <ol className="space-y-3" data-testid="setup-steps">
              {STEPS.map((step) => {
                const status: StepStatus = step.check(ctx) ? "done" : "pending";
                const isCurrent = step.key === firstPendingKey;
                return (
                  <StepCard
                    key={step.key}
                    step={step}
                    status={status}
                    current={isCurrent}
                  />
                );
              })}
            </ol>
          )}

          {allDone && <ReadyPanel />}
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Progress hero
// ---------------------------------------------------------------------------

function ProgressHero({
  pct,
  doneCount,
  totalCount,
}: {
  pct: number;
  doneCount: number;
  totalCount: number;
}) {
  return (
    <section
      data-testid="setup-progress"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/20 shadow-soft-lg p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl opacity-60"
        style={{ background: "var(--color-primary-glow)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/70 via-primary to-accent"
      />

      <div className="relative flex items-start gap-4 flex-wrap">
        <span className="grid h-12 w-12 place-items-center rounded-2xl text-primary-fg shadow-soft shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="sparkles" size={20} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-[20px] font-semibold tracking-tight text-text">
              配置进度
            </h2>
            <span className="font-mono text-caption uppercase tracking-wider text-text-subtle">
              {doneCount} / {totalCount} 步完成 · {pct}%
            </span>
          </div>
          <div className="mt-3 relative h-2 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full shadow-glow-sm transition-[width] duration-[320ms] ease-[cubic-bezier(.16,1,.3,1)]"
              style={{
                width: `${pct}%`,
                background:
                  "linear-gradient(90deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)",
              }}
            />
          </div>
          <p className="mt-3 text-caption text-text-muted">
            按顺序完成即可 · 完成后再次访问本页可查看状态快照。
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Step card
// ---------------------------------------------------------------------------

function StepCard({
  step,
  status,
  current,
}: {
  step: StepDef;
  status: StepStatus;
  current: boolean;
}) {
  const done = status === "done";
  return (
    <li
      data-testid={`step-${step.key}`}
      data-status={status}
      className={`relative rounded-xl border bg-surface shadow-soft-sm p-5 transition duration-base ${
        done
          ? "border-success/30"
          : current
            ? "border-primary/40 hover:-translate-y-px hover:shadow-soft"
            : "border-border hover:border-border-strong hover:-translate-y-px hover:shadow-soft"
      }`}
    >
      {current && !done && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/70 via-primary to-accent"
        />
      )}
      <div className="flex items-start gap-4">
        <StepMarker order={step.order} status={status} current={current} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-primary-muted text-primary shrink-0">
              <Icon name={step.icon} size={12} strokeWidth={2} />
            </span>
            <h3 className="text-[14px] font-semibold text-text truncate">
              {step.title}
            </h3>
            <span
              className={`inline-flex items-center gap-1 h-5 px-2 rounded-full text-caption font-mono font-semibold uppercase tracking-wider ${
                done
                  ? "bg-success-soft text-success"
                  : current
                    ? "bg-primary-muted text-primary"
                    : "bg-surface-2 text-text-subtle"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  done
                    ? "bg-success"
                    : current
                      ? "bg-primary"
                      : "bg-text-subtle"
                }`}
              />
              {done ? "已完成" : current ? "进行中" : "待完成"}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-text-muted leading-relaxed">
            {step.description}
          </p>
        </div>
        <Link
          href={step.href}
          data-testid={`step-${step.key}-cta`}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-medium shadow-soft-sm transition duration-base shrink-0 ${
            done
              ? "border border-border bg-surface text-text-muted hover:text-text hover:border-border-strong"
              : current
                ? "bg-primary hover:bg-primary-hover text-primary-fg hover:-translate-y-px"
                : "border border-border bg-surface text-text hover:border-primary hover:text-primary"
          }`}
        >
          {done ? (
            <>
              <Icon name="eye" size={12} />
              重看
            </>
          ) : (
            <>
              {step.cta}
              <Icon name="arrow-right" size={12} />
            </>
          )}
        </Link>
      </div>
    </li>
  );
}

function StepMarker({
  order,
  status,
  current,
}: {
  order: number;
  status: StepStatus;
  current: boolean;
}) {
  const done = status === "done";
  if (done) {
    return (
      <div
        className="grid h-10 w-10 place-items-center rounded-full bg-success-soft text-success shrink-0"
        aria-hidden="true"
      >
        <Icon name="check" size={16} strokeWidth={2.5} />
      </div>
    );
  }
  if (current) {
    return (
      <div className="relative shrink-0" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
        <div
          className="relative grid h-10 w-10 place-items-center rounded-full text-primary-fg font-mono text-[13px] font-semibold shadow-soft"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
        >
          {order}
        </div>
      </div>
    );
  }
  return (
    <div
      className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 border border-border text-text-subtle font-mono text-[13px] font-semibold shrink-0"
      aria-hidden="true"
    >
      {order}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready panel
// ---------------------------------------------------------------------------

function ReadyPanel() {
  return (
    <section
      data-testid="setup-ready"
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-primary/30 shadow-soft-lg p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl opacity-60"
        style={{ background: "var(--color-primary-glow)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-success via-primary to-accent"
      />
      <div className="relative flex items-start gap-4 flex-wrap">
        <span
          className="grid h-14 w-14 place-items-center rounded-2xl text-primary-fg shadow-soft shrink-0"
          style={{
            background:
              "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
          }}
          aria-hidden="true"
        >
          <Icon name="check-circle-2" size={22} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold tracking-tight text-text">
            已就绪 · 老张上岗
          </h2>
          <p className="mt-2 text-[13px] text-text-muted leading-relaxed">
            下一笔异动会自动走 channel 推到你的手机。打开 /chat 跟&ldquo;老张&rdquo;说
            &ldquo;看看今天&rdquo; 验证一下。
          </p>
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <Link
              href="/chat"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-fg text-[13px] font-semibold shadow-soft hover:-translate-y-px transition duration-base"
            >
              <Icon name="send" size={14} />
              打开对话
            </Link>
            <Link
              href="/market"
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-border bg-surface text-[13px] font-medium text-text hover:border-primary hover:text-primary shadow-soft-sm transition duration-base"
            >
              <Icon name="activity" size={14} />
              看行情
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StepsSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="rounded-xl border border-border bg-surface shadow-soft-sm p-5"
        >
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-full bg-surface-2 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-48 rounded bg-surface-2 animate-pulse" />
              <div className="h-2.5 w-full rounded bg-surface-2 animate-pulse" />
              <div className="h-2.5 w-4/5 rounded bg-surface-2 animate-pulse" />
            </div>
            <div className="h-9 w-20 rounded-lg bg-surface-2 animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}
