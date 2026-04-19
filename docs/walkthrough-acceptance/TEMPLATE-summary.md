# Walkthrough Acceptance · YYYY-MM-DD · iter-{I} summary

## Per-path verdict

| Path | Verdict | Red dims | Notes |
|---|---|---|---|
| W1 | green / yellow / red | - / N{n} | <...> |
| W2 | … | … | … |
| W3 | … | … | … |
| W4 | … | … | … |
| W5 | … | … | … |
| W6 | … | … | … |
| W7 | … | … | … |

## Blockers(P0,本轮必修)

- <W{n} step-{k}> — <root cause> — fix commit `<sha>` / **pending**

## 债务(P1/P2,可延)

- P1 · <path>:<finding> · 根因 · 升级判定下轮
- P2 · <path>:<finding> · 连续 3 轮不修自动升 P1

## 迭代统计

- Red count: this iter = N · last iter = M
- Yellow count: N / M
- Fixes committed: X
- Iteration budget used: `{I}` / 5

## 退出判定

- [ ] 所有 W{n} verdict ∈ {green, yellow}
- [ ] 剩余 yellow 全部分类为 P2(polish)
- [ ] 用户显式接受遗留债务(若未全绿)

## 下一步

- 进入 iter-{I+1} · 优先回归修过的 W{n}
- 或 · 写最终交付报告,追加到 `plans/<plan>.md` 末尾 "走查验收包" 节
