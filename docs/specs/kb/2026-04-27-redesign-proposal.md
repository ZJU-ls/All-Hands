# KB UX 重设计 · 单页拆三级 · 2026-04-27

> 作者注: 用户反馈"现在交互怪怪的, 信息密度太高了, 搞个两三级页面下钻"。
> 这是给我自己看的设计草稿, 用户看的是 `redesign-showcase.html`。

## 1. 现在哪里有问题

### 1.1 信息密度审计

`/knowledge` 单页今天同时承载:

```
PageHeader(title, count)
├── 顶 toolbar(5 控件)
│   KB select · + New KB · 搜/问 toggle + 输入框 · Upload split(含 URL 子菜单)
├── Stale embedding banner(条件性出现)
├── 左 sidebar 280px(4 张卡)
│   KBInfoCard · KBHealthCard · TagsCard · ToolsCard
├── 主区(mode-multiplexed router)
│   onboarding 4 步 ↔ DocumentsView ↔ SearchResultsView ↔ AskAnswerView
│   - DocumentsView 头本身又有 state filter / tag filter / 多选条
│   - AskAnswerView 内含多轮列表 + sticky composer + starter chips
├── 右 slide-over Drawer(条件)
│   3 tabs: Overview / Original / Chunks
└── Modal 层(条件)
    CreateKBModal · UrlIngestModal · BulkTagModal · KBSettingsModal(4 sub-tabs)
```

**真实计数:** 一个 viewport 内可能同时存在 **4 张 sidebar 卡 + 1 个工具栏 + 1 个主区(本身又是 4 选 1)+ 1 个 drawer + 1 个 modal**, 极端情况下 ≈ 12 个独立 UI 表面。

页面 tsx 已经接近 **3700 行**, 单组件 (`KnowledgePage`) 管 30+ useState。

### 1.2 用户现实痛点(从前几轮反馈与我自己 review)

| 痛点 | 当前表现 |
|---|---|
| **看不清自己 KB 里有啥** | 主区主要是 docs 网格, 但 KB 大局信息(总量 / 活跃 / 健康)被压成 sidebar 上的窄卡 |
| **Ask 体验受限** | 只占主区一半, 多轮对话 + sources + composer 挤一起, 没空间放"展开思考"等 future 功能 |
| **设置是 modal** | 切换模型要看比对 / 跑 diagnose 测召回 / 调权重, 这都是认真的活, 应该满屏 |
| **doc detail 是 drawer** | 想要"原文 + 分片"并排看就做不到, drawer 宽度固定 |
| **没有可分享 URL** | 我搜了个东西、问了个问题, 结果 URL 不变, 转给同事就丢 |
| **切 KB 丢上下文** | 切了 KB 之后 Ask 对话被清掉, 但 URL 没变, 不符合"KB 是工作区"的心智 |
| **窄屏崩溃** | toolbar wrap、sidebar 占太多、modal 不缩 |

### 1.3 一句话诊断

> 把 "KB 总览 / 文档管理 / 搜 / 问 / 设置 / 单文档详情" **6 个不同心智活动塞在一个 URL** 里, 用 mode 字段在 React 里来回切, 就是密度过高的根源。

---

## 2. 一线产品怎么做

我把记得的 7 个对标产品按 **信息架构 (IA)** 维度拆开, 看 levels + URL 模型:

### 2.1 NotebookLM (Google)

```
L1  Notebook list                          ← 卡片网格 + "+ New notebook"
└── L2  Single notebook                    ← 三栏: Sources(左) | Chat/Notes(中) | Studio(右)
    │                                         Studio = audio overview · briefing · FAQ · timeline · study guide
    └── L3  Source detail                  ← 点 source → 大画布: 原文 + summary + key topics 右栏
```

**借鉴:**
- L2 三栏布局 — Sources / 对话 / 衍生输出 各有家
- 每个 source 有专属页面看 summary
- "Studio" 这个分区把"基于 KB 自动生成的衍生"和"问答"分开

### 2.2 Glean (企业搜索)

```
L1  Search-first home                      ← 顶部巨大 search bar · 下面分 type tab
                                              All / Email / Slack / Docs / People
L2  Glean Chat                             ← 独立 surface · 不和搜索混
L?  Knowledge Hub (admin)                  ← 完全分离的管理区
```

