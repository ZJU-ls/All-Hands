# 三级闸门 · 工作流

## 何时调用

用户说「跑 review」「走完闸门」「self-review / walkthrough / harness」 → 这套技能。

## 闸门顺序(强制)

```
self-review  →  walkthrough-acceptance  →  harness-review
   (~1-2h)            (~2-4h)                (~30m + 7d 冷却)
```

任一前序未跑 · 后续就是「垃圾证据」 · 工具会拒。

## 典型用法

1. `cockpit.run_self_review(spec_path, persona="pretty|usable|lovable", round=1|2|3)` — 3 个人格 × 3 轮 · 每轮独立报告
2. self-review 全部 PASS 后 · `cockpit.run_walkthrough_acceptance(spec_path)` — 模拟新用户首次打开 · 给「修-评」反馈
3. walkthrough 完成且至少冷却 7 天后 · `cockpit.run_harness_review(spec_path, step="docs-drift|fix|fresh-eyes")` · 三步走

## 调用示例

```
# 完整一轮(用户说「跑完三道闸」)
spec = "docs/specs/2026-04-25-progressive-skill-packs.md"

# Stage 1: self-review · 3 persona × 3 round
for persona in ["pretty", "usable", "lovable"]:
    for round in [1, 2, 3]:
        cockpit.run_self_review(spec_path=spec, persona=persona, round=round)
# 全部 PASS 后才能进 Stage 2

# Stage 2
cockpit.run_walkthrough_acceptance(spec_path=spec)
# 完了等用户冷却 7 天再 Stage 3

# Stage 3 三步
cockpit.run_harness_review(spec_path=spec, step="docs-drift")
cockpit.run_harness_review(spec_path=spec, step="fix")
cockpit.run_harness_review(spec_path=spec, step="fresh-eyes")
```

## 常见坑

- `spec_path` 是 `docs/specs/` 下的 .md 路径 · 不要传整个目录
- persona 写错(比如 "pretty3")会被工具 422 拒
- harness step=fresh-eyes 假定真冷却过 7 天 · 它会自己检查最近 commit 时间
- 两轮闸门间不要并行 · 评估报告会互相污染

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `run_self_review` 报 "spec_path not found" | 路径必须 docs/specs/ 起,例:`docs/specs/2026-04-25-foo.md` |
| `run_walkthrough_acceptance` 拒因「self-review 未完成」 | 拉 self-review 历史看哪一轮没跑 / 没 PASS 补齐 |
| `run_harness_review` step=fresh-eyes 报「冷却不足」 | spec 太新 · 等 7 天 · 或先把别的 spec 推过这一道 |
