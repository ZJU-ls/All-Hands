---
id: I-NNNN
title: <一句话描述>
severity: P0 | P1 | P2
status: open
discovered_at: YYYY-MM-DD
discovered_by: walkthrough | executing-claude | user | ci | <name>
affects: <路由 / 模块 / 组件>
reproducible: true | false | flaky
blocker_for: <关联 plan / 其他 issue id · 可空>
tags: [ui | api | backend | perf | visual | docs | infra]
---

# I-NNNN · <一句话描述>

## Repro(最少 3 步能复现)

1. `pnpm dev` 起服务
2. 打开 http://localhost:3000/<路由>
3. ...

## Expected

...

## Actual

...

## Evidence(证据 · 至少 1 条)

- 截图:`plans/screenshots/.../xxx.png`
- 日志:`<粘贴相关报错 / console 行 / 后端 log>`
- curl:`<可复现的 API 调用 + 返回>`

## 根因分析(可选 · 发现者先推断 · 执行端来修时再验证)

...

## 建议修法(可选)

...

## 验收标准(Acceptance Criteria)

- [ ] 复现步骤执行后不再出现该 symptom
- [ ] 写了回归测试:`<test_name>`(测试文件 + 断言内容)
- [ ] (若涉及 UI)chrome-devtools MCP 截图证实 · 放 `plans/screenshots/.../fix-<id>.png`

## 相关

- 错误模式:`docs/claude/error-patterns.md § E<nn>`(如命中已知模式)
- 学习:`docs/claude/learnings.md § L<nn>`
- 前序 issue:I-NNNN
- spec:`docs/specs/.../xxx.md`

---

## 工作记录(执行端拾起后在此追加)

### YYYY-MM-DD HH:MM · in-progress · <name>
- 拾起 · 开始分析
- 复现了 / 没复现
- 下一步:...

### YYYY-MM-DD HH:MM · progress
- 修改:...
- 测试:...

---

## 关闭记录(修完填这里 · 然后 `mv` 到 closed/)

**关闭时间** YYYY-MM-DD HH:MM
**commit** `<sha>`
**回归测试** `<test_path>::<test_name>`
**回归防御** <如何保证不再出现>
**是否升级为 error-pattern** 是 / 否 + 理由