**借鉴:**
- 搜 / 问 各自是 first-class surface, 不放在 doc-grid 上当 mode toggle
- 管理 / 配置和"日常使用"在不同入口

### 2.3 Notion AI Q&A

```
Sidebar tree(永远在)
└── Page (URL = /workspace/page-id)
    └── 嵌套 sub-page
Q&A overlay = ⌘K, 飘出来, 不抢主区
```

**借鉴:**
- 每个文档/笔记 = 自己 URL · 不是 drawer
- Q&A 是"飘出"的 utility, 不是页面

### 2.4 Mem.ai

```
L1  Mem feed                              ← 时间轴
L2  Single mem                            ← 自己 URL · 可编辑
Chat sidebar(全局)                        ← 跟所有 mems 对话
```

### 2.5 ChatGPT Custom GPTs / Mendable

```
L1  GPT/Project list
└── L2  GPT 编辑页                         ← 三栏: Configure(左) | Knowledge(中, 文件列表) | Test(右)
    └── L3  File preview drawer/modal
```

**借鉴:**
- 配置 / 知识 / 测试 在同一 L2 但分栏, 都看得见

### 2.6 Anthropic Claude Projects

```
L1  Project list
└── L2  Project page                       ← chat 主导 · 文件 panel 可折叠
    └── L3  File preview modal
```

### 2.7 Obsidian / Logseq

```
File tree(永远 sidebar)
└── Note canvas                           ← 主区
    └── Backlinks / outline 在右
```

### 2.8 通用模式提取

跨这 7 个产品我抽出 **4 条共识**:

1. **每个东西配自己的 URL** — KB / doc / project 都是, 浏览器后退能用, 链接能粘
2. **搜索和问答各自 first-class** — 不和 doc list 共享同一块画布做 mode 切换
3. **设置/配置是独立 surface** — 至少独立大区域, 不是飘窗
4. **drill-down 心智深度通常 2-3 级** — 再深就用 expand panel, 不再切页

---

## 3. 提案 · 三级 IA

### 3.1 路由树

```
/knowledge                                  L1 · KB hub
├── /knowledge/new                          (modal 或子 route, 见 §3.5)
└── /knowledge/[kbId]                       L2 · 单 KB 工作区(默认 Overview)
    ├── /knowledge/[kbId]/docs              L2 tab · 文档管理
    ├── /knowledge/[kbId]/ask               L2 tab · 全屏对话
    ├── /knowledge/[kbId]/search            L2 tab · 全屏搜索
    ├── /knowledge/[kbId]/settings          L2 tab · 设置(基础/检索/调试/危险)
    └── /knowledge/[kbId]/docs/[docId]      L3 · 单文档页(从 docs tab 进)
```

5 个 L2 tab 共享一个 KB 顶部 chrome(KB 名 / health 缩略 / 切 KB / 搜 / + 上传), 切 tab 不刷整页 chrome, 体感快。

### 3.2 L1 · `/knowledge` · KB hub

**职责:** "我有几个 KB, 哪个值得进?"

