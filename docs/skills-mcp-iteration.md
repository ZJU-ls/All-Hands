# Skills · MCP · Picker 体验重塑 — 10 轮迭代记录

> 分支 `feat/ui-tweaks` · 双向同步 main · 2026-04-26 长跑 · 11 轮微优化合集

---

## 0. 起点观察

调研 `web/app/skills/page.tsx` / `web/app/mcp-servers/page.tsx` /
`web/components/employee-design/SkillMultiPicker.tsx` /
`web/components/employee-design/McpMultiPicker.tsx` 后,数量大时的崩溃点
按"杀伤力"排序:

| # | 页面 | 数量破裂阈值 | 卡顿现象 |
|---|---|---|---|
| 🔥🔥🔥 | **MCP Servers 页** | > 10 servers | 零搜索框 + 零排序 → 失败的 server 混在中间,选健康的得肉眼扫 |
| 🔥🔥🔥 | **Skill / MCP 选择器** | > 20 chips | 平铺 chip cloud,无搜索无分组 → 滚 6 行屏幕找 |
| 🔥🔥 | **Skills 列表** | > 30 skills | 无排序 + 无分页 → 找不到刚装的;tag 12 个上限 |
| 🔥🔥 | **MCP 工具展开** | > 50 tools/server | 单选展开 + 内部无搜索 → "auth_*" 只能滚屏 |
| 🔥 | **chip 视觉信号** | 任意 | title attribute hover 文本 → 不能选中、不能展开 |

---

## 1. 设计原则 — 业界先进方案合集

迭代之前先把"长得啥样合理"的边界画清楚。每一轮都对照下面这张参考矩阵
做选择:

| 体验维度 | 我们采纳的样板 | 反例 |
|---|---|---|
| **即输入即过滤** | Linear 列表 / Raycast launcher / Algolia | ❌ 多数中文产品的"先输入再点搜索"按钮模式 |
| **count chip 反馈** | GitHub Issues / Notion Database | ❌ 只输入框,无"M / N"过滤效果可见性 |
| **键盘 / 全局聚焦** | GitHub `/` / Slack `Cmd+K` | ❌ 鼠标唯一交互 |
| **hover-peek 详情** | Notion / GitHub linked-issue / Linear | ❌ title attribute 只能纯文本 |
| **分组而非平铺** | Apple Settings / Linear inbox / Mac System Prefs | ❌ 100 项一字排开 |
| **失败置后** | Datadog Alerts / Linear closed issues | ❌ 失败的混在列表中段不可控 |
| **可控分页** | GitHub Marketplace / VSCode Extensions | ❌ 无限滚动(无回头路) |
| **关键词命中高亮** | Linear / Algolia | ❌ 列表显示但用户得肉眼比对 |

### 核心心智模型

把 Picker / 长列表统一视作"**Search → Filter → Sort → Render**"四段
管线。每一段都得有视觉反馈:

```
search box        → "M / N" count chip(过滤效果可见)
filter pills      → toggle/active 高亮(系统当前在用)
sort pills        → radio group(选了哪档清楚)
render            → 高亮命中 + groupBy + lazy load
```

---

## 2. 11 轮迭代摘要

### **R1 · 共享 SearchInput 单件**

- **新增** `web/components/ui/SearchInput.tsx`
- 一份实现,五处调用(SkillPicker / McpPicker / Skills 页 / MCP 页 / MCP 工具内搜索)
- 集成业界四个 ergonomic 默认行为:
  - `count + total` → "12 / 35" 实时反馈
  - `autoFocusOnSlash` → "/" 全局聚焦(对齐 GitHub Issues)
  - `compact` → h-8 嵌入 picker;默认 h-9 用作页头
  - `loading` → 左 icon 切 spinner(对齐 Algolia 即输模式)
- ✅ 杜绝下游各页"自己实现 input + 自己写 ×"的样式漂移

### **R2 · SkillMultiPicker 搜索 + 分组**

- 扁平 chip cloud → search 顶 + groupBy(已选 / 内建 / 市场 / GitHub / 上传 / 其他)
- "已选"组永远在顶,与 search 解耦 — **用户随时审计已挂载的样子**
- 命中 ≤ 6 时分组自动展开,省一次手动展开
- 后端早就吐 `source` / `version` / `installed_at`,前端 SkillDto 之前丢掉了 — 顺手补回
- 业界对照:Apple Settings 分组 + Linear inbox

### **R3 · McpMultiPicker 搜索 + health 分组**

- 同 R2 模式,分组按 health 切片:**已选 / 在线 / 不健康**
- 不健康默认折叠 — 失败 server 不该影响"选健康的"决策路径
- chip 上加红色边框暗示 + status dot + tooltip 解释
- 业界对照:Datadog Monitors 默认按 alerting 优先

### **R4 · Skill chip hover-peek**

- **新增** `web/components/ui/HoverPeek.tsx` 通用单件
- 200ms enter delay + 120ms leave delay → 鼠标快划不闪烁
- 触摸设备(no-hover MQ)直接禁用避免误触
- 浮层 onMouseEnter 取消 leave timer → 用户能选中文字、点链接
- 自动避让(超出右下边界翻转锚定)
- Skill peek 内容:完整描述 / source / version / tool 数 chip / `<details>` 折叠 tool_ids 列表(max-h-32 内滚)
- ✅ 用户挂载 skill 前能审"它带哪些工具",不必跳出 modal 回 Skills 页查
- 业界对照:Notion link mention / GitHub linked-issue / Linear hover-card

### **R5 · MCP chip hover-peek**

- 同 R4 模板。peek 显示:server id / transport / health / enabled 三状态 chip
- 失败 server 在 peek 底部加红字解释影响 — 不止 chip 上的红边

