# Artifact Kinds · Roadmap & 实现契约

**Status:** spec · 2026-04-25
**Owner:** liushuai
**Scope:** 把 Artifact 系统从「文本 + 图」扩到「办公文档族(pdf / xlsx / csv / docx / pptx)」 · drawio 加编辑模式 + 内置 skill 包 · 同时立一个稳定的「输入模式 × 渲染策略」框架,后续再加新 kind 不用动核心。

---

## 0. 设计原则

每个 artifact kind 都由 4 张能力卡片定义:

```
┌──────────────────────────────────────────────────────┐
│  KIND                                                │
│  ┌──────────────┬──────────────┬──────────────┐      │
│  │ 1. 输入模式   │ 2. 存储形态   │ 3. 生成管线   │      │
│  ├──────────────┼──────────────┼──────────────┤      │
│  │ 4. 渲染策略   │              │              │      │
│  └──────────────┴──────────────┴──────────────┘      │
└──────────────────────────────────────────────────────┘
```

**输入模式(agent → backend)只有三种**:

| 模式 | agent 给的 | 谁负责转 | 例子 |
|---|---|---|---|
| **text-identity** | 完整文本(utf-8) | 不转 · 直接落盘 | markdown / code / html / data / mermaid / drawio / csv |
| **binary-upload** | base64 字节流 | 不转 · 直接落盘 | image · 上传文件 |
| **structured-build** | 结构化 JSON | 后端调库渲染成二进制 | pdf · xlsx · docx · pptx |

**存储形态**:磁盘上的形态 · 永远是文件 · `<artifacts_root>/<workspace>/<artifact_id>/v<N>.<ext>`。

**生成管线**:
- text-identity:`encode("utf-8") → 写盘`
- binary-upload:`base64.b64decode → 写盘`
- structured-build:`build(input_json) → bytes → 写盘`(会走第三方库 · 可能报错)

**渲染策略**:
- **inline-text**:文本类直接看 · markdown/code/html/data/mermaid 走自己的 view
- **inline-iframe**:嵌 iframe(diagrams.net / browser pdf viewer)
- **inline-table**:表格组件 · csv/xlsx 共用
- **inline-doc**:docx-preview JS 渲染成 HTML
- **inline-meta**:解析元数据 + 文本 · 渲染卡片(pptx 用这套)
- **download-only**:仅下载 · 妥协方案

---

## 1. 当前 + 计划支持的 kind 全览