```
┌─────────────────────────────────────────────────────────────┐
│ 知识库 · 1 个                          [⌘K 全局搜索]   [+ 新建] │
├─────────────────────────────────────────────────────────────┤
│  ┌─ Personal Brain ──────────────────┐  ┌─ Work Notes ───┐ │
│  │ 5 docs · 36 chunks · 2.1k tokens  │  │ 12 docs · ...  │ │
│  │ ▁▂▁▃▅▂▁▁▁▁▁▁▁▁▁▂▁  ← 30 day spark │  │ ▁▁▂▁▁▃▁▁▂▁...   │ │
│  │ #ml #retrieval #notes  · 3h ago   │  │ #meeting #spec │ │
│  │ "已配 Ask · text-embedding-v3"    │  │ "演示模式"     │ │
│  └───────────────────────────────────┘  └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

每张卡是独立可点链接 → `/knowledge/[kbId]`。卡上信息基本全是 health 数据(已经有 endpoint), 一眼能看出哪个活跃 / 哪个有问题(stale embedding 用红边框)。

**砍掉的:** 顶部 KB 选择 dropdown(直接用卡片) · sidebar 4 张卡(到 L2 才出现) · mode toggle(L2 才有)。

### 3.3 L2 · `/knowledge/[kbId]` · 单 KB 工作区

顶部 chrome(所有 5 个 sub-tab 共享):

```
┌──────────────────────────────────────────────────────────────────┐
│ ◀ KB hub · Personal Brain  ✏     [Overview Docs Ask Search Cfg] │
│              5 docs · 36 chunks · ▁▂▁▃▅                          │
└──────────────────────────────────────────────────────────────────┘
```

5 个 sub-tab:

#### 3.3.1 Overview(默认)

第一次进 KB 看到的家。**告诉用户"这个 KB 长啥样, 我能干啥"。**

```
┌─ Hero strip ─────────────────────────────────────────────────────┐
│ 描述:"我自己的私有大脑, 收纳所有想记住的东西。"  ✏              │
└─────────────────────────────────────────────────────────────────┘
┌─ Health (full width) ────────────────────────────────────────────┐
│ KPI: 5 docs · 36 chunks · 2.1k tokens · 3h ago                   │
│ 30-day Sparkline   ▁▂▁▃▅▂▁▁▁                                     │
│ Top tags: #ml ×3  #retrieval ×2  #notes ×1                       │
└─────────────────────────────────────────────────────────────────┘
┌─ 最近 5 个文档 ─────────┐  ┌─ 现在能问什么(starters) ─────┐
│ • RRF survey  · ready  │  │ ✨ RRF 怎么工作?              │
│ • bge-reranker · ready │  │ ✨ bge-reranker 提升多少?     │
│ • urls.md     · ready  │  │ ✨ 关键词命中和向量召回的区别? │
│ → 全部文档              │  │ → 去 Ask 模式                 │
└────────────────────────┘  └─────────────────────────────────┘
┌─ Quick actions ──────────────────────────────────────────────────┐
│ [📤 上传] [🔗 抓 URL] [💬 问一下] [⚙ 设置]                          │
└─────────────────────────────────────────────────────────────────┘
```

**所有信息一屏看完, 都是只读 / 一键去深处**, 没有任何"操作面板"在这里。

#### 3.3.2 Documents(`/knowledge/[kbId]/docs`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Filter: [全部状态▾] [全部标签▾] [排序: 最近▾]   [选中 N · 批量▾] │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │
│ │ doc1 │ │ doc2 │ │ doc3 │ │ doc4 │ │ doc5 │ │ doc6 │         │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

主区不再多模态, 只有 docs grid + 顶部 filter bar。点 doc card → L3 doc 页(不是 drawer)。

#### 3.3.3 Ask(`/knowledge/[kbId]/ask`)

满屏对话 surface, sources 走右侧鞋带式 panel(可折叠):

```
┌──────────────────────────────────────┬─ Sources ────────────┐
│ Q1: "what is rrf?"                   │ [1] doc abc · § RRF  │
│                                      │      Reciprocal Rank │
│ A1: RRF is a fusion method [1] ...   │      Fusion is ...   │
│ Q2: "和 bge-reranker 比呢?"           │                      │
│ A2: bge-reranker improves ... [2] [3]│ [2] doc def · § ...   │
│                                      │ [3] doc ghi · § ...   │
│ ┌────────────────────────────────┐   │                      │
│ │ 继续追问 …                     │ ⏎ │                      │
│ └────────────────────────────────┘   │                      │
└──────────────────────────────────────┴──────────────────────┘
```

URL 包含 thread id (`?thread=abc123`), 后续可做"持久化对话历史"(roadmap)。

#### 3.3.4 Search(`/knowledge/[kbId]/search`)

满屏搜索 + 解释面板默认半展开:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 搜 Personal Brain 里的内容…                  [Diagnose mode]  │
├─────────────────────────────────────────────────────────────────┤
│ 12 hits                                                          │
│ ┌─ #1 BM25 #1 vec #3 · score 0.71 ──────────────────────────┐  │
│ │ doc xyz · § RRF Fusion                                     │  │
│ │ Reciprocal Rank Fusion (RRF) is a parameter-free way ...   │  │
│ │ ▾ 为什么排在这                                              │  │
│ │   BM25 ████████░░ 80%   Vector ██░░░░░░░░ 20%              │  │
│ │   Matched: rrf ✓  fusion ✓  parameter ✗                    │  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌─ #2 ... ─                                                  ┐  │
│ ...                                                              │
└─────────────────────────────────────────────────────────────────┘
```

