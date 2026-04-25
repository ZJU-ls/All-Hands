# Knowledge Base · 设计方案

> **状态:** Draft · 2026-04-25
> **负责人:** @owner
> **范围:** 在 allhands 平台上构建一套个人/工作区级知识库，支持多格式摄取、Agentic 检索、可授权的 Agent 写入。
> **关联原则:** P1 Tool First · P2 统一 React Agent · P3 Pure-Function Query Loop · P4 Skill 动态能力包 · P6 L4 对话 + 护栏 · P7 状态可 checkpoint。

---

## 1. 目标与非目标

### 目标
1. **个人沉淀** — 把零散的 md / pdf / docx / html / 网页 / 录音 转成可检索的"第二大脑"
2. **Agentic 检索** — 任何员工通过 `kb_search` / `kb_read_document` 等 Meta Tool 主动查证、引用回答
3. **可授权写入** — 给指定 Skill / Employee 颁 grant 后，它们可以 `kb_create_document` / `kb_update_document` 把对话沉淀回 KB
4. **多格式** — md / txt / pdf / docx / pptx / xlsx / csv / html / epub / image (OCR) / audio·video (transcription) / code / URL
5. **复用现有基建** — Artifact 的"DB 元数据 + 磁盘文件 + 版本号"模式 / ModelGateway 的嵌入模型路由 / Confirmation Gate / Skill 渐进加载

### 非目标 (v0)
- 不做团队级协作权限矩阵(只做 workspace + per-employee grant)
- 不做实时协同编辑
- 不内嵌图数据库 / GraphRAG(留给 v1)
- 不上云端向量库(单机 sqlite-vec 起步,迁移路径预留)

---

## 2. 与现有 Artifact 系统的边界

| 维度 | Artifact | KnowledgeBase Document |
|---|---|---|
| 生命周期 | Agent 即时产物(报告/草稿/可视化) | 长期沉淀的资料 |
| 命名空间 | 工作区扁平表 | KB → Collection (树形) → Document |
| 检索 | 名称 + 全文 LIKE | BM25 + 向量 + Hybrid + Reranker |
| 多格式摄取 | 不解析(原样存) | 解析 → chunk → 嵌入 |
| 版本 | 每次 update 升版本 | 同上(复用模式) |
| 写权限 | 任何 employee | 默认仅 owner; agent 需 grant |
| 渲染 | `Artifact.Preview` render tool | `KB.Citation` / `KB.Excerpt` render tool |

**共生不替代**:Artifact 是"工作产物",KB 是"参考库"。常见流程:Agent 在对话里产出 Artifact → 用户认可后 → `kb_create_document` 把它沉淀进 KB(本质是 file_path 二次落盘 + 解析索引)。

---

## 3. 领域模型(L4)

```
backend/src/allhands/core/knowledge.py
```