| kind | 输入模式 | 存储扩展 | MIME | 渲染策略 | 状态 |
|---|---|---|---|---|---|
| markdown | text-identity | .md | text/markdown | inline-text(MarkdownView) | ✓ 已上线 |
| code | text-identity | .txt | text/plain | inline-text(CodeView) | ✓ 已上线 |
| html | text-identity | .html | text/html | inline-text(HtmlView · 预览 + iframe sandbox) | ✓ 已上线 |
| image | binary-upload | mime 推断 | image/* | inline-iframe(ImageView) | ✓ 已上线 |
| data | text-identity | .json | application/json | inline-text(DataView) | ✓ 已上线 |
| mermaid | text-identity | .mmd | text/vnd.mermaid | inline-text(MermaidView) | ✓ 已上线 |
| drawio | text-identity | .drawio | application/vnd.jgraph.mxfile | inline-iframe(diagrams.net 嵌入,本次加编辑模式) | ⊕ 本次升级 |
| **pdf** | **structured-build** | **.pdf** | **application/pdf** | **inline-iframe(浏览器原生)** | **⊕ 本次新增** |
| **xlsx** | **structured-build** | **.xlsx** | **application/vnd.openxmlformats-officedocument.spreadsheetml.sheet** | **inline-table(SheetJS)** | **⊕ 本次新增** |
| **csv** | **text-identity** | **.csv** | **text/csv** | **inline-table(papaparse)** | **⊕ 本次新增** |
| **docx** | **structured-build** | **.docx** | **application/vnd.openxmlformats-officedocument.wordprocessingml.document** | **inline-doc(docx-preview)** | **⊕ 本次新增** |
| **pptx** | **structured-build** | **.pptx** | **application/vnd.openxmlformats-officedocument.presentationml.presentation** | **inline-meta(slide-list)+ download** | **⊕ 本次新增** |
| video | binary-upload | mime 推断 | video/* | inline-iframe(`<video>`) | △ 占位 · 后续 |

---

## 2. structured-build · 各 kind 输入 schema

### 2.1 `artifact_create_pdf`

```json
{
  "name": "report.pdf",
  "source": "markdown",            // 或 "html"
  "content": "# 标题\n\n正文...",
  "title": "可选 · 用作 PDF metadata"
}
```

**生成管线**: `markdown → markdown-it → html → weasyprint → pdf bytes`
若 source=html · 跳过 markdown 步骤直接 weasyprint。

**约束**:
- content ≤ 1MB
- 内嵌图片必须是 `data:` URL 或 https:// 公网可访问
- 不支持 JS · 不支持外部 CSS(inline `<style>` 可)

### 2.2 `artifact_create_xlsx`

```json
{
  "name": "sales-2026Q1.xlsx",
  "sheets": [
    {
      "name": "Q1 总览",
      "headers": ["产品", "销量", "金额"],
      "rows": [
        ["A", 100, 9999.99],
        ["B", 50, 4500]
      ]
    }
  ]
}
```

**生成管线**: `openpyxl.Workbook → .xlsx bytes`

**约束**:
- ≤ 100 个 sheet · 每 sheet ≤ 100k 行(防爆内存)
- 单元格类型自动推断:int/float/bool/str/date

### 2.3 `artifact_create_csv`

```json
{
  "name": "data.csv",
  "headers": ["col1", "col2"],
  "rows": [["a", 1], ["b", 2]]
}
```

**生成管线**: text-identity · 直接拼 csv 字符串

**约束**: 同 markdown 文本上限。逗号 / 引号自动 quote · 支持 utf-8。

### 2.4 `artifact_create_docx`

```json
{
  "name": "proposal.docx",
  "blocks": [
    {"type": "heading", "level": 1, "text": "标题"},
    {"type": "paragraph", "text": "段落..."},
    {"type": "list", "ordered": false, "items": ["项 1", "项 2"]},
    {"type": "code", "language": "python", "text": "print('hi')"},
    {"type": "table", "headers": ["a", "b"], "rows": [["1", "2"]]}
  ]
}
```

**生成管线**: `python-docx · Document() → .docx bytes`

**支持 block 类型**: heading(level 1-6) / paragraph / list(ordered & unordered) / code(monospace 段落) / table

### 2.5 `artifact_create_pptx`

```json
{
  "name": "deck.pptx",
  "slides": [
    {
      "layout": "title",          // title | bullets | image-right | section
      "title": "首页",
      "subtitle": "可选"
    },
    {
      "layout": "bullets",
      "title": "议程",
      "bullets": ["第一项", "第二项"]
    }
  ]
}
```

**生成管线**: `python-pptx · Presentation() → .pptx bytes`

**渲染**:
- v0 妥协:解析 pptx 提取每页 title + 文本 → 卡片列表(`PptxView`)· 满屏 + 「下载 .pptx」CTA
- v1(后续):docker 加 LibreOffice headless · convert-to PDF · 复用 PdfView · 高保真预览

---

## 3. 文件归位

### 3.1 后端

```
backend/
├── pyproject.toml                          # +weasyprint +openpyxl +python-docx +python-pptx
├── src/allhands/
│   ├── core/artifact.py                    # +PDF/XLSX/CSV/DOCX kind · +CSV→TEXT_KINDS · +pdf/xlsx/docx/pptx→BINARY_KINDS
│   ├── execution/tools/meta/
│   │   ├── artifact_office.py              # 新文件 · 4 个 office tool 定义
│   │   └── executors.py                    # +5 个 make_artifact_create_*_executor + 注册到 READ_META_EXECUTORS
│   └── services/artifact_service.py        # _DEFAULT_MIME / _KIND_EXT 同步
└── tests/unit/
    ├── test_artifact_pdf_generator.py
    ├── test_artifact_xlsx_generator.py
    ├── test_artifact_csv_generator.py
    ├── test_artifact_docx_generator.py
    └── test_artifact_pptx_generator.py
```

每个 generator 独立模块在 `services/artifact_generators/{pdf,xlsx,docx,pptx,csv}.py`,executor 是薄壳。这样未来想换 weasyprint → playwright PDF 可以原地切换不动 tool 注册。

### 3.2 前端

```
web/
├── package.json                            # +xlsx (SheetJS) +papaparse +docx-preview
├── components/artifacts/kinds/
│   ├── PdfView.tsx                         # 新 · <iframe> blob URL
│   ├── XlsxView.tsx                        # 新 · SheetJS → 表格
│   ├── CsvView.tsx                         # 新 · papaparse → 表格(共享 TableView)
│   ├── DocxView.tsx                        # 新 · docx-preview JS
│   ├── PptxView.tsx                        # 新 · 解析 pptx 提取文本 → 卡片列表
│   ├── DrawioView.tsx                      # ⊕ 加 editable mode
│   └── _shared/Table.tsx                   # 抽出来给 csv + xlsx 共用
├── components/render/Artifact/Preview.tsx  # +5 case
├── components/artifacts/ArtifactDetail.tsx # +5 view 接入 + drawio 编辑按钮
└── lib/artifacts-api.ts                    # ArtifactKind 加 csv · isBinaryKind 调整
```

### 3.3 内置 skill

```
backend/skills/builtin/drawio-creator/
├── SKILL.yaml                              # descriptor · 教 agent 调 read_skill_file
├── SKILL.md                                # body · 引导式 + 模板表
└── templates/
    ├── flowchart.drawio.xml
    ├── sequence.drawio.xml
    ├── er.drawio.xml
    ├── architecture.drawio.xml
    └── mindmap.drawio.xml
```

---

## 4. drawio 编辑模式契约

- `DrawioView` 接收 `editable: boolean = false`(默认仍只读 · 性能优先)
- `ArtifactDetail` toolbar 加「编辑」按钮 · 点击后 view 切到 `editable=true`
- iframe 加载后 postMessage `{action: "load", xml, autosave: 1}` 注入
- 监听 iframe 的 `save` event(diagrams.net embed 协议)· 拿到新 xml → `updateArtifact(id, {content: newXml})`
- 保存成功后退出编辑模式 · artifact 自动 +1 version · 版本血缘走 v2 字段

---

## 5. drawio-creator skill 包

`SKILL.md` 教 agent 三步式工作流:
1. 用 `read_skill_file('drawio-creator', 'templates/<type>.drawio.xml')` 拿模板
2. 把模板里的占位文字按用户需求替换
3. 调 `artifact_create({kind: 'drawio', name, content})`

模板覆盖最常用的 5 种图(流程 / 时序 / ER / 架构 / 思维),每个 ≤ 30 行 mxfile 起手 · agent 容易照抄改对。

---

## 6. 错误处理 + 边界

| 失败点 | 怎么报 | 谁兜底 |
|---|---|---|
| weasyprint 图片下载超时 | tool 返回 `{error: "image fetch timeout: <url>"}` · 不部分写盘 | agent 重试或换 url |
| openpyxl 行数超 100k | tool 返回 `{error: "exceeds row cap"}` | agent 拆 sheet |
| python-docx 不识别 block.type | 跳过 + 在 result.warnings 里记录 | agent 自检 |
| 前端 docx-preview 渲染失败 | 卡片自动退化成 「下载 .docx」 + 错误信息 | 用户下载 |
| pptx 解析提取不到文本 | PptxView 显示 「N 张幻灯片 · 无法解析文本 · 请下载查看」 | 用户下载 |

---

## 7. 系统依赖 + 镜像影响

新增 Python 依赖(纯轮子 + 可选系统库):

| 包 | 系统依赖 | 大小 |
|---|---|---|
| weasyprint | cairo / pango / gdk-pixbuf | ~30MB |
| openpyxl | 无 | ~10MB |
| python-docx | 无 | ~3MB |
| python-pptx | 无 | ~4MB |

cairo / pango 在 Debian-slim docker 里 `apt install libpango-1.0-0 libcairo2 libgdk-pixbuf-2.0-0`,镜像总增量约 ~40MB。

LibreOffice 暂不装(等 v1 真要做 pptx 高保真预览再加,届时增量 ~600MB · 单独走 ADR)。

前端新依赖:

| 包 | 大小(gzipped) |
|---|---|
| xlsx (SheetJS) | ~150KB |
| papaparse | ~13KB |
| docx-preview | ~80KB |
| jszip | ~30KB(pptx 解析复用)|

总增量 ~270KB · 都是动态 import · 不影响首屏。

---

## 8. 提示工程契约(给 agent 看的)

每个新 tool 的 description 都包含:
- 一句话「什么时候用」
- 最小可运行示例(放进 description 里 · LLM 直接照抄)
- 上限 / 失败模式说明

drawio-creator skill 的 SKILL.md 是这个模式的反面 · 用 prompt fragment 教 agent 写出能渲染的 mxfile · 不靠 description 单点教学。

---

## 9. 验收脚本

每个 kind 一条端到端:

1. 让 Lead 调对应 tool 产一个制品
2. 在制品库 `/artifacts` 里看到条目 · 点击进入详情
3. 确认渲染正确(文本可读 / 表格有数据 / pdf 翻页 / docx 排版)
4. 点「下载」拿到正确扩展名的文件 · 用对应 OS 软件能打开
5. drawio:在详情页点「编辑」· 改一个节点名 · 保存 · 看版本号 +1 + 历史里能 diff

---

## 10. 不在本次范围

- pptx 高保真预览(LibreOffice)
- docx → markdown 反向解析(用户上传 docx 后端解析)
- xlsx 公式 / chart / pivot table(openpyxl 写公式可,但渲染端不算)
- pdf 编辑(只读)
- audio / video kind 的产出工具
- 制品搜索全文索引(目前只搜 name / description / summary)

这些都按本 spec 的「输入模式 × 渲染策略」继续往下加 · 不用改框架。