URL 带 query (`?q=rrf`), 同事直接收到链接就能看到同样结果。

#### 3.3.5 Settings(`/knowledge/[kbId]/settings`)

不是 modal! 满屏页面, 左侧 sub-nav:

```
┌─ Settings nav ──┐  ┌─ Active sub-page ─────────────────────────┐
│ • Basic         │  │ Embedding model 选择                        │
│ • Retrieval     │  │ ┌────────────────────────────────────────┐ │
│ • Diagnose      │  │ │ ✓ 阿里云百炼 · text-embedding-v3 1024d  │ │
│ • Danger zone   │  │ │   阿里云百炼 · text-embedding-v4 1024d  │ │
│                 │  │ └────────────────────────────────────────┘ │
│                 │  │ KB 名称 · 描述 · visibility ...             │
└─────────────────┘  └────────────────────────────────────────────┘
```

Diagnose 子 tab 现在能站满整个 width, 三栏对比真正读得清。

### 3.4 L3 · `/knowledge/[kbId]/docs/[docId]` · 单文档页

**取代当前 drawer。** 复杂文档值得自己一个页面。

```
◀ Personal Brain · Documents
┌────────────────────────────────────────┬─ side rail 320px ───┐
│ 📄 RRF Survey · ready                   │ Tags                │
│   tabs: Overview · Original · Chunks    │  #ml ✕  #retrieval  │
│         · Backlinks                     │  + 加  · ✨ AI 推荐  │
├────────────────────────────────────────┤                     │
│ [Original tab — markdown 渲染]          │ Metadata            │
│                                         │  ID  abc123         │
│ # Hybrid Retrieval                      │  Mime markdown      │
│                                         │  Source upload      │
│ Brief overview of combining ...         │  Created 2d ago     │
│                                         │  Updated 3h ago     │
│ ## RRF Fusion                           │                     │
│ Reciprocal Rank Fusion is ...           │ Versions            │
│                                         │  v1 (current)       │
│ [click 任一段 → side rail 显示该段       │                     │
│  在 Chunks tab 里对应的位置 + 高亮]      │ Actions             │
│                                         │  Reindex  Delete    │
└────────────────────────────────────────┴─────────────────────┘
```

**Original ↔ Chunks 是平级 tab, 但在 Chunks tab 时支持 split-view**:

```
┌─ Chunks tab · split view ──────────────────────────────────────┐
│ ┌─ chunks list ────────┬─ original (highlighted) ──────────────┐
│ │ 1. # Hybrid Retr...  │ # Hybrid Retrieval                    │
│ │ 2. ## RRF Fusion ←   │ Brief overview ...                    │
│ │ 3. ## Reranking      │ ## RRF Fusion        ←  highlighted   │
│ │                      │ Reciprocal Rank Fusion ...            │
│ └──────────────────────┴───────────────────────────────────────┘
```

### 3.5 创建 KB / 创建文档 这种"事件性"操作

**不去做独立路由。** 这类是"做完一件事就回原页"的窄交互, 留 modal 形式:
- 新建 KB → modal 在 L1
- 拖拽上传 / Ingest URL → modal 在 L2 docs
- 批量打标签 → modal 在 L2 docs (已存在)

modal 这种用法是合理的"action-triggered overlay", 跟"主要工作面"是 modal 完全两回事。

### 3.6 全局 ⌘K(later iter, 不属于本次)

跨 KB 命令 + 跨 KB 全局搜索, 在 L1 / L2 都能呼出。这是 NotebookLM / Glean / Notion 都有的"快速跳转"模式, 可以放到 ROADMAP。

---

## 4. 拆迁清单(给未来实施用)

### 4.1 现有组件分流