```python
class KBVisibility(StrEnum):
    PRIVATE   = "private"      # 仅 owner
    WORKSPACE = "workspace"    # 同 workspace 所有 employee
    PUBLIC    = "public"       # 跨 workspace 只读

class DocumentState(StrEnum):
    PENDING  = "pending"
    PARSING  = "parsing"
    CHUNKING = "chunking"
    INDEXING = "indexing"
    READY    = "ready"
    FAILED   = "failed"

class GrantScope(StrEnum):
    READ  = "read"
    WRITE = "write"   # create/update
    ADMIN = "admin"   # delete/grant

class KnowledgeBase(BaseModel):
    id: str
    workspace_id: str
    name: str
    description: str
    visibility: KBVisibility
    embedding_model_ref: str          # ModelGateway ref
    retrieval_config: RetrievalConfig # bm25/vector weights, reranker, top_k
    created_at: datetime
    updated_at: datetime

class Collection(BaseModel):  # 文件夹树
    id: str
    kb_id: str
    parent_id: str | None
    name: str
    path: str           # /research/papers/2026
    created_at: datetime

class Document(BaseModel):
    id: str
    kb_id: str
    collection_id: str | None
    title: str
    source_type: Literal["upload", "url", "agent", "paste"]
    source_uri: str | None        # 原始 URL / 上传文件名
    mime_type: str
    file_path: str                # data/kb/<kb_id>/<doc_id>/v<N>.<ext>
    size_bytes: int
    sha256: str                   # 去重 + 增量更新
    state: DocumentState
    state_error: str | None
    tags: list[str]
    metadata: dict                # parser-specific (page_count / author / lang ...)
    version: int
    pinned: bool
    deleted_at: datetime | None
    created_by_employee_id: str | None
    created_at: datetime
    updated_at: datetime

class DocumentVersion(BaseModel):  # 复用 ArtifactVersion 模式
    id: str
    document_id: str
    version: int
    file_path: str
    diff_summary: str | None
    created_at: datetime

class Chunk(BaseModel):
    id: str
    document_id: str
    ordinal: int
    text: str
    token_count: int
    section_path: str | None      # "Chapter 2 > 2.3 Methods"
    span_start: int               # 原文 char offset (用于回引)
    span_end: int
    page: int | None              # PDF/PPT 才有
    metadata: dict

class Grant(BaseModel):           # agent 写权限
    id: str
    kb_id: str
    employee_id: str | None       # 二选一
    skill_id: str | None
    scope: GrantScope
    expires_at: datetime | None
    created_at: datetime
```

**不变量(L4 守护):**
- `core/knowledge.py` 只 import pydantic + stdlib
- `Document.file_path` 永远指向磁盘,不内联文本
- `Chunk.text` 落 SQLite(走 FTS5),向量另存 vector store
- `Grant` 在写入路径上必检,不存在 grant ⇒ Confirmation Gate 直接拒绝

---

## 4. 持久化(L3)

```
persistence/orm/knowledge_orm.py     # SQLAlchemy 表
persistence/knowledge_repos.py       # KBRepo / DocumentRepo / ChunkRepo / GrantRepo
alembic/versions/<rev>_kb.py         # 新建表 + FTS5 虚表 + sqlite-vec 虚表
```

**表清单:**
- `knowledge_bases` / `collections` / `documents` / `document_versions` / `chunks` / `grants`
- `chunks_fts`(SQLite FTS5 虚表 — 全文)
- `chunks_vec`(sqlite-vec 虚表 — 向量,维度由 embedding_model 决定)

**为什么 sqlite-vec:**
- 项目已用 SQLite(ADR 0002)
- 单文件部署,无新依赖服务
- 性能足够个人/小团队场景(< 1M chunks)
- 写过千万级要换 → 通过 `VectorStore` 接口可平替 chroma / pgvector

---

## 5. 摄取管线(L5)

```
execution/knowledge/
  parsers/
    __init__.py            # registry: mime_type → Parser
    markdown.py
    pdf.py                 # pypdfium2 + 可选 OCR (paddleocr) for 扫描件
    docx.py                # python-docx
    html.py                # trafilatura
    pptx.py                # python-pptx
    xlsx.py                # openpyxl → row-as-record
    csv.py                 # 同上
    epub.py                # ebooklib
    code.py                # tree-sitter symbol-aware
    image.py               # pix2text / paddleocr
    audio.py               # faster-whisper
    url.py                 # fetch_url + readability + 递归 parser dispatch
  chunker.py               # heading-aware → recursive-fallback
  embedder.py              # 走 ModelGateway 拿 embedding endpoint
  retriever.py             # BM25 + vector + RRF + 可选 reranker
  ingest.py                # orchestrator + state machine
  vector_store.py          # 接口 + sqlite-vec 实现
```

**Parser 契约:**
```python
class ParseResult(BaseModel):
    text: str                     # 拼接后的纯文本(含 markdown 化的标题)
    sections: list[Section]       # heading + char_span + page
    metadata: dict                # 作者/页数/语言/...

class Parser(Protocol):
    mime_types: ClassVar[list[str]]
    def parse(self, file_path: str) -> ParseResult: ...
```

