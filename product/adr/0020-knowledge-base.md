# ADR 0020 · Knowledge Base · v0 工作区级第二大脑

**日期:** 2026-04-25  **状态:** Accepted, M1 implemented (this branch)
**Builds on:** [ADR 0011 · Principles Refresh](0011-principles-refresh.md) · [ADR 0015 · Skill Progressive Loading](0015-skill-progressive-loading.md) · [ADR 0017 · Event-Sourced Claude Code Pattern](0017-event-sourced-claude-code-pattern.md)
**Related spec:** [docs/specs/kb/2026-04-25-knowledge-base-design.md](../../docs/specs/kb/2026-04-25-knowledge-base-design.md)

---

## Context

allhands 的 v0 已有 **Artifact**(agent 即时产物)和 **Skill**(动态能力包),
但缺一个长期沉淀位:用户的 PDF / DOCX / 笔记 / 网页 clip 没法被 agent 主动检索。
Lead Agent 找东西只能 `fetch_url` 或问用户 — 没有"过去对话沉淀的资料"这一层。

Claude Code 用 Memory Tool + Skill 体系做这件事;LangChain 体系靠 RAG indexers。
两条路都重型;我们要的是 **Tool-First / 单文件部署 / 小团队规模(< 1M chunks)**
能跑起来的最小可用集。

---

## Decision

**新增 Knowledge Base 子系统** — 工作区级文档库 + 多格式摄取 + Hybrid 检索 +
agent 可授权写入。完全沿用平台 8 条原则,**不引入任何新范式**:

### 1. 领域结构(L4)
- `KnowledgeBase` / `Collection`(folder tree)/ `Document` / `DocumentVersion`
- `Chunk`(原子检索单位 · text 走 FTS5,embedding 走 vec store)
- `Grant`(per-employee / per-skill 写权限)+ `GrantScope` enum
- `EmbeddingJob`(摄取状态机的可恢复队列)
- `RetrievalConfig`(per-KB 调权重 / top_k / reranker)

每个 Document 走 `PENDING → PARSING → CHUNKING → INDEXING → READY` 状态机,
合法转移由 `is_legal_doc_transition` 守护。

### 2. 持久化(L3)— alembic 0024
- 8 张表 · `kb_chunks_fts`(FTS5 虚表)+ ai/ad/au 触发器 ·
  vectors 落 `kb_chunks.embedding BLOB`(float32 LE)
- 7 个 Sql repo + `fts_search()` raw helper

### 3. 摄取管线(L5)
- `parsers/`:Parser Protocol + 注册式扩展。v0 仨内置:
  text / markdown(headings → Sections)/ pdf(可选 pypdf 依赖)
- `chunker.py`:heading-aware 优先,recursive splitter 兜底,保留
  `section_path / span_start / page` 用于 citation 回链
- `embedder.py`:`mock:hash-<dim>`(始终可用,基于 SHA256 hash 折叠)
  / `openai:<model>` / `bailian:<model>`(都走 OpenAI-compat httpx),
  L2-normalize、cache、batch、exp backoff
- `vector.py`:`VectorStore` Protocol + v0 `BlobVecStore`(纯 Python
  brute-force cosine,< 100k chunks 够用),为后续 `SqliteVecStore`
  swap 留接口
- `retriever.py`:`HybridRetriever` BM25 + 向量并发 + RRF(k=60),
  `QueryEmbeddingCache` LRU+TTL · 完全 stateless(P3 对齐)
- `ingest.py`:同步 ingest;leasing/upsert 拆三个短事务避开 SQLite WAL
  writer-lock

### 4. 服务 + API(L6/L7)
- `KnowledgeService` 一份业务 → REST + Meta Tool 双入口(P1 Tool-First)
- 6 个 Meta Tool:`kb_list / kb_browse_collection / kb_search /
  kb_read_document / kb_create_document / kb_grant_permission`
- 13 个 REST 端点 · multipart 上传 / search / grants
- READ 自动执行;WRITE 需要 confirmation;agent 路径还需要 grant
  (`no_grant` 错误把控制权交回用户)

