# Round {N} · {好看|好用|爱不释手} · Findings · YYYY-MM-DD

> Copy this file to `YYYY-MM-DD-round-{N}.md` and fill in. Delete this blockquote before committing.
>
> **Persona lock** — do not merge with the other two rounds.
> - Round 1: Linear-Precise gatekeeper. Only "does it feel like one system?" matters.
> - Round 2: new-user PM. Only "can I do the main flow in ≤ 3 clicks?" matters.
> - Round 3: jaded power user. Only "is there a reason to come back?" matters.

## Collection

- commit / branch under review: `<sha>`
- screenshot corpus: `plans/screenshots/<plan>/{full-page,flows,polish}/`
- rule-engine run (Round 1 only): `./scripts/review/lint-rules.sh`
- flow script (Round 2 only): `tests/e2e/review/round-2-flows.spec.ts`
- edge data (Round 3 only): `plans/screenshots/<plan>/polish/{empty,error,loading,extreme}.png`

## P0 · 破纪律 / 动线不通 / 丢魂 · 必修

- [ ] `<path>:<line>` — <one-line> · 违反 <rule> · 证据:<screenshot | log ref>
- [ ] ...

## P1 · 质量差 · 该修(本轮目标 ≥ 3 survived)

- [ ] `<path>:<line>` — <one-line> · 证据:<...>
- [ ] ...

## P2 · 小瑕疵 · 可 skip(下轮升级判定:Round 3 连续 3 轮不修自动升 P1)

- [ ] `<path>:<line>` — <one-line>
- [ ] ...

## 修缮记录

| Finding | 处理 | Commit | Verify |
|---|---|---|---|
| P0-① | 已修 | `<sha>` | screenshot after/... |
| P0-② | 待修 | - | - |
| P1-① | deferred 至下轮 | - | 理由:<...> |

## 退出条件(自检前打勾)

- [ ] P0 = 0
- [ ] P1 ≤ 3(Round 1)/ ≤ 5(Round 2)/ 自定(Round 3)
- [ ] `./scripts/check.sh` 全绿
- [ ] 至少 1 条 P0 修复有 before/after 截图证据
- [ ] Round 3 only: 保留 ≥ 3 条未被修掉的"惊喜瞬间"(§ 5.5)

---

**下一步** · 跑 `./scripts/check.sh` → 提交 `feat(round-{N}): ...` → 进入下一轮(或写 summary)。
