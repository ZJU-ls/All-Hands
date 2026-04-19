"use client";

import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";

type ReviewGate = {
  id: string;
  title: string;
  persona: string;
  rounds: string;
  duration: string;
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
        <div className="max-w-4xl mx-auto px-8 py-10 space-y-8">
          <header className="space-y-2">
            <h2 className="text-xl font-semibold">Review · 3 级交付闸门</h2>
            <p className="text-sm text-text-muted">
              这 3 个闸门把 spec 从&ldquo;写完了&rdquo;推到&ldquo;可以交给用户&rdquo;。每个都有独立的人格、产物和退出条件。
              点下面的 Meta Tool 名称,可以在对话里让 Lead 触发(需确认)。
            </p>
            <p className="text-xs text-text-subtle">{ORDER_NOTE}</p>
          </header>

          <ul className="space-y-4">
            {GATES.map((g) => (
              <li
                key={g.id}
                className="border border-border rounded-md bg-surface p-5 space-y-3"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="text-base font-semibold">{g.title}</h3>
                  <span className="font-mono text-[11px] text-text-subtle">
                    {g.duration}
                  </span>
                </div>
                <dl className="grid grid-cols-[90px_1fr] gap-x-4 gap-y-1 text-[12px]">
                  <dt className="text-text-subtle">人格</dt>
                  <dd className="text-text-muted">{g.persona}</dd>
                  <dt className="text-text-subtle">轮次</dt>
                  <dd className="text-text-muted">{g.rounds}</dd>
                  <dt className="text-text-subtle">Meta Tool</dt>
                  <dd>
                    <code className="font-mono text-[11px] text-text bg-surface-2 px-1.5 py-0.5 rounded">
                      {g.meta_tool}
                    </code>
                  </dd>
                </dl>
                <div className="flex items-center gap-3 pt-1 text-[12px]">
                  {g.docs.map((d) => (
                    <Link
                      key={d.href}
                      href={d.href}
                      className="text-text-muted hover:text-text transition-colors duration-base"
                    >
                      {d.label} →
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <footer className="border-t border-border pt-6 text-[12px] text-text-subtle space-y-1">
            <p>
              触发 Meta Tool 走 Confirmation Gate · 所有 WRITE 工具都需要用户显式确认。
            </p>
            <p>
              规则引擎(Round 1 mechanical checks)运行方式 ·{" "}
              <code className="font-mono text-[11px]">./scripts/review/lint-rules.sh</code>
            </p>
            <p>
              Harness Step 1 docs drift draft ·{" "}
              <code className="font-mono text-[11px]">./scripts/harness/audit-docs.sh</code>
            </p>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}
