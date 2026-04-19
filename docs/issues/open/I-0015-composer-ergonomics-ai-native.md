---
id: I-0015
severity: P0
status: open
title: Composer 布局不符合 AI 原生产品惯例 · 深度思考位置错 · 中止按钮缺失
affects: web/components/chat/Composer · web/app/models(测试对话) · 所有有对话框的页面
discovered: 2026-04-19 / user-product-review
blocker-for: chat UX DoD · model-test DoD · 所有对话入口
tags: ui, ux, product-quality
---

# I-0015 · Composer 布局不符合 AI 原生产品惯例

## 现象

用户在 `/models` 页的模型测试对话框里发现三个硬伤:

1. **深度思考(thinking)toggle 位置错** · 目前在对话框**上方**或**行内** · 应该放在**对话框下方**的控制条里(ChatGPT / Claude / Gemini / DeepSeek / Kimi 一致这么放)
2. **发起(send)按钮位置错/或按钮组不对** · AI 原生产品都是**输入框右侧**单一主按钮(圆形或胶囊形)
3. **中止(stop)按钮不存在** · 模型在流式输出时 · send 按钮要**变形为 stop** · 同一按钮点击即中止流 · 不要另外塞一个 stop 按钮 · 更不要只能等待模型输出完

## 参考(必须对标)

- ChatGPT 主对话:thinking / model picker / attach 在输入框**下沿控制条**;send 按钮在**输入框右侧**;流式输出中 send→stop 图形切换同位置
- Claude.ai 对话:同上 · extended thinking toggle 也在下沿
- DeepSeek Chat:深度思考 R1 toggle 在下沿
- Kimi:同上

## DoD

- [ ] 建或改 `web/components/chat/Composer.tsx`(核心 Composer 组件):深度思考 toggle + model picker(如有)+ attach(如有)放在输入框**下沿 ControlBar**
- [ ] send 按钮固定在输入框**右侧**(或者下沿右端)· 单一按钮
- [ ] 引入 `isStreaming` 状态:false → 发送图形 · true → 停止图形 · 同一按钮 · 点击触发 abort(调用 AbortController · 关闭 SSE EventSource · 或 backend /chat/cancel)
- [ ] backend 支持取消:检查 chat 流有没有 abort 通路 · 没有就加(比如通过 client disconnect detection 或显式 /chat/{run_id}/cancel endpoint)
- [ ] 所有使用 Composer 的地方都切到新版:主对话 · `/models` 测试框 · `/design-lab` 样本 · `/stock-assistant/setup` 里的试验框
- [ ] 视觉纪律:send/stop 按钮严格走 token · 不用 icon 库(用 5 类 1-line SVG 或 mono 字符 → / ■)
- [ ] vitest 覆盖:点击 send 在非 streaming → 调用 onSend · 在 streaming → 调用 onAbort
- [ ] e2e(playwright):输入 → 点 send → 流开始 → 按钮变 stop → 点 stop → 流中断 · 新消息可发

## 验收参考源

看 `docs/claude/reference-sources.md` 的 ref-src-chatgpt-web / ref-src-claude-web(若已登记)· 没有就对比 `chat.openai.com` 和 `claude.ai` 的 composer HTML

## 触发来源

- 2026-04-19 用户产品评审:"深度思考一般是放在对话框下边 · 发起一般是对话框右侧 · 中止是跟发起在一个按钮上 · 发起后进行中的时候点击就可以中止"
