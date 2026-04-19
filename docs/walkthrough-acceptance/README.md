# Walkthrough Acceptance · North-Star Gate

This directory holds walkthrough-acceptance artefacts per
[`docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md`](../specs/agent-design/2026-04-18-walkthrough-acceptance.md).

Walkthrough acceptance is the **final north-star gate** before handoff to the user. It walks
the live product through **7 main paths** (W1–W7) in a real browser, scores each against the
**6 north-star dimensions** (N1–N6), and **loops fix → re-eval** until the matrix is green or
the user explicitly accepts remaining debt.

## Layout

```
docs/walkthrough-acceptance/
├── README.md                          (this file)
├── TEMPLATE-walkthrough.md            per-path walkthrough + N1-N6 scorecard
├── TEMPLATE-summary.md                iteration summary
└── YYYY-MM-DD/
    └── iter-N/
        ├── W1-walkthrough.md          …W7
        └── summary.md
```

Screenshots land under `plans/screenshots/<plan>/walkthrough-acceptance/iter-N/W{n}/`.

## The 7 main paths

| # | Path | 起点 → 终点 | North-star focus |
|---|---|---|---|
| W1 | Bootstrap · 从零到可用 | 空仓 → provider + model + hello-world chat | N1/N3/N4/N5 |
| W2 | 自建员工(纯对话) | `/chat` → 建员工 → `/employees` | **N1** |
| W3 | 自派任务 | `/chat` → 派任务 → `/tasks` → artifact | N2/N4/N6 |
| W4 | 装 skill | 对话加 skill → 员工技能 +1 | N1/N3 |
| W5 | 装 MCP + 真调 | 接入 filesystem MCP → 员工用 | N3/N5 |
| W6 | 建 trigger + 触发 | 每日 timer → fire_now → run | N4/N6 |
| W7 | 观测 · 失败恢复 | 故意错配 → 错误文案 → 改 → 通 | **N6** |

Order: W1 first · W2 → W3 → (W4‖W5) → W6 → W7 last (W7 intentionally breaks things).

## 6 North-star dimensions

- **N1 对话即操作** — 能在 `/chat` 完成,不必跳独立页
- **N2 一屏决策** — 关键信息密度够,不用翻页
- **N3 测试有效性** — WRITE 走 Gate · BOOTSTRAP 走候选切换
- **N4 关键数值露出** — token / 耗时 / 成本可见
- **N5 测试态 ≡ 生产态** — 测试里通过的员工在生产也通过
- **N6 失败可恢复** — 错误文案指向下一步,能原地改

Each step scored `green` / `yellow` / `red`. Any `red` → P0 Blocker → must fix within the iteration.

## Fix-reeval loop (§ 3.7 · the hardest gate)

Writing a debt list and stopping = 偷工. The loop:

```
Iteration N:
  1. 跑 W1-W7 (fail_fast 模式)
  2. 打分 N1-N6 → verdict (red/yellow/green)
  3. 归档债务 · P0/P1/P2
  4. 立即修 P0 全部 + P1 ≥ 50% · 每条修完 commit
  5. Iteration N+1: 重跑被修过的动线 → 再评
```

Exit when: all `red` = 0, all `yellow` ≤ structural threshold, or user explicitly accepts
remaining debt. Hard cap: **5 iterations**, then file a blocker report.

## Meta Tool

[`allhands.meta.cockpit.run_walkthrough_acceptance`](../../backend/src/allhands/execution/tools/meta/review_tools.py)
— WRITE + `requires_confirmation=True`. Params: `paths` (W1-W7 subset), `loop_until_green`,
`max_iterations` (≤ 5), `auto_fix_p0`, `auto_fix_p1_threshold`, `user_ack_remaining`.

## Cross-reference

- [`2026-04-18-self-review.md`](../specs/agent-design/2026-04-18-self-review.md) — must finish first
- [`2026-04-18-harness-review.md`](../specs/agent-design/2026-04-18-harness-review.md) — optional cool-down before this
- [`product/06-ux-principles.md`](../../product/06-ux-principles.md) — P01-P10 reference
- [`docs/claude/working-protocol.md § 阶段 4.5`](../claude/working-protocol.md) — trigger point