| 现在在 page.tsx 的组件 | 去向 |
|---|---|
| `KnowledgePage` | 拆成 5 个 page.tsx(hub / overview / docs / ask / search / settings)+ 1 个 doc page |
| `OnboardingWizard` | 移到 hub L1 当 0-KB 状态 |
| `KBInfoCard` | 拆 → Overview hero strip 一部分 |
| `KBHealthCard` | 拆 → Overview health 满宽组件 |
| `TagsCard` | 拆 → Documents tab 顶部 filter bar 的 tag dropdown |
| `ToolsCard` | 拆 → Overview Quick actions 一部分 |
| `DocumentsView` | 直接搬去 docs tab |
| `SearchResultsView` + `SearchResultCard` | 搬去 search tab |
| `AskAnswerView` + 多轮组件 | 搬去 ask tab |
| `StarterChips` | 搬去 Overview |
| `DocDrawer` | **删除**, 替换成 L3 doc 页 |
| `KBSettingsModal` + 4 sub-tabs | 拆成 L2 settings 页 + 4 个 sub-route(或共享 layout) |
| `CreateKBModal` / `UrlIngestModal` / `BulkTagModal` | 保留 modal 形式, 挂在合适层 |
| `StaleEmbeddingBanner` | 移到 Overview 或 layout 共享 chrome |

### 4.2 工作量粗估

| 阶段 | 输出 | 估时 |
|---|---|---|
| Phase 1 · L1 hub | KB cards 网格页面 + 跳转 | 半天 |
| Phase 2 · L2 layout + Overview | 共享 chrome + Overview 默认页 | 1 天 |
| Phase 3 · 拆 Docs / Ask / Search 三个 tab page | 各自 page · 复用现有视图组件 | 1.5 天 |
| Phase 4 · L3 doc 页 + chunks split view | 替代 drawer + split view 新增 | 1 天 |
| Phase 5 · L2 settings 页 | 替代 modal · 4 sub-route 或 sub-tab | 半天 |
| Phase 6 · 老路径清理 + 老组件删除 + 测试更新 | | 半天 |
| **合计** | | **~5 天** |

可以增量改: 先做 Phase 1+2(半天 + 1 天), 让用户看到主结构, 再继续。每个 phase 都能独立 ship、独立合 main、单元测试不破。

### 4.3 风险

1. **状态从 page-level useState 散到 5 个 route** — 几个跨页面状态(active KB / streaming Ask turn / 选中 docs)需要 store 化。Zustand 已经在用, 加一个 `kbStore` 即可
2. **AbortController for Ask streaming** — 切 tab 时是否中止? 我倾向"切走自动中止 · 切回看到清空对话"。同 KB 内 Ask thread 持久化是 roadmap, 不在这次范围
3. **现有 e2e 测试** — 选择器都基于单页结构, 要批量更新
4. **Tool-First 契约** — 路由变了, REST API 和 Meta Tool 不变, 不影响
5. **i18n key 数量** — 多页的 key 比单页多, 但每个 key 局部性更好

### 4.4 不做的

- 不引入新的 state 管理库 (Zustand 够用)
- 不引入路由库 (Next.js App Router 自带)
- 不重写设计 token / 视觉规范 (Brand Blue Dual Theme 不变)
- 不动后端

---

## 5. 决策点(等用户拍板)

1. **Overview tab vs 直接进 Docs?** 我推荐 Overview 默认 — 给用户"摸底"的机会; 也可以做"smart default":第一次进 KB 给 Overview, 之后记住上次的 tab
2. **L2 chrome 是 tab bar 还是 sidebar nav?** Tab bar 更轻; sidebar nav 视觉更"工作区". 我倾向 tab bar, 因为 5 个 tab 不算多
3. **Ask thread 持久化** 是否进本次? 我推荐 **不**, 它是单独 feature, 一并做范围太大
4. **Settings 满屏页 vs 大 sheet drawer?** 我倾向满屏页 — diagnose 子 tab 的三栏对比真的需要宽度
5. **是否用 Next.js parallel routes / intercepting routes?** 把 doc 页同时支持"满屏"和"从 docs tab 浮起的 modal"。技术性优化, 不是 v0 必需

---

## 6. 落实的标准

完成后 review 拿这 6 条对照, 凡有一条没满足都要继续修:

- [ ] L1 任何 KB card 一眼能看到: 名 + doc count + sparkline + 上次活跃 + 是否需要修复(stale embedding)
- [ ] L2 任何 tab 内不再出现"4 张 sidebar 卡 + 主区 + drawer + modal"同框
- [ ] L3 doc 页支持原文 + chunks 并排, 点 chunk 直接在原文里高亮
- [ ] 所有路由可分享 (URL 编码 active KB / docId / search query / ask thread)
- [ ] 浏览器后退按钮在每一级都符合直觉
- [ ] 移动端 / 窄屏不再 wrap 出乱七八糟的工具栏
