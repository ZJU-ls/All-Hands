# kind: image · 图片(base64)

## 何时用

- 你已经有一张图(模型多模态生成 / 用户提供 / 网络获取的截图)
- 要把它沉淀成可下载的制品
- **注意:你不是图片生成模型** —— 这个 kind 只是"封装"已有的二进制

如果用户说「画个图」(意思是流程图 / 时序图)→ 用 `drawio` 不是 image。

## 工具

```
artifact_create({
  name: "screenshot.png",
  kind: "image",
  content_base64: "iVBORw0KGgoAAAANSUhEUgA...",
  mime_type: "image/png",        # 必填 · 推断不出来
  description: "<一句话>"
})
```

`content_base64` 是图片**文件**的 base64,不是 data URL(不要 `data:image/png;base64,` 前缀)。

## 支持格式

png / jpeg / webp / gif / svg。20MB 上限。

## 内联预览策略

聊天里直接 `<img>` 显示。所有 image 都内联。

## 工作流

1. 拿到图片 bytes
2. base64 编码(去掉 data URL 前缀如有)
3. `artifact_create({kind: "image", content_base64, mime_type})`

## 常见坑

- ❌ `content_base64` 带了 `data:image/png;base64,` 前缀 → 落库后渲染坏
- ❌ mime_type 没填 → 默认按 binary 处理 · 浏览器不知道怎么展示
- ❌ 上传 PDF / docx 用 image kind → 错 kind · 用对应的专属 kind

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 图显示 broken image icon | mime_type 不对 · 检查 png/jpeg/webp |
| size 超 20MB | 压缩(jpeg quality 80% / 缩放) · 或拆图 |
