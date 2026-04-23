"use client";

import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/icon";

type ReviewGate = {
  id: string;
  title: string;
  persona: string;
  rounds: string;
  duration: string;
  icon: IconName;
  tone: "primary" | "accent" | "success";
  docs: { label: string; href: string }[];
  meta_tool: string;
};

const GATES: ReviewGate[] = [
  {
    id: "self-review",
    title: "自审 · Self-Review",
    persona: "3 人格 · 不重叠 · 好看 / 好用 / 爱不释手",
    rounds: "Round 1 · 2 · 3",
    duration: "~ 1-2h wall clock",
    icon: "sparkles",
    tone: "primary",
    docs: [
      { label: "spec", href: "/spec/2026-04-18-self-review" },
      { label: "产物目录", href: "/review-artifacts" },
    ],
    meta_tool: "allhands.meta.cockpit.run_self_review",
  },
  {
    id: "walkthrough-acceptance",
    title: "走查验收 · Walkthrough Acceptance",
    persona: "新用户第一次打开 · 修 - 评闭环",
    rounds: "W1 → W7 · 修-评循环(≤ 5 iterations)",
    duration: "~ 2-4h wall clock",
    icon: "eye",
    tone: "accent",
    docs: [
      { label: "spec", href: "/spec/2026-04-18-walkthrough-acceptance" },
      { label: "产物目录", href: "/acceptance" },
    ],
    meta_tool: "allhands.meta.cockpit.run_walkthrough_acceptance",
  },
  {
    id: "harness-review",
    title: "工具链自审 · Harness Review",
    persona: "冷却 ≥ 7 天后回看 · 没用过的陌生人",
    rounds: "Step 1 (docs drift) · Step 2 (fix) · Step 3 (fresh eyes)",
    duration: "~ 30min-2h · 加 7 天冷却",
    icon: "shield-check",
    tone: "success",
    docs: [
      { label: "spec", href: "/spec/2026-04-18-harness-review" },
      { label: "history", href: "/harness-history" },
    ],
    meta_tool: "allhands.meta.cockpit.run_harness_review",
  },
];

const ORDER_NOTE =
  "所有 feature spec 全交付后,按 self-review → walkthrough-acceptance → harness-review 的顺序跑;" +
  "任一前序未完成,后续是垃圾证据。";

export default function ReviewPage() {
  return (
    <AppShell title="Review">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-8 px-8 py-10 animate-fade-up">
          <PageHeader
            title="Review · 3 级交付闸门"
            subtitle={
              <>
                这 3 个闸门把 spec 从&ldquo;写完了&rdquo;推到&ldquo;可以交给用户&rdquo;。每个都有独立的人格、产物和退出条件。点下面的 Meta Tool 名称,可以在对话里让 Lead 触发(需确认)。
              </>
            }
          />

          <div className="rounded-xl border border-primary/20 bg-primary-muted/60 p-4">
            <div className="flex items-start gap-2">
              <Icon name="info" size={14} className="mt-0.5 text-primary" />
              <p className="text-caption leading-relaxed text-text-muted">{ORDER_NOTE}</p>
            </div>
          </div>

          <ul className="space-y-4">
            {GATES.map((g) => (
              <GateCard key={g.id} gate={g} />
            ))}
          </ul>

          <footer className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-5 font-mono text-caption text-text-muted">
            <div className="flex items-start gap-2">
              <Icon name="shield-check" size={12} className="mt-0.5 text-text-subtle" />
              <p>触发 Meta Tool 走 Confirmation Gate · 所有 WRITE 工具都需要用户显式确认。</p>
            </div>
            <div className="flex items-start gap-2">
              <Icon name="code" size={12} className="mt-0.5 text-text-subtle" />
              <p>
                规则引擎(Round 1 mechanical checks)运行方式 ·{" "}
                <code className="rounded bg-surface px-1.5 py-0.5 text-text">
                  ./scripts/review/lint-rules.sh
                </code>
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Icon name="file" size={12} className="mt-0.5 text-text-subtle" />
              <p>
                Harness Step 1 docs drift draft ·{" "}
                <code className="rounded bg-surface px-1.5 py-0.5 text-text">
                  ./scripts/harness/audit-docs.sh
                </code>
              </p>
            </div>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}

function GateCard({ gate }: { gate: ReviewGate }) {
  const toneTile: Record<ReviewGate["tone"], string> = {
    primary: "bg-primary-muted text-primary",
    accent: "bg-accent/15 text-accent",
    success: "bg-success-soft text-success",
  };
  return (
    <li className="group relative overflow-hidden rounded-xl border border-border bg-surface p-5 shadow-soft-sm transition duration-base hover:-translate-y-px hover:border-border-strong hover:shadow-soft">
      <div className="flex items-start gap-4">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneTile[gate.tone]}`}>
          <Icon name={gate.icon} size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold tracking-tight text-text">
              {gate.title}
            </h3>
            <span className="inline-flex items-center gap-1 font-mono text-caption text-text-subtle">
              <Icon name="clock" size={11} />
              {gate.duration}
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-4 gap-y-1.5 text-caption">
            <dt className="text-text-subtle">人格</dt>
            <dd className="text-text-muted">{gate.persona}</dd>
            <dt className="text-text-subtle">轮次</dt>
            <dd className="text-text-muted">{gate.rounds}</dd>
            <dt className="text-text-subtle">Meta Tool</dt>
            <dd>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text">
                {gate.meta_tool}
              </code>
            </dd>
          </dl>
          <div className="mt-3 flex items-center gap-4 pt-1 text-caption">
            {gate.docs.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="inline-flex items-center gap-1 font-medium text-text-muted hover:text-primary transition-colors duration-fast"
              >
                <Icon name="arrow-right" size={10} />
                {d.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}
