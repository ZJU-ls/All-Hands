"use client";

/**
 * Preset 单选 · Phase 3B 才启用(I-0022 Track M 交付
 * docs/specs/agent-runtime-contract.md 之后)。此处渲染为 disabled 占位,
 * 保证视觉完整,并显式标注"等 Track M 契约"。
 *
 * §3.2 红线:preset **不落 mode 字段**,保存时展开为
 * tool_ids[] + skill_ids[] + max_iterations。当前占位仅展示,不回写 state。
 */

type Preset = "execute" | "plan" | "plan_with_subagent";

const OPTIONS: Array<{ id: Preset; label: string; caption: string }> = [
  { id: "execute", label: "Execute", caption: "执行型 · 基础 tools + 10 轮" },
  { id: "plan", label: "Plan", caption: "计划型 · sk_planner · 3 轮" },
  {
    id: "plan_with_subagent",
    label: "Plan + Subagent",
    caption: "计划+子代理 · 挂载 spawn_subagent · 20 轮",
  },
];

export function PresetRadio() {
  return (
    <div className="rounded-md border border-dashed border-border p-4 bg-surface-2/30">
      <div className="flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <label
            key={o.id}
            className="flex items-start gap-3 opacity-60 cursor-not-allowed"
          >
            <input
              type="radio"
              name="preset"
              data-testid={`preset-${o.id}`}
              disabled
              className="mt-0.5 accent-primary"
            />
            <div>
              <div className="text-[12px] font-medium text-text">{o.label}</div>
              <div className="text-[11px] text-text-muted">{o.caption}</div>
            </div>
          </label>
        ))}
      </div>
      <p
        data-testid="preset-locked-notice"
        className="mt-3 font-mono text-[10px] uppercase tracking-wider text-text-subtle"
      >
        等 Track M 契约 · docs/specs/agent-runtime-contract.md(I-0022)
      </p>
    </div>
  );
}
