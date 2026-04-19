# 制品区 Skill · `allhands.artifacts` Spec

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**依赖 spec** [2026-04-18-viz-skill.md](./2026-04-18-viz-skill.md)(v0 下 viz 必须先落)
**并列 spec** [2026-04-18-employee-chat.md](./2026-04-18-employee-chat.md)
**动手前必读** [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · 按本 spec § 13.5 对照 `ref-src-claude`(Claude Code 的 Edit/Write 工具的 diff confirmation · TodoWrite/Task 的 prompt 写法 · IRREVERSIBLE 操作的 UX)

---

## 0 · TL;DR

- **制品**(artifact)= agent 产出的、有长期价值、能独立预览 / 修改 / 下载的产物
- 内置 skill `allhands.artifacts`:一组 CRUD + render 工具,让任何员工可以产、改、读、删制品
- 专门的 **制品区 UI 面板**(右侧,与聊天并列)展示 workspace 内所有制品
- v0 支持:markdown · code · html · image · data · mermaid;v1 加 drawio · pptx · video

---

## 1 · 问题陈述

"**人驱动一支 AI 团队**" 这个定位里,对话只是**过程**,**产出**才是用户要的成果。对话结束后用户想要:

- 回头找上周的报告 → 需要一个可列可搜的制品清单
- 基于已有稿子继续迭代 → 需要版本化修改
- 下载 / 分享某个 artifact → 需要独立的文件化形态
- 让 agent "读一下昨天的策划稿再写" → 需要 agent 能主动读取历史制品

今天整个平台里 **没有制品概念**。所有产出要么埋在对话 markdown 里,要么在文件系统里散落,无法被 agent / 用户结构化管理。

---

## 2 · 原则

### 2.1 制品 ≠ 消息

**消息** 是对话轨迹(immutable,按时间线)。
**制品** 是可被多次修改、有版本、可被多对话共享的实体(mutable,按 id 寻址)。
两者分开存。制品通过 `created_by_run_id` 软关联到某次对话,但制品一旦生成,生命周期独立。

### 2.2 同一套 skill,多种 kind

不同 kind(markdown / image / code / drawio...)的 artifact 统一通过同一套 CRUD 工具操作,内部根据 kind 决定:
- 存储方式(DB text vs 文件系统)
- 渲染引擎(markdown-it / Monaco / iframe / drawio viewer)
- 是否支持 diff(text kinds 支持,binary kinds 不支持)

### 2.3 agent 可写 · 用户可看 · 默认触发确认

- create:WRITE · 无 confirmation(低风险,新建不破坏已有)
- update:WRITE · **有 confirmation**(会覆盖已有作品;diff 预览)
- delete:IRREVERSIBLE · **有 confirmation**(即便是软删)

---

## 3 · 数据模型

### 3.1 L4 domain · `core/artifact.py`(新)

```python
from enum import StrEnum

class ArtifactKind(StrEnum):
    MARKDOWN = "markdown"
    CODE     = "code"
    HTML     = "html"
    IMAGE    = "image"
    DATA     = "data"        # JSON / CSV
    MERMAID  = "mermaid"
    DRAWIO   = "drawio"      # v1
    PPTX     = "pptx"        # v1
    VIDEO    = "video"       # v1

TEXT_KINDS   = {MARKDOWN, CODE, HTML, DATA, MERMAID}
BINARY_KINDS = {IMAGE, DRAWIO, PPTX, VIDEO}

class Artifact(BaseModel):
    id: str
    workspace_id: str                    # v0 = "default"
    name: str                            # 非唯一;用户友好
    kind: ArtifactKind
    mime_type: str                       # 便于下载 / 内容协商
    content: Optional[str]               # TEXT_KINDS 直接存
    file_path: Optional[str]             # BINARY_KINDS 存路径(相对 artifacts/)
    size_bytes: int
    version: int                         # 每次 update +1
    pinned: bool = False
    deleted_at: Optional[datetime] = None   # 软删
    created_by_run_id: Optional[str] = None
    created_by_employee_id: Optional[str] = None
    conversation_id: Optional[str] = None   # 产出来源
    created_at: datetime
    updated_at: datetime
    metadata: dict = {}

class ArtifactVersion(BaseModel):           # 历史版本
    id: str
    artifact_id: str
    version: int
    content: Optional[str]
    file_path: Optional[str]
    diff_from_prev: Optional[str]
    created_at: datetime
```

### 3.2 L3 persistence

新增两张表,migration `0004_add_artifacts.py`:

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content TEXT,
  file_path TEXT,
  size_bytes INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  pinned BOOLEAN NOT NULL DEFAULT 0,
  deleted_at TIMESTAMP,
  created_by_run_id TEXT,
  created_by_employee_id TEXT,
  conversation_id TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  metadata JSON NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_artifacts_workspace ON artifacts(workspace_id, deleted_at);
CREATE INDEX idx_artifacts_conversation ON artifacts(conversation_id);
CREATE INDEX idx_artifacts_kind ON artifacts(kind);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT,
  file_path TEXT,
  diff_from_prev TEXT,
  created_at TIMESTAMP NOT NULL,
  UNIQUE(artifact_id, version)
);
```

### 3.3 文件存储

二进制制品落盘在 `backend/data/artifacts/<workspace_id>/<artifact_id>/v<N>.<ext>`。`file_path` 存相对路径。v0 本地文件系统;v1 换对象存储。

---

## 4 · 工具清单(注册在 `allhands.artifacts` skill)

| Tool ID | Scope | Confirmation | 作用 |
|---|---|---|---|
| `allhands.artifacts.create` | WRITE | no | 新建 artifact。参数:`name, kind, content`(text kinds)或 `content_base64 + mime_type`(binary)。返回 `artifact_id, version` |
| `allhands.artifacts.list` | READ | — | 列制品。参数:`kind?, name_prefix?, pinned?, limit?, include_deleted?` |
| `allhands.artifacts.read` | READ | — | 读内容给 agent(binary 返回 base64 + 限制大小) |
| `allhands.artifacts.render` | READ | — | 返回 RenderPayload `Artifact.Preview`,在聊天里嵌入预览(不占 agent prompt token) |
| `allhands.artifacts.update` | WRITE | **yes + diff 预览** | `mode: patch`(text kinds:统一 diff 格式)或 `mode: overwrite`。版本 +1,旧版归档 |
| `allhands.artifacts.delete` | IRREVERSIBLE | **yes** | 软删(set deleted_at)。30 天内可 `undelete`(v1) |
| `allhands.artifacts.pin` | WRITE | no | 置顶 / 取消置顶 |
| `allhands.artifacts.search` | READ | — | 全文搜索(text kinds,走 SQL LIKE;v1 上 FTS) |

**特殊点**:
- `render` 不返回内容给 agent,只返回 `{component: "Artifact.Preview", props: {artifact_id, version}}`。前端拿到自己去 `GET /api/artifacts/{id}/content` 渲染。**设计意图:防止 agent 的 prompt 被大制品撑爆。**
- `update` 的 `patch` 模式:text kinds 用标准 unified diff,后端 apply;binary kinds 不支持 patch,强制 overwrite。

---

## 5 · API 层(新)

新增 router `backend/src/allhands/api/routers/artifacts.py`。**仅只读 + 下载**,写操作一律走 Meta Tool(符合 CLAUDE.md § 3.1 Tool First):

| Method | Path | 用途 |
|---|---|---|
| GET  | `/api/artifacts` | 列(查询串支持 filter) |
| GET  | `/api/artifacts/{id}` | 元信息 |
| GET  | `/api/artifacts/{id}/content` | 原始内容(text inline,binary 下载) |
| GET  | `/api/artifacts/{id}/versions` | 版本列表 |
| GET  | `/api/artifacts/{id}/versions/{v}/content` | 某历史版本内容 |

**注意**:符合 L01 规则 —— agent-managed 资源没有 REST 写端点,写走 Meta Tool。

---

## 6 · 前端(制品区面板)

### 6.1 路由 / 挂载

- 制品区作为 `ChatShell` 的右侧面板(见 employee-chat spec § 4.2)
- 可切换三态:隐藏 · 并排(对话 70% / 制品 30%) · 全屏制品
- 快捷键 `Cmd/Ctrl+J` 切换

### 6.2 组件结构

```
web/components/artifacts/
├── ArtifactPanel.tsx           ← 面板容器 · 列表 + detail 切换
├── ArtifactList.tsx            ← 列表:按 kind 分组 / pinned 置顶 / 最近优先
├── ArtifactListItem.tsx        ← 单行:icon+name+kind+version+time
├── ArtifactDetail.tsx          ← 展开单个:title+版本切换+操作按钮+内容渲染
├── ArtifactVersionSwitcher.tsx ← 版本切换
└── kinds/
    ├── MarkdownView.tsx        ← kind=markdown
    ├── CodeView.tsx            ← kind=code · 用 Monaco 只读
    ├── HtmlView.tsx            ← kind=html · sandboxed iframe srcdoc
    ├── ImageView.tsx           ← kind=image · <img> + lightbox
    ├── DataView.tsx            ← kind=data · 复用 Viz.Table 或 Viz.KV
    └── MermaidView.tsx         ← kind=mermaid · mermaid.js 客户端渲染
