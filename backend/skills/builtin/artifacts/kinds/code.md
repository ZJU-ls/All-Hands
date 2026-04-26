# kind: code · 可下载代码片段

## 何时用

- 用户说「给我代码 / 脚本 / 配置文件 / 一段 X 实现」
- 用户要拿到本地跑或集成到自己的项目
- 单文件 / 少量文件就能讲清楚的事

不是用来说"这是怎么做的代码示例" —— 那种在 markdown / chat 里贴 code block 就够了。kind=code 的语义是**这是用户的产出物**。

## 工具

```
artifact_create({
  name: "fetch_users.py",
  kind: "code",
  content: "import httpx\n\nasync def fetch_users():\n    ...",
  mime_type: "text/x-python",   # 可选 · 默认从扩展名推
  description: "<一句话>"
})
```

## 文件名 + mime_type

文件名带扩展名(`.py` / `.ts` / `.go` / `.sh` / `.sql`)→ 自动正确语法高亮。**不要**叫 `code.txt`。

## 内联预览策略

- ≤ 200KB → 聊天里语法高亮代码块
- > 200KB → 卡片提示 · 用户去制品区看 / 下载

## 工作流

1. 写完整可运行代码
2. 文件名描述用途(`backup_db.sh` / `weekly_report.py`)
3. `artifact_create({kind: "code", ...})`
4. 一句话说这段代码做什么 · 怎么跑

## 常见坑

- ❌ 一份制品塞多文件(`# file1: ...` 标记)→ 用户没法直接保存 · 多文件分多个 artifact
- ❌ 代码里硬编码用户的 API key → 用环境变量 + 注释
- ❌ 没写依赖 → 在文件顶部注释(`# requires: pip install httpx`)

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 没语法高亮 | 文件名加扩展名 · 或显式传 mime_type |
| 文件超大 | 拆分成多个 artifact 或换 markdown 描述 + 主代码片段 |
