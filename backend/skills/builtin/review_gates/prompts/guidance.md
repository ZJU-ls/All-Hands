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

## 常见坑

- spec_path 是 docs/specs/ 下的 .md 路径 · 不要传整个目录
- persona 写错(比如 "pretty3")会被工具 422 拒
- harness step=fresh-eyes 假定真冷却过 7 天 · 它会自己检查最近 commit 时间