```

### 6.3 Artifact.Preview 组件

```tsx
// web/components/render/Artifact/Preview.tsx
// 在聊天里嵌入的制品预览卡(由 allhands.artifacts.render 驱动)
export function ArtifactPreview({artifact_id, version}) {
  // 1. 拉元信息 + 内容
  // 2. 根据 kind 挂对应的 kinds/XxxView
  // 3. 卡片头:name + kind + version 链接到制品区 detail
  // 4. 卡片底:"在制品区打开" 按钮
}
```

注册进 component-registry:`"Artifact.Preview": ArtifactPreview`。

### 6.4 实时同步

SSE 新增 `artifact_changed` event(见 § 7)。`ArtifactPanel` 订阅当前 workspace 的事件,自动刷列表 / detail。

### 6.5 视觉契约

严格遵守 `product/03-visual-design.md`:
- 每条 artifact item:48px 高,边框 1px,hover 仅改边框亮度
- 颜色密度 ≤ 3,kind 用 emoji 或 1-line SVG,不引 icon 库
- 版本切换 chip 样式同 design-system

---

## 7 · SSE 事件扩展

L8.1 加一条新事件:

```
event: artifact_changed
data: {"action": "created"|"updated"|"deleted"|"pinned",
       "artifact_id": "...",
       "kind": "...",
       "version": 3,
       "name": "..."}
