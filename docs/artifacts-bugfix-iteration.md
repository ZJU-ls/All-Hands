# 制品库整体 review + bug 修复 — 10 轮迭代

> 分支 `feat/ui-tweaks` · 双向同步 main · 2026-04-27 · 用户报"筛 csv 时左侧空白 + 右侧详情仍是 drawio"开始的彻底诊断与修复

---

## 0 · 用户复现的现象

截图证据:
- 顶部 stats 卡显示 **"csv · 2"**
- 用户点 csv 类型 filter
- 过滤面包屑显示 **"csv ×"** + **"2 个制品"**
- 但**左侧列表完全空白**
- **右侧详情面板还在显示之前选中的 .drawio 文件**

这是两个独立的故障一起暴露:`csv 类型不渲染` + `selectedId 不回收`。

---

## 1 · 根因分析(三连级联)

### 故障 A · 前端 KIND_ORDER 不全

`web/components/artifacts/ArtifactList.tsx:17-27` 的 `KIND_ORDER` 只列了 7+1 个 kind(含一个根本不存在的 `video`),漏掉 **csv / xlsx / docx / pdf**。

分组循环:
```ts
for (const kind of KIND_ORDER) {
  const items = byKind.get(kind);  // csv 永远找不到 bucket
  if (items?.length > 0) sections.push({ title: kind, items });
}
```

→ csv 制品落入 `byKind` map 但 KIND_ORDER 不遍历,**整组被静默吞掉**。

### 故障 B · KINDS array 不全

`web/app/artifacts/page.tsx:34-42` 的 KINDS 同样只 7 项,**filter 下拉根本选不出 csv**。用户能点上面 stats 卡的 "csv · 2" 是因为 stats 卡用 `setKind(k)` 直接传字符串,绕过了下拉选项。

### 故障 C · selectedId 不回收

`useEffect` 拉新 list 后只 `setItems(next)`,从不验证 `selectedId` 是否还在新 list 里。filter 变化后,详情面板继续渲染 stale 的 drawio。

---

## 2 · 10 轮迭代摘要

### **R1 · 修 csv 过滤空白(三连修复)**

- KINDS 数组补全 12 项(对齐 backend `ArtifactKind` enum)
- KIND_ORDER 补全 12 项 + 引入 `FALLBACK_BUCKET = "other"`,**未来 backend 加新 kind 时不会再被静默吞**
- `setSelectedId((cur) => next.some(a => a.id === cur) ? cur : null)`:filter 切换后自洽回收

### **R2 · 删除 / 批量后状态回收**

- `bulkSelected` 在 list 刷新时同步剔除"不在新 list 里的项"
- 防止"看不见但勾选了"的项被误删
- 单删 / 批量删 / SSE 删除 全链路自洽

### **R3 · KIND_LABEL / ICON 补全 12 类**

- `ArtifactListItem` 的 KIND_LABEL/ICON 之前漏 csv/xlsx/docx/pdf,显示原始 kind 字符串 + 通用 file 图标
- 优化语义:csv/xlsx → table icon · docx → file-text · pdf/pptx → file
- 新注册 lucide `Table` + `FileText` 到 icon 单件
- 同步统一 page.tsx / ArtifactGrid / ArtifactPeek 三处的 KIND_ICON

### **R4 · 幽灵 video 类型移除**

前端 `ArtifactKind` 含 `"video"` 但 backend enum 没有 — 死代码 + 误导(filter 下拉里能选 video,但永远 0 个结果)。

- lib/artifacts-api.ts · 联合类型去掉 `"video"`
- BINARY set 去掉
- 4 个 KIND_ICON 表(page / Grid / Peek / ListItem)同步去 video 行
- 严格对齐 backend enum,要支持视频时先动后端

### **R5 · SSE artifact_changed 同步刷 list**

原实现只刷 stats,导致"顶部 +1 但 sidebar 看不到"。落地:
- `filtersRef` 持有 filter 当前值
- `fetchList` useCallback 不带 deps,SSE handler 调用时永远拿最新 filter
- inflight `busy` flag 简单防抖避免 burst create 连发
- selectedId / bulkSelected 在 SSE 后也走自洽回收

### **R6 · 空态文案与 filter context 联动**

按主导维度精确反馈,而不是统一"无制品":
| 触发条件 | 文案 |
|---|---|
| 仅 kind | 没有 {kind} 类型的制品 |
| 仅 query | 没有匹配「{query}」的制品 |
| kind + query | {kind} 类型里没有匹配「{query}」的制品 |
| pinnedOnly / dateRange | 当前筛选下没有制品 |
| 全空 | 工作区里还没有任何制品 + 引导去 chat |

业界对照:GitHub Issues 空态会写 "No issues match: is:open author:foo",反馈"系统现在过滤的是什么"比"空"重要。

### **R7 · 搜索 debounce 250ms**

- 每次按键都打 200-item 请求 → 6 字符 = 6 个 query
- `debouncedQ` 让 effect 只在键入暂停 250ms 后触发刷新
- 离散 filter(kind/sort/pinned/dateRange)继续立即生效
- fetchList 通过 filtersRef 读 q,debounce 只控**请求频率**,不影响显示值

### **R8 · ErrorBoundary 包裹详情面板**