新增格式 = 加一个文件 + 注册一行(对齐 P1 Tool First / 注册式扩展)。

**摄取状态机:**
```
PENDING → PARSING → CHUNKING → INDEXING → READY
                                       ↘ FAILED (state_error 写错误原因)
```
失败可重跑(`kb_reindex_document`)。每一步发 `KBEvent`(`document.parsed` / `document.indexed`),L8 SSE 推前端 → 上传后实时看进度。

**Chunking 策略:**
1. 优先按 `sections` 分(标题感知)
2. 单 section > N tokens → recursive character splitter (1000 tokens, 150 overlap)
3. 保留 `section_path`、`page`、`span_start/end` 用于 citation 回链

**Embedding:**
- 模型走 `ModelGateway.embed(model_ref, texts)` — 跟 LLM 一样的统一入口
- 默认预设:百炼 `text-embedding-v3` / OpenAI `text-embedding-3-small`
- 批量 64 条/次 · 失败重试 3 次 · 写入 `chunks_vec`

---

## 5b. 向量化 / 落库 / 检索 — 工程级展开

### 5b.1 嵌入生成(`embedder.py`)

模型走 `ModelGateway.embed()` 统一入口,跟 LLM 一样不绕过。

```python
class Embedder:
    def __init__(self, gateway, model_ref: str, batch_size: int = 64):
        self.model_ref = model_ref           # e.g. "bailian:text-embedding-v3"
        self.dim = self._probe_dimension()   # 启动时探一次
        self._cache = EmbeddingCacheRepo()   # sha256(text||model_ref) → blob

    async def embed_texts(self, texts: list[str]) -> list[Vector]:
        # 1. 查 cache · 拿到的跳过
        # 2. miss 的批量 64 条/请求送 gateway
        # 3. 失败指数退避重试 3 次,仍失败把 chunk 标 FAILED
        # 4. L2 归一化 → 让 sqlite-vec 默认 L2 距离等价于 cosine
        # 5. 回填 cache
        ...
```

**Mock embedder fallback**:无 API key 的开发/测试场景下,退化成
`HashEmbedder` —— sha256 切 64 个 byte → 64-dim 向量,确定性、
零依赖、能跑通整条管线。生产前必须切真实 provider。

**Provider 扩展**:`ProviderPreset` 加 `embedding_endpoint`:
- bailian → `text-embedding-v3` (1024d)
- openai  → `text-embedding-3-small` (1536d) / `-3-large` (3072d)
- local   → `bge-m3` ONNX (1024d)

`KnowledgeBase.embedding_model_ref` **不可热改** — 换模型走 reindex
shadow-table swap(见 §5b.4)。

### 5b.2 落库(per-KB sqlite-vec 表 + 缓存 + jobs)

```sql
-- 全文表(已在 chunks 之后建)
CREATE VIRTUAL TABLE chunks_fts USING fts5(
    text, content='chunks', content_rowid='id',
    tokenize='porter unicode61'
);

-- per-KB 向量虚表(避免 dim 冲突 + 删 KB 一条 SQL)
CREATE VIRTUAL TABLE kb_<kb_id>_vec USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding FLOAT[<dim>]
);

-- 跨 KB 共享的 embedding 缓存
CREATE TABLE embedding_cache (
    hash TEXT PRIMARY KEY,        -- sha256(text || model_ref)
    model_ref TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,         -- float32 序列化
    created_at TIMESTAMP NOT NULL
);

-- 索引任务状态机(摄取可重跑)
CREATE TABLE embedding_jobs (
    id TEXT PRIMARY KEY,
    kb_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_id INTEGER NOT NULL,
    state TEXT NOT NULL,          -- queued/running/done/failed
    attempts INTEGER DEFAULT 0,
    error TEXT,
    enqueued_at TIMESTAMP,
    finished_at TIMESTAMP
);
CREATE INDEX idx_emb_jobs_state ON embedding_jobs(state, enqueued_at);
```

