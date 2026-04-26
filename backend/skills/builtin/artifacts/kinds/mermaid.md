# kind: mermaid · 简单关系图

## 何时用

- 节点 ≤ 8 个的简单流程 / 类图 / 时序
- 不需要后续手动编辑(用户拿走是为了看,不是为了改)

如果用户要复杂图、要后续编辑、要专业排版 → 用 `drawio` 而不是 mermaid。

## 工具

```
artifact_create({
  name: "<descriptive>.mmd",
  kind: "mermaid",
  content: "graph TD\n  A[开始] --> B[校验]\n  B --> C{通过?}\n  C -->|是| D[完成]\n  C -->|否| E[拒绝]"
})
```

## 何时调用

聊天里直接内联预览(SVG)。轻量 · 没编辑器。

## 调用示例

### graph (流程)

```
graph LR
  user[用户] --> api[API 网关]
  api --> auth[鉴权]
  auth -->|通过| logic[业务逻辑]
  auth -->|拒绝| err[401]
  logic --> db[(数据库)]
```

### sequenceDiagram (时序)

```
sequenceDiagram
  participant U as 用户
  participant F as 前端
  participant B as 后端
  U->>F: 点击登录
  F->>B: POST /login
  B-->>F: token
  F-->>U: 跳转主页
```

### classDiagram (类图)

```
classDiagram
  class User {
    +String name
    +login()
  }
  class Admin {
    +manage()
  }
  Admin --|> User
```

## 工作流

1. 决定图类型 (graph / sequenceDiagram / classDiagram / stateDiagram / erDiagram / gantt)
2. 写 mermaid DSL · 节点名用中文也行(ID 用英文)
3. `artifact_create({kind: "mermaid", ...})`
4. 一句话说图在表达什么

## 常见坑

- ❌ 节点 ID 用中文 → 渲染失败 · ID 必须英文 / 数字 / 下划线
- ❌ 在节点 label 里有 `(` 或 `)` 不转义 → 解析错乱 · 用 `["text(detail)"]`
- ❌ 写超过 10 个节点 → 用 drawio
- ❌ `graph` 写 `direction LR` 在错位置 → 第一行就 `graph LR`

## 失败兜底

| 现象 | 做什么 |
|---|---|
| 渲染空白 | DSL 语法错 · 检查节点 ID / 箭头方向 / 关键字大小写 |
| 节点压在一起 | 加更多换行 · 或换 LR (左右)/ TD (上下)方向 |
| 用户说要复杂的 | 改用 `drawio` |