新增 `web/components/ui/ErrorBoundary.tsx` · 标准 React class boundary:
- `resetKey={selectedId}` 切换制品自动 reset
- `<details>` 折叠原始 stack(默认收起)
- 「重试渲染」按钮 onReset
- 「下载原文件」链接走 `/api/artifacts/{id}/content?download` 字节流,**即便前端 view 渲染挂了也能拿原始数据**

业界对照:Sentry React 文档推荐做法 / Linear / GitHub 文件预览失败时的降级模式。

### **R9 · 详情面板 polish**

- 标题副信息整行可点击复制 artifact ID,工程师调试 / 反馈 bug 常用
- 视觉信号弱(group-hover 才显示 ✓)避免抢主操作
- 内容区滚动框加 `.scroll-fade-bottom` mask:底部 28px 渐隐,暗示"还有内容滚不到位"

### **R10 · md + html 收尾报告**

本文档。

---

## 3 · 风险面回顾

调查时识别的所有可疑点(已修 ✅ / 已观察待跟踪 🟡):

| Tier | 项 | 状态 |
|---|---|---|
| 🔥🔥🔥 | csv filter → empty list + stale detail | ✅ R1 |
| 🔥🔥 | 删除后 selectedId 不回收 | ✅ R2 |
| 🔥🔥 | bulkSelected 漂移到不可见项 | ✅ R2 |
| 🔥🔥 | SSE 刷 stats 不刷 list | ✅ R5 |
| 🔥🔥 | KIND_LABEL/ICON 5 个 office 类漏 | ✅ R3 |
| 🔥🔥 | 幽灵 video 类型 | ✅ R4 |
| 🔥 | 搜索每键发请求 | ✅ R7 |
| 🔥 | 空态文案不区分 filter context | ✅ R6 |
| 🔥 | 一个 view 崩溃整面板黑屏 | ✅ R8 |
| 🔥 | 长内容滚动无视觉提示 | ✅ R9 |
| 🟡 | 大列表无 virtualization | 待跟踪(< 500 项无影响) |
| 🟡 | bulk pin 失败的部分回滚体验 | 已有,可加单元测试 |
| 🟡 | 后端 ArtifactKind enum 加新值时前端守护 | FALLBACK_BUCKET 已铺底 |

---

## 4 · 工程账

- **新增文件**:`ErrorBoundary.tsx` (76 LOC)
- **修改文件**:`page.tsx` / `ArtifactList.tsx` / `ArtifactListItem.tsx` / `ArtifactGrid.tsx` / `ArtifactPeek.tsx` / `ArtifactDetail.tsx` / `artifacts-api.ts` / `icon.tsx` + 2 份 i18n
- **i18n 增量**:zh-CN + en 各 6 个 key(空态 4 + ErrorFallback 5 + copy id 1)
- **测试**:每轮跑通 typecheck + vitest(1794+ passed)
- **提交粒度**:5 个独立 commit · 每轮 1-3 文件
- **双向同步**:每轮推 feat/ui-tweaks + main · 共 5 次 fast-forward

---

## 5 · 设计沉淀

### 三条心智模型

**1. 类型穷举的 Record map 是结构性 bug 防线。**
`Record<ArtifactKind, T>` 的 TS 严格穷举让"漏 csv"立刻爆编译错误。但 KIND_ORDER 是 `as const` 元组,**不是穷举**,所以漏了也不会爆 — 只会运行时静默吞数据。教训:**任何"按 kind 路由 / 分组"的数据结构,优先用 Record 而不是 array。**

**2. selectedId / bulkSelected 是"派生 from items"的隐式状态。**
items 一变,所有引用 items[i].id 的状态都该重新对齐。把这种"自洽回收"做进 fetchList 完成的钩子,而不是散落到每个 mutator 里(单删 / 批量删 / filter 变 / SSE 刷)。

**3. 空态文案要回答用户"现在为什么是空"。**
"暂无制品"是 0 信息文案,用户得自己回想"我筛了什么"。GitHub / Linear 的范式:**显式列出当前过滤维度** + 引导清空。

### 三个常见错误(我们这一轮纠正的)

**1. 前后端类型不对齐。** 前端 ArtifactKind 含 "video" 是死代码 + UI 误导。每次扩枚举,前端要 `Record<X, T>` + 后端 enum 双侧改,任一漏会立刻爆。

**2. 单一信号一刷。** SSE artifact_changed 只刷 stats 没刷 list,因为最初实现时只想用它"提示数字变化"。但用户期望"看到的就是真的"— 必须同步刷 list。

**3. 长内容无 mask。** 长 csv / 大 markdown 滚动到底部时,如果底部直接被 toolbar 切断,用户分不清"是真没了"还是"还有更多"。28px fade-bottom 是低成本高信号的修复。

---

## 6 · 后续 / 待办

- 🟡 bulk pin 失败的部分回滚体验加单元测试覆盖
- 🟡 大列表(>500)的 virtualization(react-window)
- 🟡 详情 tab 切换的 deep-link(`?selected=xxx&tab=metadata`)
- 🟡 ArtifactList 在多类制品时的 collapse-all / expand-all
- 🟡 Skill / MCP / Tools 列表也补 ErrorBoundary

---

> **诊断 → 实施 → 验证** 的纪律比代码本身重要。先盘点风险面,再排序杀伤力,再逐项落地;每轮 commit 独立可回滚 — 这套节奏在生产风险面有限的功能上是最稳的迭代姿势。
