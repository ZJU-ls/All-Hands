# 图片创作 · allhands.image-creator

你激活了图片创作技能。这意味着用户想要 **AI 生成的图片** —— 不是流程图(用 drawio)· 不是图标(用 emoji / svg)· 是真正的视觉内容(插图 · 配图 · 设计稿)。

## 决策树:何时该生图

| 用户在说 | 是否生图 | 理由 |
|---|---|---|
| "画个 X" / "生成一张 X 的图" / "给这个 PPT 配图" | ✅ 直接生 | 明确诉求 |
| "做一个介绍 X 的 PPT" | ✅ 主动配图(每页 1 张) | 演示文档默认带图更专业 |
| "写一篇关于 X 的 markdown 文档" | ⚠️ 看上下文 · 长文 + 主题视觉化强 → 1-3 张 hero / section 图 | 不要每段都塞图 |
| "做一个流程图 / 时序图 / 架构图" | ❌ 用 drawio / mermaid | AI 生图不擅长抽象示意 |
| "代码截图 / 图标 / logo / favicon" | ❌ 别接 | 走专门工具 / 让用户提供 |

## 工作循环(关键 · 一次 batch · 不要串行)

```
1. 写大纲(列出每张图的"主题 + 风格 + 构图")
2. 一次 generate_image(prompts=[...全部prompts...])
   - 内部 asyncio.gather 并发 · 6 张约 15-25s
   - 别一张一张串调 (60s+ · 烧 token)
3. 拿到 [{artifact_id, url}, ...]
4. 用这些 url 组装 markdown / pptx artifact
   - markdown: ![alt](/api/artifacts/<id>/content)
   - pptx slide: image_url: "/api/artifacts/<id>/content"
```

## 怎么写好 prompt(影响 80% 效果)

每个 prompt 至少含 **三要素**:

1. **主体**(画什么):"一只蓝色的猫" / "量子计算芯片"
2. **风格**(怎么画):"扁平插画" / "赛博朋克未来感" / "水彩淡雅" / "极简扁平科技风"
3. **构图 / 环境**(在哪 · 什么角度):"居中 · 渐变背景" / "桌面俯视 · 蓝紫光晕"

**反例(模糊):** "AI 的图"
**正例(具体):** "扁平插画风 · 一个发光的人脑神经网络 · 中心居中 · 深蓝色渐变背景 · 简洁现代 · 适合作 PPT 标题页配图"

英文 prompt 通常比中文效果好(模型训练数据偏英文) · 但中文也能用。

## 一次性 batch 的力量(实际数据)

| 场景 | 串行 | batch(并发) |
|---|---|---|
| 6 张 PPT 配图 | ~ 90 秒 | ~ 18 秒(快 5 倍) |
| 4 张文章 hero 图 | ~ 60 秒 | ~ 15 秒 |
| 单张快图 | 12-15 秒 | 同上(无并发收益) |

**永远先列完所有 prompt 再调一次 generate_image。** 不要"先画一张看看"再画一张 —— 那样你永远只能串行。

## 成本意识

调用前会弹 confirmation 显示估算成本(基于 model · quality · size · n)。典型:

- gpt-image-1.5 medium 1024² · $0.04 / 张 · 6 张 = $0.24
- gpt-image-1.5 high 1024² · $0.16 / 张 · 6 张 = $0.96(贵 4x · 用户没明说要"高清"就用 medium)
- DashScope wanx · ¥0.20 / 张 · 6 张 = ¥1.20

默认 quality = auto(provider 选 medium)· 用户说"高清 / 海报级" 才升 high。

## 失败处理

| 现象 | 怎么办 |
|---|---|
| 单张失败(返回 error envelope) | 整个 batch 其他张已落库 · 只重试这一张 · 别重跑全部 |
| HTTP 401 | api_key 配错 · 让用户去 /settings/providers 检查 |
| HTTP 400 + moderation | prompt 触发审核 · 改写 prompt 移除敏感词重试 |
| HTTP 404 model not found | 让用户去 /settings/providers/<id> 检查模型名 |
| 尺寸超 20MB | 降 quality / size 重生 |

## 工作流示例

**用户:** "做一个 4 页关于'秋天'的 PPT · 每页配图"

**你的步骤:**

```
1. 拟大纲:
   - p1 标题页:"秋天的诗意"   prompt: "水彩风 · 金黄银杏叶飘落 · 暖橙渐变背景 · 简洁居中 · 标题页配图"
   - p2 落叶:"层林尽染"       prompt: "广角风景 · 红黄秋林 · 山脉远景 · 摄影感 · 暖色调"
   - p3 收获:"金色丰收"       prompt: "扁平插画 · 麦田 + 南瓜 + 苹果 · 阳光氛围 · 现代极简"
   - p4 静思:"独行小路"       prompt: "古典油画风 · 林间小径 · 夕阳 · 一个人背影"

2. 调 generate_image({
     prompts: [上面 4 个],
     size: "1024x1536",      # 竖版更适合 PPT 右侧配图
     quality: "auto",
   })
   → 弹 confirmation: "将生 4 张图 · 估 $0.16 · 允许?"
   → 用户允许 → 18 秒后回 4 个 artifact_id

3. 调 artifact_create_pptx({
     slides: [
       {layout: "title", title: "秋天的诗意", image_url: "/api/artifacts/abc-1/content"},
       {layout: "image-right", title: "层林尽染", image_url: "/api/artifacts/abc-2/content", bullets: [...]},
       {layout: "image-right", title: "金色丰收", image_url: "/api/artifacts/abc-3/content", bullets: [...]},
       {layout: "image-right", title: "独行小路", image_url: "/api/artifacts/abc-4/content", bullets: [...]},
     ]
   })

4. 把 PPT 的 artifact_id 给用户 + 简要说明
```

记住:**先列 → 一次 batch → 拼装。** 这是生产力 5x 的关键。
