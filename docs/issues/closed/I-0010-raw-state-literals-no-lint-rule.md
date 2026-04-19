---
id: I-0010
title: Raw "Loading…" / "Error" / "No data" literals across app · no ESLint rule enforces
severity: P1
status: closed
discovered_at: 2026-04-19
closed_at: 2026-04-19
discovered_by: track-2-qa audit
affects: web/** · visual-upgrade DoD
reproducible: true
blocker_for: visual-upgrade DoD ("裸 Loading/Error/No data grep = 0")
tags: [ui, visual, lint]
---

# I-0010 · Raw state literals + no ESLint rule to prevent regression

## Repro

1. `rg -n "Loading\\.\\.\\.|No data|No data\\." web/app web/components` — non-zero hits
2. `cat web/.eslintrc.json` — only extends `next/core-web-vitals` + `next/typescript`; no rule forbids the literals.

## Expected

Same spec as I-0007 but aimed at the enforcement mechanism rather than the missing components. The visual-upgrade DoD asks for a grep-zero assertion to prevent regressions after the initial sweep.

## Actual

Even after I-0007 is fixed (components built), nothing stops a new commit from re-introducing a raw `"Loading..."` literal.

## Suggested fix

1. Add an ESLint rule via `no-restricted-syntax` or a tiny custom rule that bans `JSXText | StringLiteral` matching `/^(Loading\.?\.?\.?|Error|No data)\.?$/` outside `components/state/**` and story/test files.
2. Or, keep it as a vitest static-contract test in `web/tests/error-patterns.test.ts` (cheaper, same effect).
3. Wire the failure message to point at `components/state/*` as the right solution.

## Acceptance criteria

- [x] Rule implemented (ESLint OR vitest — pick one) · **both** landed (belt + suspenders)
- [x] CI fails on introducing a new raw literal
- [x] Existing offenders are either migrated (preferred) or explicitly waived with a per-line comment

## Related

- tied to I-0007 (the state components must exist before enforcement is meaningful)
- spec: `docs/specs/agent-design/2026-04-18-visual-upgrade.md § DoD`

## 关闭记录

- status: closed
- closed_at: 2026-04-19 (Track H)
- fix:
  - `web/.eslintrc.json` — `no-restricted-syntax` override scoped to `app/**/*.tsx` + `components/**/*.tsx` · excludes `app/design-lab/**` · `components/state/**` · tests. JSXText selector catches the 5 literal shapes (加载中 / Loading... / Loading… / 暂无{数据,消息,活动} / No data). Error message points contributors at `@/components/state`.
  - `web/tests/no-raw-state-literal.test.ts` — vitest mirror of the same regex so CI still fails if eslint is bypassed. Respects per-line `// eslint-disable-next-line no-restricted-syntax` waivers and asserts `.eslintrc.json` registration itself.
  - 全量扫荡 17 个文件(详见 Track H 的 sweep commit):`app/employees/page.tsx` · `app/employees/[employeeId]/page.tsx` · `app/conversations/page.tsx` · `app/tasks/page.tsx` · `app/tasks/[id]/page.tsx` · `app/skills/page.tsx` · `app/channels/page.tsx` · `app/channels/[id]/page.tsx` · `app/triggers/page.tsx` · `app/triggers/[id]/page.tsx` · `app/mcp-servers/page.tsx` · `app/market/page.tsx` · `app/market/[symbol]/page.tsx` · `app/observatory/page.tsx` · `app/gateway/page.tsx` · `components/chat/ConversationHeader.tsx`(保留 inline placeholder + per-line waiver,理由:单行 flex 13 px header 放不下 LoadingState 卡片)· `components/cockpit/ActivityFeed.tsx`(`emptyHint` → `emptyTitle` 语义对齐)。
  - 被动 `data-testid` 全部保留(`tasks-loading` / `skills-loading` / `channels-loading` / `triggers-loading` / `detail-loading` / `mcp-servers-loading` / `gateway-loading` / `providers-loading`),现有 route smoke 测试无改动即过。
- regression tests:
  - `web/tests/no-raw-state-literal.test.ts` — 86 用例(目录递归 + 文件级)+ 配置注册断言。`pnpm test` 通过。
  - `pnpm lint` 通过(next lint 承接 `.eslintrc.json` 的 `no-restricted-syntax`)。
  - `./scripts/check.sh` 全绿(web 640 / backend 769 + 7 xfail / 3 import-linter 契约)。