**v0 不依赖 sqlite-vec extension**:为了让 v0 单文件部署不强求
loadable extension,先实现 `BlobVecStore`(向量序列化进 `chunks` 表的
`embedding BLOB` 字段,Python 端 brute-force 算余弦)。`VectorStore` 接口
后期切 `SqliteVecStore` 不动业务代码。10w chunks 内单查 < 200ms 可接受。

### 5b.3 写入流程

```python
async def index_document(doc: Document):
    chunks = chunker.split(doc)              # 30-200 个
    chunk_repo.bulk_insert(chunks)           # 拿 id
    fts.insert_many(chunks)                  # FTS5 同步
    emb_jobs.enqueue_many(chunks, kb_id)     # 入队
    doc_repo.update_state(doc.id, INDEXING)

async def embedding_worker(kb_id: str):
    while True:
        batch = emb_jobs.lease(kb_id, limit=64)
        if not batch: await asyncio.sleep(1); continue
        try:
            vecs = await embedder.embed_texts([c.text for c in batch])
            vec_store.upsert(kb_id, list(zip(batch.ids, vecs)))
            emb_jobs.mark_done(batch)
        except Exception as e:
            emb_jobs.mark_failed(batch, str(e))
        if doc_done(doc.id):
            doc_repo.update_state(doc.id, READY)
            sse.emit(doc_id, "ready")
```

**收益**:状态机 + jobs 表 → 进程重启不丢(P7);单文档失败 1-2 条
不影响整体 → READY 时附 `failed_chunks=2/187`;worker 数量可调,
provider 限速时天然 backpressure。

### 5b.4 检索流程

```python
async def hybrid_search(kb_id, query, k=8, cfg: RetrievalConfig):
    # 1. query embedding(带 1h TTL 内存 cache)
    q_vec = await query_embed_cache.get_or_compute(query, embedder)

    # 2. 并发 BM25 + 向量
    bm25, vec = await asyncio.gather(
        fts_search(kb_id, query, top=50),
        vec_store.search(kb_id, q_vec, top=50),
    )

    # 3. RRF 融合 — score(c) = Σ weight_i / (60 + rank_i(c))
    fused = rrf_fuse([(bm25, cfg.bm25_w), (vec, cfg.vector_w)])[:30]

    # 4. 可选 reranker(bge-reranker-base · 本地 ONNX · 60ms/30 pairs)
    if cfg.reranker != "none":
        scores = await reranker.score(query, [c.text for c in fused])
        fused = sorted(
            (c.with_score(s) for c, s in zip(fused, scores)),
            key=lambda c: -c.score,
        )

    # 5. top_k + min_score + 拼 citation
    return [attach_citation(c) for c in fused[:cfg.top_k] if c.score >= cfg.min_score]
```

**关键细节**:
- 向量预归一化 L2=1 → sqlite-vec 默认 L2² = 2(1-cosine),排序等价
- RRF 不用归一不同尺度的分数,parameter-free,工业界标准
- `kb_search(filters={collection, tags, date_from})` → 在 chunks 先 SELECT
  候选 id,再 `WHERE chunk_id IN (...)` 下推到 vec 表(sqlite-vec 支持)
- query embed cache key = `sha256(query||model_ref)`,LRU 1024,TTL 1h

### 5b.5 模型切换 / reindex(零停机)

`embedding_model_ref` 一旦绑定不能 in-place 换。流程:
1. `kb_reindex_kb(kb_id, new_model)` Meta Tool · 预估 token 成本 · 走 confirmation
2. 新建 shadow `kb_<id>_vec_v2`(新 dim)
3. 全部 chunks 重新入 `embedding_jobs` 指向 v2
4. worker 跑完 → `DROP TABLE vec; ALTER TABLE vec_v2 RENAME TO vec`(原子)
5. 期间 search 走旧表,无感

### 5b.6 性能 / 成本预算

| 规模 | 存储 | 摄取 | 查询 | 成本(百炼) |
|---|---|---|---|---|
| 1k docs · 30k chunks | ~120MB | 8 分钟 | < 30ms | ~¥1.5 |
| 10k docs · 300k chunks | ~1.2GB | 1.5h | < 80ms | ~¥15 |
| 100k docs · 3M chunks | ~12GB | 15h | brute-force 吃力 → 上 chroma | ~¥150 |

