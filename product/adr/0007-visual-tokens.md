# ADR 0007 · 视觉 Tokens:简洁科技风

**日期:** 2026-04-17  **状态:** Accepted

## Context

视觉风格需要在 v0 固定,避免开发阶段反复。用户选择:**简洁科技风格**,参考 Linear / Cursor / Vercel / Raycast / v0,反面案例 Dify。

## Decision

- **主题**:暗色 default(`#0A0A0A` bg,`#FAFAFA` fg),浅色副选(v1 再加切换)
- **字体**:Geist Sans (UI) + Geist Mono (trace / code)
- **主色**:冷蓝 `#3B82F6`,中性、无 AI 腥
- **状态色**:Tailwind 默认 emerald / amber / rose
- **圆角**:中度(默认 8px,气泡 12px,modal 16px)
- **动效**:克制,仅用于 tool 展开 / 流式 / 确认弹窗
- **密度**:紧凑但不拥挤(Linear 感)

详见 `product/03-visual-design.md`。

## Rationale

- **与参考光谱对齐**:Linear / Cursor 是开发者心目中"专业工具"的视觉 baseline
- **冷蓝主色避免 AI 腥**:与常见的紫 / 渐变 AI UI 区分
- **Geist 与 Shadcn/ui + Tailwind 生态高度兼容**,集成成本低
- **暗色优先**:agent 执行大段 trace / 代码,暗色长时间使用疲劳低

## Consequences

- **浅色主题推后**:可能影响白天使用偏好的用户 → v1 优先级
- **Geist 字体依赖 Vercel font 服务或自托管**→ `next/font/google` 加载,无额外成本
- **Dify 用户迁移心智落差**:Dify 色彩丰富,我们冷静 → 这是差异化,接受

## Alternatives considered

- **赛博朋克 / 霓虹风格** — 否:过度,长时间使用疲劳
- **Notion 风 / 暖白** — 否:与"技术工具"叙事不搭
- **紫色 AI 主色** — 否:烂大街,无记忆点
