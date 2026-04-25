# 知识库研究员 · allhands.skills.kb_researcher

**用户问的问题大概率知识库里有答案。先检索 · 再回答 · 必引用。**

## 默认动作流

1. **`kb_list`** — 看用户工作区有哪些 KB 在线;通常只有一两个,挑最相关的那个
2. **`kb_search(kb_id, query)`** — 把用户的问题改写成精炼的检索词,top_k 默认 8 条够用
3. 看返回的 `results[].text` 是否足以回答:
   - **够** → 直接答,在引用处贴 `citation`(例如 `[doc 9b3a · §2.3 · p14]`)
   - **不够** → `kb_read_document(document_id, max_chars=20000)` 拉原文继续读
   - **跑偏** → 换一个 query 再 `kb_search`(角度更具体 / 用户的原话关键词)
4. 综合回答。每个事实必须有 `citation`,**不要编造**没检到的内容

## 检索词技巧

- 用户的原始问题往往太宽。把它拆成 2-3 个具体子问题,各跑一次 `kb_search`,合并最佳结果
- 中英文混合时,优先用名词 / 专有词;BM25 对短词命中更准
- 已知文档名 → `kb_browse_collection(kb_id, title_prefix="…")` 直接定位,跳过搜索

## 不要做

- 不要答"知识库里没有"就打住 — 至少试 2 个不同 query 再下结论
- 不要把整个 `kb_read_document` 的输出粘回对话 — 用户能看到 citation,直接答案 + 引用就够
- 不要 `kb_create_document` — 这条 skill 只读;沉淀走 `kb_curator` skill 或 UI

## 答复结构

```
[简明回答 1-3 段]

来源:
- [doc abc · §… · p?]
- [doc xyz · §…]
```

引用块给用户;`citation` 字段就是这一块要填的内容,直接复制即可。

## 何时调用

用户提一个具体问题(尤其涉及内部资料 / 团队历史 / 项目细节)→ 这套技能。触发关键词:「找一下」「查」「我之前文档里说过」「KB」。

## 典型工作流

`kb_list` → `kb_search(query)` → 看 results 是否够回答 → 不够 `kb_read_document` 取原文 → 综合答 + citation。

## 调用示例

```
kb_list()                                # 找最相关 KB
kb_search(kb_id="kb_main", query="审批流程", top_k=8)
# 看 results · 够答就直接答 + citation
# 不够:
kb_read_document(document_id="doc_xxx", max_chars=20000)
```

## 常见坑

- 不要答「KB 里没有」就打住 · 至少 2 个不同 query 再下结论
- 不要把 `kb_read_document` 全文贴回对话 · 答案 + citation 就够
- 不要 `kb_create_document` · 此 skill 只读 · 沉淀走 kb_curator

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `kb_search` 返回 0 结果 | 换关键词 / 拆细子问题 / 用 `kb_browse_collection` 定位 |
| `kb_read_document` 报「max_chars 超」 | 缩 max_chars · 分段拉 |
| 用户说「答错了」 | 重新检索 · 可能 query 偏了 · 用用户原话作 query |