> 个人/小团队 < 1M chunks 用 sqlite-vec 足够;3M+ 通过 `VectorStore` 接口换 chroma / lancedb / pgvector,无业务代码改动。

### 5b.7 抽象接口

```python
class VectorStore(Protocol):
    async def create_namespace(self, kb_id: str, dim: int) -> None: ...
    async def drop_namespace(self, kb_id: str) -> None: ...
    async def upsert(self, kb_id: str, items: list[tuple[int, Vector]]) -> None: ...
    async def delete(self, kb_id: str, chunk_ids: list[int]) -> None: ...
    async def search(self, kb_id: str, q: Vector, top: int = 50,
                     filter_ids: set[int] | None = None) -> list[VecHit]: ...

# v0
class BlobVecStore(VectorStore):  # 纯 SQLite + Python brute-force
    ...
# 后续切换(留接口,先不写)
# class SqliteVecStore(VectorStore): ...
# class ChromaStore(VectorStore): ...
```

业务层只 import `VectorStore`(L4 接口),实现在 L5 注册式装配,对齐 P7 注册式扩展。

---

## 6. 检索(Hybrid + Agentic)

### 6.1 单次检索(`retriever.search(kb_id, query, k)`)
1. **BM25** 走 `chunks_fts` 拿 top 50
2. **Dense** 走 `chunks_vec` 拿 top 50
3. **RRF 融合** (k=60) → top 20
4. **可选 Reranker**(bge-reranker-base 本地 / cohere-rerank API) → top k
5. 返回 `[{chunk_id, doc_id, score, text, section_path, citation}]`

### 6.2 Agentic 多轮(由 Skill body 引导,不是引擎自己循环)
对应 Claude Code 的 query 主循环风格:agent 自己决定要不要再 `kb_search` 一次。
```
[user] 帮我查 X
[agent] kb_search(query="X 关键词")           ← 第一次广撒
[agent] 看到 5 个候选,前 2 条不够细
[agent] kb_read_document(id=doc_3, sections=[2,3])  ← 拉原文
[agent] 还差一个数据 → kb_search(query="精确化的子问题")
[agent] 综合答复 + 引用 [doc_3#2.3] [doc_7#1.1]
```

不内置"agentic retriever 引擎",而是把检索原子拆成 Meta Tool,让 AgentLoop 自己驱动 — **完全对齐 P3 Pure-Function Query Loop**。

### 6.3 RetrievalConfig(每个 KB 可调)
```python
class RetrievalConfig(BaseModel):
    bm25_weight: float = 1.0
    vector_weight: float = 1.0
    reranker: Literal["none", "bge-base", "cohere"] = "none"
    top_k: int = 8
    min_score: float = 0.0
```

---

## 7. Meta Tool 矩阵(P1 Tool First)

读(`scope=READ` · 无 confirmation):
| Tool | 输入 | 输出 |
|---|---|---|
| `kb_list` | filter | `[{kb_id, name, doc_count}]` |
| `kb_browse_collection` | kb_id, path? | `{collections, documents}` |
| `kb_search` | kb_id, query, k=8, filters | `[{chunk, score, citation}]` |
| `kb_read_document` | doc_id, sections? / span? | 完整文本或片段 |
| `kb_get_document_meta` | doc_id | metadata + version |
| `kb_render_citation` | chunk_id[] | render envelope `{component:"KB.Citation"}` |

写(`scope=WRITE` · `requires_confirmation=True`):
| Tool | 入参要点 |
|---|---|
| `kb_create_document` | kb_id, collection_id?, title, content/file_base64, mime_type |
| `kb_update_document` | doc_id, mode=overwrite\|patch, content/patch |
| `kb_move_document` | doc_id, new_collection_id |
| `kb_tag_document` | doc_id, tags[] |
| `kb_ingest_url` | kb_id, url, recurse?, depth |

