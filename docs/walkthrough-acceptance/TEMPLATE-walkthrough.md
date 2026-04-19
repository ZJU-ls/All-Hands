# W-{N} · {path name} · iter-{I}

**起点** <page / state>
**终点** <page / state>
**date / commit** YYYY-MM-DD · `<sha>`

## 步骤

| 步 | 动作 | 截图 | 预期 | 实际 | N 踩红? |
|---|---|---|---|---|---|
| 1 | `click` <selector> | `00-empty-state.png` | <...> | ✅ / ❌ | - |
| 2 | `fill` <text> | `01-...png` | <...> | ✅ / ❌ | - |
| 3 | observe tool-call card | `02-...png` | <...> | ✅ / ❌ | N3 red if WRITE 未过 Gate |
| … | | | | | |

## N1-N6 scorecard

- **N1 对话即操作**: Green / Yellow / Red · <rationale>
- **N2 一屏决策**: <verdict> · <rationale>
- **N3 测试有效性**: <verdict> · <rationale>
- **N4 关键数值露出**: <verdict> · <rationale>
- **N5 测试态 ≡ 生产态**: <verdict> · <rationale>
- **N6 失败可恢复**: <verdict> · <rationale>

## 本轮自修(P0 必修 + P1 ≥ 50%)

- [x] <fix description> · commit `<sha>`
- [ ] <fix pending> · 待下轮

## 本轮未修(债务 → 下轮升 P0 or 用户明确接受)

- <debt 1> · priority P1 · 根因:<组件/DTO/API/tool 缺>
- <debt 2> · priority P2 · 根因:<文案/留白/微动效>

## 截图 / 证据索引

- `plans/screenshots/<plan>/walkthrough-acceptance/iter-{I}/W{N}/`
- console log: `console.log`