```

后端在 `ArtifactService` 的 CRUD 完成后推入 SSE 流(当前 conversation 的 stream)。同时考虑"全局 artifact stream"(v1)让制品面板跨 conversation 同步 —— v0 只在当前对话 stream 推。

---

## 8 · Skill manifest

```
backend/skills/builtin/artifacts/
├── SKILL.yaml
└── prompts/
    └── guidance.md
```

**`SKILL.yaml`**:

```yaml
id: allhands.artifacts
name: 制品区
description: 产出 / 存取 / 迭代多模态制品(文档、代码、图、数据)
version: 1.0.0
builtin: true

tool_ids:
  - allhands.artifacts.create
  - allhands.artifacts.list
  - allhands.artifacts.read
  - allhands.artifacts.render
  - allhands.artifacts.update
  - allhands.artifacts.delete
  - allhands.artifacts.pin
  - allhands.artifacts.search

prompt_fragment_file: prompts/guidance.md
```

**`guidance.md`**(核心):

```markdown
# 制品区使用指南

**凡是有独立价值的产出,存成制品。** 不要只在对话里贴出来。

## 何时 create
- 用户让你"写一份 X"(文档、代码、规划、报告) → create artifact
- 你产出了完整独立的工件(图、diff、数据表)→ create artifact
- 中间思考过程、简短回复 → **不要** 存

## 何时 update vs create 新的
- 同一个工件的**迭代**(v2/v3)→ update(会弹 confirmation)
- 不同目的的新产出 → 新 create

## 何时 render
- **每次 create / update 后**,调 `artifact.render(id)` 在聊天里嵌入预览,让用户看到结果
- **不要** 把 content 直接粘进回复 —— 用户可以在制品区看原物

## 读制品
- 用户让"基于昨天的 X 继续做" → 先 `artifact.search` 或 `artifact.list` 找到 id → `artifact.read(id)` 拉内容 → 改 → update