不可逆(`scope=IRREVERSIBLE`):
| Tool | 行为 |
|---|---|
| `kb_delete_document` | 软删 30 天 |
| `kb_purge_document` | 物理删除(管理员) |

管理(普通用户走 UI 即可,但都要有 Meta Tool 等价 — P1):
- `kb_create` / `kb_update_settings` / `kb_delete`
- `kb_grant_permission` / `kb_revoke_permission`
- `kb_reindex_document` / `kb_reindex_kb`
- `kb_set_retrieval_config`

**写权限闭环:**
```
agent → kb_create_document
  ↓
permission_check:
  - 找 grant(kb_id, employee_id|skill_id, scope>=WRITE)
  - 没有 → return Defer(ConfirmationSignal, ...) 让用户人工授权(一次性)
  - 有 → 走标准 confirmation(diff 预览)
```

---

## 8. Skill 包(预置)

`backend/src/allhands/skills/builtin/kb-researcher/`
```yaml
# SKILL.yaml
id: allhands.skills.kb_researcher
name: 知识库研究员
description: 在知识库里检索资料、引用原文回答你的问题
tool_ids:
  - allhands.kb.list
  - allhands.kb.search
  - allhands.kb.read_document
  - allhands.kb.render_citation
prompt_fragment: |
  你可以访问用户的知识库。优先使用 kb_search 获取候选 → 必要时 kb_read_document 拉原文 →
  用 kb_render_citation 在回答末尾给出引用。绝不编造内容。
version: 0.1.0
```

`kb-curator` skill(写权限版):额外带 `kb_create_document` / `kb_update_document` / `kb_tag_document` — 用户挂上后就能让员工"听完会议把要点沉淀进知识库"。

参照 ADR 0015 的渐进加载:descriptor 永驻 / 激活才注 body / SKILL.md 引导 agent 自己决定查几次。

---

## 9. UI(L9/L10)

```
web/app/knowledge/
  page.tsx                # KB 列表
  [kbId]/
    page.tsx              # KB 详情(三栏:tree / docs / preview)
    settings/page.tsx     # 检索配置 + grant 管理
    search/page.tsx       # "检索 playground" — 调参 / 看分数
web/components/knowledge/
  KBList.tsx
  CollectionTree.tsx
  DocumentList.tsx
  DocumentPreview.tsx     # md → markdown / pdf → embed / image → img / 其他 → 高亮 chunk
  IngestDropzone.tsx      # 拖拽上传 + URL 输入
  IngestProgressTimeline.tsx  # PARSING/CHUNKING/INDEXING 实时
  ChunkInspector.tsx      # 点 doc → 看切出来的 chunk + 向量预览
  GrantPanel.tsx
  RetrievalPlayground.tsx # 输入 query → 显示 BM25/vector/RRF 三列分数
  KBCitation.tsx          # render component (chat 里展示引用)
web/lib/component-registry.ts
  + KB.Citation: KBCitationComponent
  + KB.Excerpt:  KBExcerptComponent
```

设计契约:严格走 brand-blue 双主题 token(P8) — 不写 hex / `bg-blue-500`。

---

## 10. REST 路由(L7)

`api/routers/knowledge.py`(给 UI 用,跟 Meta Tool 等价 — 一份 service 两层壳):
```
GET    /api/kb                          → list
POST   /api/kb                          → create
GET    /api/kb/:id
PATCH  /api/kb/:id
DELETE /api/kb/:id
GET    /api/kb/:id/documents
POST   /api/kb/:id/documents            (multipart upload)
POST   /api/kb/:id/ingest-url
GET    /api/kb/:id/documents/:did
PATCH  /api/kb/:id/documents/:did
DELETE /api/kb/:id/documents/:did
POST   /api/kb/:id/search               (debug playground)
GET    /api/kb/:id/grants
POST   /api/kb/:id/grants
DELETE /api/kb/:id/grants/:gid
SSE    /api/kb/:id/documents/:did/events  (摄取进度)
```