### 5. Skill + UI
- `allhands.skills.kb_researcher` 内置 skill(YAML descriptor +
  Markdown body)· ADR 0015 渐进加载
- `web/app/knowledge/page.tsx` 三栏布局(KB 列表 / 文档+上传+搜索 /
  结果)· brand-blue token-only · sidebar 加 Knowledge 入口

---

## Rationale

**为什么不直接用 Artifact:** Artifact 是产物(单 workspace 平表 · LIKE 搜),
KB 是参考库(树形 + tag · BM25+vec hybrid · 摄取管线)。两套语义不能共存
不损失清晰度。但我们复用了**所有共同模式**:DB 元数据 + 磁盘文件 + 版本号
+ 软删 + Confirmation Gate。

**为什么 sqlite-vec 不强制依赖:** 项目目标是单文件本地部署。loadable
extension 在所有 SQLite build 上不一定开启。`BlobVecStore` 用纯 Python
brute force,~100k chunks 内 100ms 量级,完全够个人/小团队。等到要
3M+ chunks 时,通过 `VectorStore` Protocol 切 `SqliteVecStore` /
`ChromaStore` / `PgVectorStore` 不动业务代码。

**为什么 mock embedder 始终可用:** 没 API key 也能跑通端到端(开发 / CI /
demo);prod 切真实 provider 走 ModelGateway 风格的 `model_ref` 字符串。

**为什么 grant 模型挂在 employee 和 skill 两边:** 既支持"这个员工能写这个
KB"(以人为单位),也支持"挂上 kb_curator skill 的人都能写"(以能力为单位)。
后者天然适合 v1 跨员工的"沉淀 skill"复用。

**为什么 ingest 用三短事务而不是一个长事务:** 第一次端到端 smoke 在
"lease + commit before vec upsert"上栽过 SQLite "database is locked"。
WAL 模式下并发写需要 transaction 边界明确。

---

## Consequences

### 益处
- 用户可以把 PDF / md / docx 扔进来,任何挂了 `kb_researcher` skill
  的员工都能引用回答
- Tool-First 闭环:UI 的每个动作都有同名 Meta Tool · L01 自动校验
- 状态可 checkpoint(P7):`embedding_jobs` 表 + `documents.state` 进程
  重启不丢
- 0 new heavy deps · pypdf 是 optional · 视情况再加 docx/audio

### 代价
- BlobVecStore brute-force 在 100k+ chunks 量级开始慢(线性扫)
- mock embedder 检索质量有限(只用了 sha256 hash,不懂语义)
  → 真用得切真实 embedding provider
- 同步 ingest 大文件会阻塞 REST handler(M2 起改 BackgroundTasks)

### 不做的事(明示)
- ❌ 团队级 ACL 矩阵 · v0 只 grant
- ❌ GraphRAG / 知识图谱 · 留 v1+
- ❌ 实时协同编辑
- ❌ reranker · 留 M3(架构留了 hook)
- ❌ image OCR / audio transcription · 留 M3

---

## Alternatives considered

**A · 用 Artifact 表 + 加 fts:** 拒。Artifact 是平表,引入 collection 树
和 chunk 概念会污染原模型。

**B · LangChain 直接接入:** 拒。LangChain 的 indexer/retriever/embeddings
栈很重,且违反 "execution 不直接 import LangChain"(ADR 0011)。

**C · 上 chroma / lancedb 一开始就外置:** 拒。多一个进程要起,违反单
文件部署目标。`VectorStore` 接口已留,以后可平移。

**D · sqlite-vec extension 一开始就用:** 拒。需要 loadable extension,
不一定所有 SQLite build 都开。延后到性能瓶颈时再切。

---

## Rollout / Migration

- 现状:v0(this branch)只在 `feat/knowledge-base` 上,**不动 main 部署
  + 测试**。完整 M1 实现 + 关键路径单测在分支上。
- alembic 0024 chains 0023 → 干净的 forward migration(已验证)
- 切到 main 前需要:把 ingest 切异步、补 web pnpm install 路径、
  在 production .env 接入真实 embedding provider key
