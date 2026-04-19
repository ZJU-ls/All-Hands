# allhands · Open Issues Index

> 只列 `status ∈ {open, in-progress, blocked}` 的 issue。
> `closed` 的在 `closed/` 目录 · 不再出现在此表。
> **新建 / 关闭 issue 必须同步更新本表。**

最后更新:2026-04-18

---

## 现役清单

| ID | Severity | Status | Title | Affects | Discovered | Blocker-for | Tags |
|---|---|---|---|---|---|---|---|
| [I-0002](open/I-0002-model-context-window-zero.md) | P2 | open | `qwen3.6-plus` context_window=0 · 前端显示异常 / Agent token 预算失效 | backend(models seed) + web(settings) | 2026-04-18 / api-probe | — | backend, data |
| [I-0003](open/I-0003-provider-default-model-dangling.md) | P2 | open | Provider `百炼` default_model=`glm-5` · 但库里只有 `qwen3.6-plus` · 悬空引用 | backend(providers seed) | 2026-04-18 / api-probe | — | backend, data |

---

## 分布

| 维度 | 数量 |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 2 |
| **open** | 2 |
| **in-progress** | 0 |
| **blocked** | 0 |

---

## 使用说明

**执行端 Claude** · 在以下时机扫本表(细则见 [`docs/claude/bug-fix-protocol.md`](../claude/bug-fix-protocol.md)):

1. **每个 task commit 前** · 若 P0 清单非空 → 必须先修 P0
2. **每天第一个 commit 前** · 若 P1 清单非空 → 当日至少清 1 条
3. **关闭 plan 前** · P0 / P1 清单必须全空

**发现新 bug 的流程:**

1. `cp docs/issues/TEMPLATE.md docs/issues/open/I-<NNNN>-<slug>.md`
2. 填正文(repro + expected + actual + evidence)
3. 追加到本表末尾
4. commit:`docs(issues): I-<NNNN> <一句话>`

**关闭 issue 的流程:**

1. 修复代码 + 回归测试 · commit
2. issue 末尾追 `## 关闭记录` · 填 sha + 测试名
3. `mv open/I-<NNNN>-*.md closed/`
4. 本表里**删掉该行**(closed 不在本表露出)
5. commit:`fix(I-<NNNN>): <一句话> + 回归测试 <test_name>`

---

## 历史

- 2026-04-18 · 初建 · 录入 I-0001(E04 chunks blank)· I-0002(context_window=0)· I-0003(default_model 悬空)
- 2026-04-19 · 关闭 I-0001(E04 复发实例 · track-1 拾起 · dev 冷启 + routes-smoke 31/31 绿)