## 不要
- 不要把同一内容既 create 又粘贴到回复
- 不要一次 update 动多个 artifact(一次一个,弹 confirmation 清楚)
- 不要 delete 用户没明说要删的
```

---

## 9 · 交付清单

### 新增文件(无重叠,全新开)

```
backend/
├── alembic/versions/0004_add_artifacts.py
├── src/allhands/
│   ├── core/artifact.py                                  ← L4 domain
│   ├── persistence/
│   │   ├── models/artifact_model.py                      ← SQLAlchemy
│   │   └── repos/artifact_repo.py
│   ├── services/artifact_service.py                      ← L6
│   ├── execution/tools/meta/artifact_tools.py            ← 8 个工具
│   └── api/routers/artifacts.py                          ← 只读 router
├── skills/builtin/artifacts/
│   ├── SKILL.yaml
│   └── prompts/guidance.md
└── tests/
    ├── unit/test_artifact_service.py
    ├── unit/tools/test_artifact_tools.py
    └── integration/test_artifacts_flow.py

backend/data/artifacts/               ← 文件存储目录(运行时创建)

web/
├── app/artifacts/page.tsx            ← 全屏查看(可选,v0 简版)
├── components/artifacts/
│   ├── ArtifactPanel.tsx
│   ├── ArtifactList.tsx
│   ├── ArtifactListItem.tsx
│   ├── ArtifactDetail.tsx
│   ├── ArtifactVersionSwitcher.tsx
│   └── kinds/*.tsx × 6
├── components/render/Artifact/Preview.tsx
├── lib/artifacts-api.ts
├── lib/component-registry.ts         ← patch · 注册 Artifact.Preview
└── tests/e2e/artifacts-flow.spec.ts
```

### 依赖

- **后端**:无新增(可能需要 `python-multipart` 如果要支持 upload,v0 可不)
- **前端**:
  - `mermaid` (mermaid 渲染)
  - Monaco editor(只读模式;code/html 查看)— 可能已有其它依赖中
  - 禁 icon 库(维持视觉契约)

---

## 10 · Scope

### In(v0)
- [x] 6 个 kind(markdown / code / html / image / data / mermaid)
- [x] 8 个 CRUD tool
- [x] artifact_changed SSE event
- [x] 制品面板 UI(列表 + detail + 版本切换)
- [x] `artifact.render` 嵌入聊天预览
- [x] 默认员工 `skill_ids` 注入 `allhands.artifacts`

### Out(v1)
- ~~drawio / pptx / video 三个 kind~~(v1)
- ~~Artifact 分享链接(对外)~~(v1)
- ~~跨 workspace 搜索~~(v0 单 workspace)
- ~~Artifact 之间的引用关系图~~(v2)
- ~~Artifact 自动归档 / 存储 quota~~(v1)

---

## 11 · 测试清单

| 测试 | 内容 |
|---|---|
| `backend/tests/unit/test_artifact_service.py` | create → read → update(patch) → update(overwrite) → delete → version history 一条龙 |
| `backend/tests/unit/tools/test_artifact_tools.py` | 8 个 tool 的 input/output;confirmation 规则;render 返回 payload 正确 |
| `backend/tests/integration/test_artifacts_flow.py` | agent 端到端:agent create → render 入聊天 → 再 update → 前端看到新版 |
| `backend/tests/integration/test_artifacts_sse.py` | artifact_changed event 正确产生 |
| `web/tests/unit/artifact-panel.test.tsx` | 列表渲染 / kind 分组 / pinned 置顶 |
| `web/tests/unit/artifact-kinds.test.tsx` | 6 个 kinds view 都能渲染 |
| `web/tests/e2e/artifacts-flow.spec.ts` | UI 端到端:手动 + agent 操作 |

---

## 12 · DoD

- [ ] 新建的员工默认 `skill_ids` 含 `allhands.artifacts`
- [ ] `/chat` 右侧面板可呼出制品区,与对话并排
- [ ] agent 执行 create → 制品面板实时出现 → render 出预览卡
- [ ] 手动在制品区点 artifact → detail 展示内容 + 版本
- [ ] update 弹 confirmation + diff 预览,approve 后版本 +1
- [ ] delete 弹 confirmation,软删
- [ ] 所有测试绿
- [ ] 视觉符合 design system;design-lab 有 Artifact.Preview 的活样本

---

## 13 · 开放问题(审核前回答)

1. **workspace 模型**:v0 写死 `workspace_id="default"`?用户确认。
   - 默认建议:是。workspace 正式化留给 v1 配多租户 / 团队。
2. **大文件上限**:单 artifact 文件大小上限?
   - 默认建议:text 1MB · binary 20MB。超过拒绝,让用户分块。env 可覆盖。
3. **软删保留天数**:30 天还是 7 天?
   - 默认建议:30 天,后台 cron(v1) 清理。
4. **artifact.render 一定要用户手动下载?还是内联 img/iframe 直接看?**
   - 默认建议:内联。但 HTML kind 一定走 sandboxed iframe(CSP 限制 script/form/popup)
5. **上传(用户把文件手动拖进制品区)支持吗?**
   - 默认建议:v0 **不**支持手动上传(agent-produced only)。v1 再加。
6. **artifact 在不同 conversation 之间可见吗?**
   - 默认建议:同 workspace 内全可见。conversation 只是出生记录,不是可见性边界。

---

## 13.5 · 参考源码(动手前必读)

> 规则见 [`docs/claude/reference-sources.md`](../../claude/reference-sources.md)。制品区没有 1:1 对标(Claude Code 是 CLI,没"持久化产出面板"的概念),但**每个子机制都有对标**。

| 本 spec 涉及 | 对标 ref-src-claude 入口 | 抽什么 |
|---|---|---|
| **§ 4 CRUD Tool · 特别是 update / delete 的 confirmation** | Claude Code 的 **Edit / Write / MultiEdit 工具**(V04) | 文件编辑工具如何:(a) 展示 diff · (b) 触发用户确认 · (c) 记录变更。**artifact.update 的 confirmation 交互直接对齐 Claude Code Edit 的 diff 预览体验** |
| **§ 4 artifact.delete 的 IRREVERSIBLE scope** | Claude Code tools 的 IRREVERSIBLE 操作(V04 末段)| 不可逆操作的"警告 + 二次确认"UX。我们软删也要走这个严肃度(虽然技术上可恢复) |
| **§ 7 SSE `artifact_changed` 事件** | `ref-src-claude/src/query.ts` 的事件冒泡(V02)+ REPL 的外部状态订阅(V01) | 事件从后端冒到前端,前端面板如何订阅 / 过滤 / 刷新 |
| **§ 8 `guidance.md` · 教 Agent "何时 create / update / render"** | Claude Code **TodoWrite**、**Task** 的 prompt 写法(V04 子章)+ 官方 Skill 的 SKILL.md | "什么时候触发这个工具 · 何时不用"的描述语言。Claude Code 这块做得极好,照搬语气结构 |
| **§ 3.1 ArtifactKind 分发 + 路径分流(text vs binary)** | Claude Code Read 工具对不同 file type 的处理(V04) | text / image / notebook / PDF 的分流策略。**重点抽:如何在一个工具里优雅处理多 kind** |
| **§ 6 制品面板 · 右侧抽屉 + 实时刷新** | Ink 的多区域布局(V01 末段)| 只抽"状态同步 + 三态可切换"的模式,UI 外观按 `product/03-visual-design.md` |

**autopilot 特别提醒**:
- `artifact.update` 的 confirmation diff 预览 —— 这是高频触达用户的交互。**花时间去 V04 看 Edit 工具的 diff 展示细节**,别图快直接写成"是/否"按钮
- `guidance.md` 决定员工会不会用好制品区 —— 去 Claude Code 官方 skill 里抽"告诉模型什么时候触发、什么时候别触发"的**语气和段落结构**

---

## 14 · 和其他 spec 的依赖

- **依赖 viz-skill**:`kinds/DataView.tsx` 复用 `Viz.Table` / `Viz.KV`;`Artifact.Preview` 复用多个 Viz 组件做卡片样式
- **依赖 employee-chat**:制品区面板嵌入 `ChatShell` 的右侧槽;没有 ChatShell 就没地方放面板
- **实施顺序建议**:先 viz-skill → 再 employee-chat(提供 ChatShell) → 最后 artifacts-skill

---

## 15 · 和执行端 Claude 的协同

全部文件都是**全新 · 无重叠**。唯一例外:

- `web/lib/component-registry.ts`:执行端可能也在改,autopilot 要合并注册条目

autopilot 开工前 `git status` 确认。
