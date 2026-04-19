---
id: I-0001
title: Next dev · `.next` chunk 缺失导致客户端不 hydrate · 全站 blank / 永卡 loader
severity: P0
status: in-progress
discovered_at: 2026-04-18
discovered_by: walkthrough
picked_up_at: 2026-04-19
picked_up_by: track-1
affects: web · / · /chat · /employees · /gateway · /skills · /mcp-servers · 所有客户端路由
reproducible: true
blocker_for: plans/2026-04-18-gateway-skill-mcp.md(用户无法亲测交付)· walkthrough-acceptance spec 本身(W1-W7 全部跑不了)
tags: [infra, ui]
---

# I-0001 · Next dev chunks 缺失 · 全站 blank

## Repro

1. 打开 http://localhost:3000/chat(或任何客户端路由)
2. 服务端返回 200 HTML shell(左侧导航可见) · 主面板显示 "正在初始化对话…" 永卡
3. DevTools Network 里看到:`/_next/static/chunks/main-app.js`、`app/chat/page.js`、`app/error.js`、`app/not-found.js`、`app-pages-internals.js` 全部 404
4. 有些路由(`/`、`/gateway`、`/skills`)更惨 · SSR 阶段就 500(`Cannot find module './975.js'` · webpack-runtime 引用的 chunk 在磁盘上不存在)

## Expected

打开任何页面 · React 正常 hydrate · 可交互。

## Actual

- `/chat`、`/employees`、`/mcp-servers`、`/confirmations`、`/traces`、`/settings` · SSR 200 · client JS 404 · 页面 blank 或永卡
- `/`、`/gateway`、`/skills` · SSR 500 · 直接 Server Error 弹窗
- React 根本没 hydrate · 任何按钮点击无效 · 任何 SSE 连接不开

## Evidence

- curl 观测(全路由)`backend 正常 · 前端分裂`:
  ```
  /:500 /chat:200 /employees:200 /gateway:500 /skills:500 /mcp-servers:200
  /confirmations:200 /traces:200 /settings:200
  api/health:200 api/employees:200 (LeadAgent 正常存在)
  ```
- 网络诊断(performance.getEntriesByType('resource') · /chat 页):
  ```json
  [
    {"url":"/_next/static/chunks/main-app.js","status":404},
    {"url":"/_next/static/chunks/app/error.js","status":404},
    {"url":"/_next/static/chunks/app/not-found.js","status":404},
    {"url":"/_next/static/chunks/app-pages-internals.js","status":404},
    {"url":"/_next/static/chunks/app/chat/page.js","status":404}
  ]
  ```
- 500 栈(/ 路由):`Cannot find module './975.js' · Require stack: .next/server/webpack-runtime.js → .next/server/app/_not-found/page.js`

## 根因(命中 E04)

完全对应 [`docs/claude/error-patterns.md § E04 · Next 缓存脏 · dev + build 混用`](../../claude/error-patterns.md)。
表象:webpack-runtime 引用的 chunk id 在磁盘不存在。本项目 `pnpm dev` 和 `pnpm build` 共用 `.next/` · 期间被什么(可能执行端的 Playwright 或 build 步)覆盖过 · dev 的 manifest 坏了。

## 建议修法(E04 钦定)

```bash
pkill -f 'next dev'
rm -rf /Volumes/Storage/code/allhands/web/.next
cd /Volumes/Storage/code/allhands/web && pnpm dev
```

**注意**:沙盒目前**拒**执行这条指令(合理 · 可能打断并行 Claude 的工作)。执行端 Claude 应该在**自己拾起本 issue 时**先 `ps` 核对只有它的 dev 在跑 · 再执行 · 不用问。

## 验收标准

- [ ] 重启 dev 后 · 全站 10 条路由无 500
- [ ] 浏览器 DevTools Network · 任一路由无 `/_next/static/chunks/*.js` 404
- [ ] `/chat` 页不再卡 "正在初始化对话…" · 能显示 Lead 欢迎消息或输入框
- [ ] 回归测试:`web/tests/routes-smoke.test.ts` 的 E04 断言跑绿(该测试已存在 · 见 error-patterns.md)
- [ ] 在本 issue 末尾追加 chrome-devtools MCP 截图证明 · 放 `plans/screenshots/I-0001/after-fix-*.png`

## 相关

- error-patterns:`E04`(已有完整根因 + 修法 + 测试)
- learnings:`L02`(Playwright ≠ 产品验收 · 本 bug 被"只跑 pytest/playwright"的流程漏过)
- 被本 bug 阻塞:`docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md` 整份 spec 的元验收跑不了

---

## 工作记录

_待执行端拾起_