回归测试 `test_learnings.py::TestL01ToolFirstBoundary` 自动校验上述每条写路由都有同名 Meta Tool。

---

## 11. 分阶段交付

### M1 · 最小可用(2 周)
- core models + alembic migration
- parsers: md / txt / pdf
- chunker(heading + recursive)
- BM25 only(FTS5)
- Meta Tools: `kb_list` / `kb_search` / `kb_read_document` / `kb_create_document`(走 confirmation,不要 grant)
- UI: 列表 / tree / 上传 / preview / 简易 search
- seed `kb-researcher` skill

### M2 · 向量 + 多格式(2 周)
- sqlite-vec + ModelGateway.embed
- parsers: docx / html / pptx / xlsx / csv / epub
- Hybrid + RRF
- Grant 模型 + 写 tools 全套(`kb_update / move / tag / delete`)
- UI: GrantPanel / RetrievalPlayground / IngestProgressTimeline
- `kb-curator` skill

### M3 · Agentic + 高级(2 周)
- bge reranker(本地 ONNX runtime)
- audio/video transcription(faster-whisper)
- image OCR
- URL 摄取 + 增量更新(sha256 diff)
- 检索回归套件:固定 query → 期望 doc 命中率(P@5 / MRR)
- Observability:每次 `kb_search` 上 LangFuse trace,看 latency / hit-rate
- 文档 + ADR 收尾

---

## 12. 测试矩阵

| 层 | 测试 |
|---|---|
| L4 | `test_knowledge_models.py` — 不变量 / 状态机合法转移 |
| L3 | `test_knowledge_repos.py` — CRUD + FTS + vec 写读一致 |
| L5 | `test_parsers_*.py` — 每种格式黄金样本 in/out |
| L5 | `test_chunker.py` — heading-aware / overlap / span 准确 |
| L5 | `test_retriever.py` — BM25/vec/hybrid 排序断言 |
| L5 | `test_kb_meta_tools.py` — 每个 Meta Tool I/O |
| L5 | `test_kb_grant_gate.py` — 无 grant ⇒ Defer |
| L7 | `test_kb_routes.py` — REST 端到端 |
| L7 | `test_learnings.py::L01` — 写路由 ↔ Meta Tool 配对自动校验 |
| Eval | `test_kb_retrieval_eval.py` — 固定 query 集 P@k / MRR 不退化 |

---

## 13. 与 8 条核心原则的对齐

| 原则 | 落点 |
|---|---|
| P1 Tool First | UI 操作 ↔ Meta Tool 一一对应 · 自动回归校验 |
| P2 统一 React Agent | 不引入"KB agent" · `kb-researcher` skill 复用 AgentLoop |
| P3 Pure-Function Query Loop | 检索是 stateless tool · agent 多轮自驱 · 不藏状态 |
| P4 Skill 动态能力包 | `kb-researcher` / `kb-curator` 走 descriptor + body 渐进加载 |
| P5 Subagent 是 composition 基元 | 大量沉淀任务可 spawn `kb-curator` subagent · 独立预算 |
| P6 L4 + 护栏 + Deferred | 写操作走 confirmation · 无 grant 走 Defer 申请 |
| P7 状态可 checkpoint | 摄取状态机落 `documents.state` · 进程重启可续 |
| P8 视觉契约 | 所有 KB UI 走 brand-blue token · 双主题 visual regression |

---

## 14. 风险与待决问题

- **嵌入成本**:百炼/OpenAI 按 token 计费 → 大量 PDF 摄取要给用户 "estimated cost" 提示
- **OCR 体积**:paddleocr 模型 200MB+ → 列为 optional extras,默认关
- **音频转写延迟**:1h 音频 ~3min(faster-whisper base) → 异步队列(挂 trigger?)
- **chunk 粒度**:不同语料最优粒度不同 → v1 暂硬编码,v2 加 per-KB override
- **法律**:PUBLIC visibility 的 KB 怎么暴露给跨 workspace 检索? → 暂留 private only,别开