### **R6 · Skills 列表搜索 + 三档排序**

- SearchInput 顶部接入 · 模糊匹配 name + description + id
- SortPills(三档,radio group):
  - **recent** — 安装时间倒序,builtin 押后 + 字母序
  - **name** — A-Z
  - **tools** — 工具数倒序(挑"重量级"skill 直观)
- 默认 recent;切换 sort 不丢搜索词

### **R7 · MCP servers 列表 — 三件套**

零搜索 / 零排序 / 不健康混排 → 三件套补齐:

- SearchInput · count chip · "/" 全局聚焦
- 4 档 SortPills(health / name / tools / recent),默认 health(在线优先 + tool 数)
- "只看不健康" 红色 toggle:仅在存在不健康 server 时显示;点亮后只渲染失败的
- 不再让"在线 + tool 多"的 server 在非 health 排序模式下随机戴 gradient 头部
  → 视觉等级与排序对齐

### **R8 · Skill Market 分页 / load-more**

- 一次性渲染 100+ entry → 默认 24 + 底部"再加载 24 · 还剩 N"
- query / activeTag 变化时自动重置 — 否则 batches 指针越界
- 业界对照:GitHub Marketplace / VSCode Extensions(可控分页 vs 无限滚动)

### **R9 · 市场 tag 过滤"显示全部"**

- 打破 hard-coded slice(0, 12)
- 默认折叠 12 个高频 tag · "+ 更多 N" 展开全部 · "- 收起"回到紧凑
- **关键护栏**:activeTag 即便排在 12 之后也会出现在 folded 列表里 — 否则刷新后 user 看不到自己的选中态

### **R10 · MCP 工具 panel 多展开 + 内部搜索**

- expanded: string → Set<string>:能同时看 github vs filesystem 工具,无切换损耗
- ToolsList 子组件:tools > 6 时顶上插 compact SearchInput;tools > 12 时 ul max-h-72 内滚
- 业界对照:GitHub repo files panel 内部 search · VSCode Extension command palette

### **R11 · Skills 卡片关键词高亮**(并入 R6 一气呵成)

- `Highlight` 组件按 lowercase indexOf 切片,无正则注入风险
- 命中关键词在卡片标题 + 描述里 `<mark>` 高亮
- 业界对照:Linear inbox / Algolia results

---

## 3. 体验杠杆量化

| 改造前 | 改造后 |
|---|---|
| Picker 找特定 skill ≈ 6 行屏幕滚 | 搜索 + 分组 = O(1) 找到 |
| MCP 列表选健康 server = 肉眼扫红绿 | 默认按 health 排 + 不健康折叠 |
| 市场页初切 tab ≈ 600ms 卡顿 | 24 项首屏渲染 |
| chip 上看不到 skill 描述 | hover-peek 完整文档 + tool 列表 |
| 同时对比两 server 工具 = 反复切换 | 多展开 + 内部搜索 |
| 失败 server 视觉高于健康 server | 失败置后 + 默认折叠 |
| 同样的"复选框"出现 4 种 UI 风格 | 全部走 SearchInput / Group / Chip 三件套 |

---

## 4. 工程账

- **代码新增**:`SearchInput.tsx` (135 LOC) · `HoverPeek.tsx` (165 LOC)
- **代码删减**:无(扩展为主,picker 重写后行数翻倍但单体复杂度不变)
- **i18n 增量**:zh-CN + en 各 ~30 个 key
- **测试**:每轮跑通 typecheck + vitest(1794 passed)
- **提交粒度**:11 个独立 commit · 每轮 ≤ 3 文件
- **双向同步**:每轮推 feat/ui-tweaks + main · 共 11 次 fast-forward 推送

---

## 5. 待办 / 后续

- 🟡 SkillMultiPicker / McpMultiPicker 的 hover-peek 在小屏溢出右边界时的位置
- 🟡 Skills 详情 Drawer:点 chip 弹完整 SKILL.md 阅读 + "挂载/卸载"操作
- 🟡 Bulk select 模式("全选 builtin" / "选 5 项") · Linear 风格
- 🟡 视觉密度切换(Compact / Comfortable / Card)· 三档 segment
- 🟡 全局工具总览页(builtin + skill-derived + mcp 一屏看,反查"哪个员工挂载了我")

---

## 6. 设计沉淀

### 三条心智模型(可继续抽象到其他页面)

**1. 列表都是 Search → Filter → Sort → Render 四段管线。** 每段都要有视觉反馈,用户得清楚"系统现在在干嘛"。

**2. 已选 / 已用永远在顶。** Picker 类列表不论搜索/排序如何变,"已挂载的"分组永远固定在最上 — 这是 affordance 维度的"我能把它取消挂载吗"的视觉锚点。

**3. 失败状态置后 + 折叠。** 失败的 server / item 不该混在中间影响主流程。它要么独立分组(默认折叠),要么由排序规则压到底。

### 三个常见错误(我们这一轮纠正的)

**1. title attribute 当详情卡用。** title 不能选中文字,不能展开,不能放结构化内容,移动端完全失效。Notion / GitHub 早就用 popover 替代,我们补上 HoverPeek。

**2. hard-coded N 的"显示前 N"。** Top 12 tag 是合理默认,但拒绝展开就是设计遗憾。展开按钮 + 折叠回路一对儿一起加,activeTag 在折叠态的可见性不能丢。

**3. 单选展开。** "同一时刻只能展一个"在低密度场景没问题,但 MCP 工具对比 / Skill 多 details 阅读时反复切换太耗心智。Set 化展开 + 内部搜索是更稳的组合。
