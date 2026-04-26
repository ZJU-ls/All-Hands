# i18n 8h 连续迭代日志

> 用户睡觉前布置:连续迭代优化全平台中英双语 ~8 小时,产出 HTML 报告。
> 本文件按轮次记录每轮做了什么、碰到什么、改了多少 key / 文件。

## 总览

- **开始时间**:2026-04-25 ~21:00 GMT+8
- **目标轮数**:~16 轮(每轮 ~30min)
- **基线状态**:catalog 已大致铺开,~1700+ keys × 2 locales,主要痛点是 origin/main 持续推新功能(尤其 KB 模块大改),需要持续追平
- **轮换主题**:翻译质量 / 形状对齐 / ICU 占位符一致 / 视觉溢出 / 缺漏扫描 / 文案友好度 / 边角文案 / merge main / 单测 / 构建产物

## Round 1 · 2026-04-25 21:00

**主题**:pull main + 重写后的 Knowledge 页 i18n + 翻译质量第一轮抽查

**碰到**:origin/main 又推了一次大改 —— Knowledge 页从 ~500 行重写到 1496 行新布局(顶部 toolbar + 文档 grid + 详情 drawer);新增 5 个 artifact viewer (Csv/Docx/Pdf/Pptx/Xlsx) + StoragePathsCard。新文件无中文(纯展示组件包了 lib),但 Knowledge 页又裸出了 123 处中文。

**做的事**:
- merge origin/main(无冲突,自动合并)
- 启动 docs/i18n-iteration-log.md(本文件)
- 派子 agent 重做 Knowledge 页 i18n(并行)
- 主线检查 catalog 形状对齐

**结果**:KB 页 147 keys · 形状 100% 对齐 · 0 placeholder mismatch

**commits**:3a9b1b4 · e9d8969 · d3f8ca3

## Round 2 · 2026-04-26 00:00

**主题**:merge main + ArtifactPeek 时间格式化 + LocaleSwitcher 单测 + KB 增量

**碰到**:origin/main 又给 KB 页加了 onboarding wizard / URL ingest modal /
upload progress strip / Ask 模式 RAG / 拖拽上传 / 文档批选 等大堆新功能,
新增 ~174 处中文。需要再派 agent 跟。

**做的事**:
- 拉 main(无源代码冲突)
- ArtifactPeek 的 `relativeTime` helper(刚刚 / N 分钟前 / N 小时前 / N 天前)
  迁出到 `artifacts.peek.{justNow,minutesAgo,hoursAgo,daysAgo,size,updated,created}`
  · 14 keys × 2 locales
- 新增 `tests/i18n-locale-switcher.test.tsx` · 4 个 contract 测试覆盖
  compact / full 两种模式 + 切换 action 触发 / refresh 调用 / 同 locale 不触发
- 派 agent 把 KB 剩余 174 行中文迁完 · catalog 又扩 ~80 keys 横跨 8 个新
  sub-namespace(dragOverlay / onboarding / urlIngest / uploads / ask / ...)
- KB 页 lint 警告 2 处 useEffect deps disable 行加上(matches 项目风格)

**结果**:
- 1863 tests passed · typecheck/lint/build 全绿
- catalog: zh-CN 2209 / en 2209 keys · 100% intersect

**commits**:11dd3af · e381edd

## Round 3 · 2026-04-26 01:00

**主题**:merge main + 缺漏扫描 + chat 衍生组件 i18n + ModelRow / DesignForm

**碰到**:origin/main 加了 round 17-19 的 skill packs + skill files API + UI
section · 新源码 380 行,但已带 i18n。MessageBubble / ToolCallCard /
SubagentProgressSection / PlanProgressSection / ModelRow / DesignForm 残留
116 个未翻译 char(都是新功能,前几轮 agent 没覆盖到)。

**做的事**:
- 严格写了一个 grep 脚本(剥 block 注释 + 行注释 + JSX 注释)精确扫描
  live Chinese chars。比 grep -v 模式更可靠。
- MessageBubble:已中止 tail / 工具执行 pulse 走 chat.messageBubble.*
  (interrupted / interruptedTitle / toolPulse)
- ToolCallCard:子代理 run 链接走 chat.toolCall.*(subagentRun / viewTrace)
- SubagentProgressSection:活跃子代理 / 查看链路 走 chat.subagent.*
- PlanProgressSection:运行中 / 失败 计数走 chat.planProgress.*
- ModelRow:默认徽标 / 设为默认按钮 + tooltip 走 gateway.modelRow.*
- DesignForm:必填字段错误提示走 employees.designForm.field.required

**结果**:
- catalog: zh-CN 2168 / en 2168 keys · 100% intersect · 0 mismatch
- 1881 tests passed · typecheck/lint/build 全绿
- live Chinese chars 从 116 → 远小,大头剩余 5-9 个 file 的微量

**commits**:待提交

## Round 4 · 2026-04-26 01:50

**主题**:metadata locale-aware + ArtifactGrid relativeTime + 实战 HTML 抽查

**碰到**:之前没人查 `<head>` metadata 的 description · 跑 prod server
对比 EN/ZH HTML 输出发现 `<meta name="description">` 在两个 locale 下都
是同一份英文(layout.tsx 里 export const metadata 静态值)。

**做的事**:
- app/layout.tsx 把静态 `metadata` 改成 `generateMetadata()` async ·
  调用 `getTranslations("metadata")` 拿当前 locale 的描述
- 新增 metadata.description 到根 catalog · zh "开源自部署的数字员工组织
  平台" · en "an open-source, self-hosted digital workforce platform"
- ArtifactGrid 的 relativeTime helper 沿用 ArtifactPeek 的同名 keys
  (复用 artifacts.peek.justNow,而不是再造一份 · DRY)
- pnpm build + next start -p 4001 跑两个 locale 抓 HTML 实测,确认 meta
  description 现在按请求 locale 切换(EN: "an open-source, self-hosted..."
  · ZH: "开源自部署的数字员工组织平台")

**结果**:
- live chars 12 → 6(剩下 6 全是 BrandMark / PlanCard 的 regex 模式
  匹配中文品牌名,必须保留)
- 1881 tests passed · typecheck/lint/build 全绿
- meta description 实测两 locale 切换正确

**commits**:待提交

## Round 5 · 2026-04-26 02:20

**主题**:后端 router 残留错误 i18n + catalog audit 入测试

**碰到**:Round 1-4 的后端 i18n 主要覆盖了 not_found 系列,但 origin/main
后续给 employees / chat / observatory / knowledge / user_input / mcp_servers /
artifacts 加了不少新的 HTTPException(动态 ID 拼接、unknown_kind、transport
validation 等)未走 i18n。

**做的事**:
- backend i18n catalog 扩 11 个 keys:
  errors.not_found.{employee_id,conversation_id,trace_id,run_id,document_in_kb,user_input}
  · errors.unknown_{kind,preset} · errors.transport_invalid · errors.kb_fetch_failed
  · errors.answers_not_dict · 都带 ICU `{id}/{kind}/{preset}/{raw}/{detail}` 占位符
- 7 个 router 文件 import t · 替换 12 个 raise HTTPException 用 t():
  employees(4) · chat(5) · observatory(2) · knowledge(3) · user_input(2) ·
  artifacts(1) · mcp_servers(1) · providers(1)
- backend test_i18n 加 2 个新测试:
  · test_round_5_new_keys_have_both_locales — 11 个新 key 在两个 locale 都存在 + 非空
  · test_catalog_zh_en_have_same_key_shape — backend catalog 形状对齐(防止半合并)
- 前端新加 tests/i18n-catalog-audit.test.ts · 3 个 contract 测试:
  · 形状对齐(missing_in_en / missing_in_zh)
  · ICU 占位符两边一致
  · 没有 empty value
  这些测试现在跑在 pnpm test 里,以后每次 PR 都会自动 catch 漂移。

**结果**:
- 11 backend i18n tests + 1884 web tests passed · typecheck/lint/build 全绿
- catalog audit 现在是回归测试的一部分,半合并永远不再悄悄过线

**commits**:待提交

## Round 6 · 2026-04-26 03:00

**主题**:i18n bad-pattern 修复 + 标点统一 + pnpm 别名

**碰到**:翻译质量复审发现 triggers card 用了"split-translation"反模式 ——
`{prefix} N {suffix}` 三段拼接,这种模式在英文里语法可能错(因为词序不
一定能匹配 prefix-N-suffix)。10 处 en/json 用了 ASCII "..." 而不是
horizontal ellipsis "…",和其他 placeholder 不一致。

**做的事**:
- 重构 `triggers.list.card.{firesPrefix,firesSuffix}` 拼接 → 单一 ICU 字符串
  `firesTotal: "Fired <n></n> times"` / "触发 <n></n> 次"
  + `lastFiredAt: "Last fired <time></time>"` / "最近触发 <time></time>"
  · 用 `t.rich()` 渲染 inline `<span>` 保持原本字体效果
- 11 处 `...` → `…`(horizontal ellipsis · U+2026):skills-market.json
  10 处 + gateway-cockpit.json 1 处 · 保留 sk-... 作为 API key prefix 示例
- package.json 加 `pnpm audit-i18n` + `pnpm audit-i18n:strict` 别名
  让本地 / pre-push hook 一行跑形状校验

**结果**:
- 所有现有形状 / 占位符 / 空值检查仍通过
- 1884 web tests · backend 11 i18n tests 全绿 · build 绿

**commits**:待提交

## Round 7 · 2026-04-26 03:30

**主题**:回归网 + 残留扫描 + 美式拼写

**碰到**:Round 5 的后端扫描漏了 user_input.py:60 "user_input is not pending"
(因为 detail 在第 60 行新加的,grep 跑过早)。需要锁定回归。

**做的事**:
- 新加 backend 测试 tests/unit/test_no_hardcoded_chinese_in_routers.py:
  扫所有 routers/*.py · 任何 `detail="..."` 或 `detail=f"..."` 字面量都
  失败 · 只放过 `t(...)` / `str(exc)` / `repr(exc)` / 普通变量名。
  ↓ 该测试找到上面的漏网之鱼,补 errors.user_input_not_pending key 后通过
- 新加前端测试 tests/i18n-no-hardcoded-zh.test.ts:扫 app/components/*.tsx
  · 剥掉 block / line / JSX 注释 · 中文 char count 必须为 0(allowlist
  豁免 BrandMark / PlanCard 的 regex 模式)。当前通过 — 0 文件违规。
- 修一处英式 → 美式拼写:settings.autoTitle "summarise" → "summarize" ·
  autoTitleDescription "summarises" → "summarizes"

**结果**:
- 12 backend i18n + scan tests · 1885 web tests · build 全绿
- 两个新 regression net 入 vitest / pytest,以后 PR 闭环

**commits**:待提交

## Round 8 · 2026-04-26 04:15

**主题**:最终轮 · 收尾 + HTML 报告

**做的事**:
- 生成 docs/i18n-final-report.html(618 行 · self-contained · light/dark 自适应):
  - stats grid · 8 轮时间线表格 · 5 个 before/after 对比 · catalog 完整度 · 已知不翻译清单 · next steps
- 启 HTTP server 通过 http:// URL 发出报告(不给 file://)

**结果**:i18n 8 轮迭代收尾 · 报告交付。

**commits**:见 git log

## Round 9 · 2026-04-26 04:45 (cron · 30m)

**主题**:KnowledgeService 6 处用户可见硬编码中文 → t()

**做的事**:
- backend i18n catalog 加 6 个 key:
  - knowledge.embedding.label.aliyun · knowledge.embedding.reason.add_openai · knowledge.embedding.reason.add_aliyun
  - knowledge.ask.no_hits · knowledge.ask.no_chat_provider · knowledge.ask.llm_failed
- knowledge_service.py 把 embedding option label / reason · ask 无命中文案 · ask LLM 失败 · stream LLM 失败 全部包成 t()
- 系统 prompt(_ASK_SYSTEM_PROMPT)保留中文 — 那是模型的 instruction,不是用户可见

**结果**:1569 backend tests 全绿 · web typecheck 全绿 · regression net 也全绿(知识库回答现在跟着 Accept-Language 走)

**commits**:见 git log

## Round 10 · 2026-04-26 04:55 (cron · 30m)

**主题**:剩余 backend 用户可见硬编码中文 → t()(model_service · system paths)

**做的事**:
- model_service.py 2 处:thinking 不支持 warning · empty response stream error
- api/routers/system.py 5 行 SystemPathEntry:label / description 全包 t()
  · 之前是双语连写(label="数据根目录 · Data root"),现在按 locale 单出
- backend i18n catalog 加 12 个 key(2 + 10)

**结果**:1570 backend tests 全绿 · ruff / lint-imports 全绿。剩下的中文都是
LLM system prompt(_ASK_SYSTEM_PROMPT / ai_explainer / chat 标题生成器)— 那
是模型 instruction · 不是 UI 文本。

**commits**:见 git log

## Round 11 · 2026-04-26 05:13 (cron · 30m)

**主题**:广度审计 · 验证回归网仍然把得住主线

**做的事**:
- pull main:这一轮 main 加了 KeyboardShortcutsModal / RouteProgress / Skeleton / StatusPill / HoverPeek / Toast 系统 + skills/mcp 迭代代码
- 跑两个 regression net(`i18n-no-hardcoded-zh.test.ts` · `i18n-catalog-audit.test.ts`)+ 1928 web tests · 全绿
- 手动扫描:
  - components/shell + components/ui 的新组件 → aria-label / placeholder / title 属性全走 useTranslations
  - 全 app/ 路由的 toast.error / alert / confirm 调用 → 0 处硬编码字面量
  - throw new Error 字面量 → 都是 `HTTP ${status}` 这类技术堆栈,被上层 i18n 错误 UI 截住
  - en 目录下任何含 CJK 字符的 value(可能漏译)→ 仅 `"zh-CN": "简体中文"`(有意为之)
- 没有发现新漏点 · 这一轮代码零改动 · 仅写 log

**剩下的中文都是 by-design**:
- LLM system prompts(_ASK_SYSTEM_PROMPT / chat 标题生成器 / ai_explainer 三个 prompt)— 模型 instruction
- bootstrap_service.py 阿里云预设 name — 一次性 DB seed 字段(改了不影响已存在数据)
- artifact_office.py 工具 description 里的 JSON 例子 — 给 agent 看的 schema 示例

**结果**:这是健康检查 · 没有 bug 也是好结果

**commits**:仅 docs(本条 log)

## Round 12 · 2026-04-26 05:43 (cron · 30m)

**主题**:清理死代码 + 深扫执行层 / 持久化层

**发现**:
- web/lib/i18n/dict.ts 是孤儿(124 行 v0 早期方案残留 · 没有任何文件 import)
  · 真正的 catalog 在 web/i18n/messages/{zh-CN,en}/ 下
- backend core/provider_presets.py:49 label="阿里云 百炼" — 在 core/ 不能调
  t() · 但 routers/providers.py:102 已经在出口做了 `t(f"providers.label.{kind}")`
  覆盖,核心层只是 fallback,可以接受
- backend core/market.py:92 Literal["财报", "分红", ...] — 是 enum 域值不是
  display 文案,翻译会破坏数据契约,正确做法是前端按 enum value 查 catalog
- backend bootstrap_service.py:350 name="阿里云 百炼" — DB seed 字段,一次性
  写入,翻译无意义(用户可以改名)

**做的事**:
- 删除 web/lib/i18n/dict.ts(死代码)
- 顺手删空目录 web/lib/i18n/

**结果**:1928 web tests · regression net · typecheck · lint 全绿

**commits**:见 git log

## Round 13 · 2026-04-26 06:13 (cron · 30m)

**主题**:locale-aware 时间格式化 · 干掉硬编码 toLocaleString("zh-CN")

**发现**:3 处用 `toLocaleString("zh-CN", ...)` 写死了中文 locale —
en 用户看 trace 表 / run header 时,日期会按中文 locale 渲染(e.g.
"04/26 14:23:05" vs "04/26, 02:23:05 PM")。

**做的事**:
- components/traces/TraceTable.tsx:formatStartedAt 接 `locale` 参数 ·
  组件内 useLocale() 注入
- components/runs/RunHeader.tsx:formatTime 接 `locale` 参数 · 同样 useLocale()
- lib/format.ts:删除 formatRelativeTime(死函数 · 没人 import · 体内
  全是硬编码"刚刚 / N 分钟前 / 今天 HH:mm")· 顺手更新文件头注释
  说明 relative-time 走 catalog + Intl.RelativeTimeFormat

**结果**:1928 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 14 · 2026-04-26 06:43 (cron · 30m)

**主题**:lib/ 层面的硬编码 enum-label 函数 → catalog driven

**发现**:
- lib/employee-profile.ts BADGE_LABEL = { react: "可执行", planner: "会做计划",
  coordinator: "能带团队" } —— 直接 lookup 表硬塞中文
- lib/tasks-api.ts statusLabel(s) / sourceLabel(s) —— switch / dict 硬塞中文,
  TaskStatusPill 也走这个路径

**做的事**:
- web/i18n/messages/{zh-CN,en}/employees.json 加 `tasks.status.*` (7 状态)
  + `tasks.source.*` (4 来源) + `employeeBadges.*` (3 徽章) · 共 14 个 key x 2 locale
- 改 4 个 consumer 走 useTranslations:
  - app/employees/page.tsx · app/employees/[employeeId]/page.tsx → useTranslations("employeeBadges")
  - app/tasks/page.tsx · app/tasks/[id]/page.tsx → useTranslations("tasks.source")
  - components/tasks/TaskStatusPill.tsx → useTranslations("tasks.status") (新加 "use client")
- 删掉 lib/tasks-api.ts 的 statusLabel + sourceLabel + lib/employee-profile.ts 的 BADGE_LABEL

**结果**:1928 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 15 · 2026-04-26 07:13 (cron · 30m)

**主题**:广度审计 · 找不到新硬编码

**做的事**:
- 扫 lib/ + app/ + components/ 的中文字面量 → 全在 JSDoc 注释里(非运行时输出)
- 扫 backend services/ + execution/ + api/middleware/ → 唯有 LLM system prompts
  和 bootstrap DB seed 字段(均 by-design)
- 扫 backend execution/tools/meta/ tool result error / detail → 0 处硬编码
- shell components(AppShell · sidebar · TopBar · Drawer)→ 0 处硬编码
- e2e tests 里的 Chinese aria-label 是断言测试,不是用户文案
- placeholder 里的中文都是技术 ID 示例(cron 表达式 / function ID / URL)

**发现一项 polish 机会(未做 · 留作后续)**:
所有页面共享 root layout 的 `title: "allhands"` · 浏览器 tab 永远显示同一文字,
缺页面级 generateMetadata。但 client component 不能直接导 generateMetadata,
需要要么拆 server layout 要么走 useEffect → document.title。是改进而非
i18n 漏洞,留给独立 PR。

**结果**:1928 web tests + 12 backend i18n tests + regression net 全绿 ·
本轮零代码改动

**commits**:仅本条 log

## Round 16 · 2026-04-26 07:43 (cron · 30m)

**主题**:per-page 浏览器 tab title · 跟随 locale + 当前页

**做的事**:
- AppShell 新加 useEffect 同步 `title` prop 到 `document.title` ·
  format: `"{pageTitle} · allhands"` · 没传 title 时 fall back 到
  纯 "allhands"
- 所有页面已经在用 `<AppShell title={t("...")}>`,所以零 page-side 改动
  自动覆盖:Cockpit / Chat / Tasks / Employees / Skills / MCP / Gateway /
  Knowledge / Channels / Triggers / Confirmations / Traces / Observatory /
  Settings / About …
- en 用户切到 /tasks 浏览器 tab 显示 "Tasks · allhands"
  zh 用户同一页显示 "任务 · allhands"

**结果**:1928 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 17 · 2026-04-26 08:13 (cron · 30m)

**主题**:抽 useDocumentTitle hook · 把没走 AppShell 的页面也包进来

**做的事**:
- 抽 lib/use-document-title.ts 共享 hook,把 R16 在 AppShell 里写的
  useEffect 提取出来 · 公约一处定义
- AppShell 改用该 hook,去掉重复 useEffect
- 唯一不走 AppShell 的用户级页面是 /welcome(其它无 AppShell 的页面是
  redirect / design-lab,不需要 i18n title)
- /welcome 调 useDocumentTitle(t("docTitle")) · 加 welcome.docTitle key
  ("欢迎" / "Welcome")到 zh-CN.json + en.json 根 catalog

**结果**:1928 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 18 · 2026-04-26 08:43 (cron · 30m)

**主题**:全栈无 locale `toLocaleString()` 大扫除

**发现**:13 处 `new Date(...).toLocaleString()` 没传 locale,落到 navigator
默认。zh 应用却跑在 en navigator 上时,日期显示用 navigator locale,跟应用
字符串不一致。

**做的事**:全部接 `useLocale()` 并把 locale 传进 toLocaleString:
- app/observatory/page.tsx:formatDate(iso, locale)
- app/tasks/[id]/page.tsx:TaskHero · MetaGrid 各加 useLocale · 4 处时间
- app/tasks/page.tsx:TaskRow 加 useLocale · 1 处
- app/triggers/[id]/page.tsx:formatTime(iso, locale) · TriggerHeader · FireRow · 2 处调用
- app/conversations/page.tsx:ConversationsPage 加 useLocale · 1 处
- app/knowledge/page.tsx:DocDrawer 加 useLocale · 2 处(created_at / updated_at)
- app/market/page.tsx:MarketPage 加 useLocale · 1 处(poller tick)
- app/market/[symbol]/page.tsx:QuoteHero + NewsCard 各加 useLocale · 2 处
- app/mcp-servers/page.tsx:formatAbsolute(ts, locale) + 串到 buildKpis 签名
- app/channels/[id]/page.tsx:ChannelDetailPage + MessageRow 各加 useLocale · 2 处
- app/employees/[employeeId]/page.tsx:EmployeePage 加 useLocale · 1 处
- components/artifacts/ArtifactListItem.tsx:加 useLocale · 1 处(updated_at)
- components/chat/ConversationSwitcher.tsx:formatRelative 多接 locale 参数
- components/observatory/MetricDrawer.tsx:SeriesChart 加 useLocale · 1 处(tooltip)

**结果**:1928 web tests · typecheck · lint · regression net 全绿 · grep 复查零
残留 `new Date(...).toLocale*()` 不带 locale 的写法

**commits**:见 git log

## Round 19 · 2026-04-26 09:13 (cron · 30m)

**主题**:三个剩下的 d.toLocaleString() 末班车

**发现**:R18 漏掉了三个文件级 helper —
app/triggers/page.tsx · app/skills/[id]/page.tsx · app/mcp-servers/[id]/page.tsx
都有 `function formatTime(iso) { return new Date(iso).toLocaleString() }` ·
没受 d.toLocaleString() 模式扫描的影响,但本质问题相同。

**做的事**:
- 三个 formatTime 都接 locale 参数 · 调用方 useLocale() 注入
- triggers/page TriggerCard · skills/[id] Overview + VersionsTab · mcp-servers/[id]
  Overview + HealthTab · 五个组件加 useLocale

**剩余无 locale**:
- 仅 1 处:tasks_used.toLocaleString()(数值千分位)· 不属 date · 全栈数值
  千分位 locale 化是更大重构 · 当前 navigator 默认行为可以接受

**结果**:1928 web tests · typecheck · lint · regression net 全绿 · 全栈
date 格式化 0 处 navigator 默认

**commits**:见 git log

## Round 20 · 2026-04-26 09:43 (cron · 30m)

**主题**:aria-label / 屏幕阅读器友好性 + 漏掉的硬编码英文

**发现**:
- aria-label 硬编码英文 9+ 处:Toast notifications · ProgressPanel
  agent progress · PlanProgress 5 个状态 dot · SubagentProgress 3 个状态 dot ·
  ArtifactList pinned · ArtifactGrid artifacts/pinned · artifacts/page
  clear search/bulk actions/clear selection
- artifacts/page BulkActionBar 硬编码 4 处英文文本:"{n} selected" · "Pin" /
  "Unpin" · "Delete"
- SubagentProgressSection labelFor() 返回硬编码英文 status 文本(显示给用户看,
  不仅是 aria-label)

**做的事**:
- 加 catalog key:
  - root toast.ariaLabel("通知" / "Notifications")
  - chat.progressPanel.ariaLabel("代理进度" / "Agent progress")
  - chat.planProgress.step.{done,running,failed,skipped,pending}
  - chat.subagent.status.{running,succeeded,failed}
  - artifacts.list.pinnedAria + groupAria
  - artifacts.page.{clearSearchAria,bulkActionsAria,clearSelectionAria,bulk.*}
- 改 8 个组件 / 1 个 page 走 t():Toast · ProgressPanel · PlanProgressSection ·
  SubagentProgressSection(顺手干掉 labelFor)· ArtifactListItem · ArtifactGrid
  · artifacts/page BulkActionBar
- 删除 SubagentProgressSection.labelFor 死函数

**结果**:1928 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 21 · 2026-04-26 10:13 (cron · 30m)

**主题**:剩下 3 处 aria-label 英文字面量收口

**发现**:
- AppShell topbar 键盘快捷键按钮 aria-label="Keyboard shortcuts" + title="? · keyboard shortcuts" 硬编码
- PieChart svg aria-label="pie chart" 硬编码
- design-lab 页面 3 处 title="..." 是开发者预览页 · 跳过

**做的事**:
- 加 catalog key:shell.topbar.shortcutsAria + shortcutsTitle · viz.pieChart.ariaLabel
- 改 AppShell + PieChart 走 t()

**结果**:1928 web tests · typecheck · lint · regression net 全绿。
本次扫描后 components / app(除 dev-only design-lab)的 aria-label / title
属性 100% 走 t() · 屏幕阅读器对两种 locale 都说人话。

**commits**:见 git log

## Round 22 · 2026-04-26 10:43 (cron · 30m)

**主题**:5 处 toast.success/.error/.warning 模板字符串硬编码英文

**发现**:R20 在 BulkActionBar 收口时漏了 onPinToggle / bulkDeleteConfirmed
两段业务 handler 里的 toast 文案 —— 5 个 `${...} artifact(s)` 模板,zh
用户成功删几个制品看的全是英文 toast。

**做的事**:
- artifacts.page.bulk.toast 块新增 8 个 ICU key(en 用 plural,zh 用 {n}):
  pinned · unpinned · pinPartial(+desc) · deletedAll(+desc) · deletedPartial · deletedNone
- ArtifactsGlobalPage 加 `tToast = useTranslations("artifacts.page.bulk.toast")`
- 5 处 toast.* 改用 ICU 模板

**结果**:1928 web tests · typecheck · lint · regression net 全绿 ·
全栈 toast.* 调用 0 处硬编码英文/中文文本

**commits**:见 git log

## Round 23 · 2026-04-26 11:13 (cron · 30m)

**主题**:深度健康检查 · 没有新发现

**做的事**:
- 扫 ConfirmDialog / Coachmark / SearchInput / HoverPeek / PageHeader 默认值 → 全 t() 化
- 扫 backend services/cockpit/observatory/artifact/skill/mcp/task → 0 处用户可见硬编码
- 扫 SVG `<title>` / `<iframe title>` / 模板字符串 → 全是 SVG path / 数字 / cron 表达式,不需翻译
- 扫 backend execution/ → 唯有 `_ARTIFACT_HALLUC_PATTERNS` 检测词表(读模型输出 · 非展示)+
  agent_loop 的 nudge SystemMessage(给 LLM 的 instruction · 非用户可见) · by-design
- 扫 backend services 里 logger / summary / description 的 f-string → 0 处中文
- 扫 raw enum 显示(trigger.kind / fire.status / server.transport)→ 都是 mono 技术 badge ·
  类似 Linear "open"/"closed" 那种,by-design 不翻译

**结果**:1928 web tests + backend i18n tests + regression net 全绿 · 本轮零代码改动

**commits**:仅本条 log

## Round 24 · 2026-04-26 11:43 (cron · 30m)

**主题**:再次广度审计 · main 新增的 4 个文件零漏点

**main 新增**:agent_loop / test_agent_loop / ProgressPanel(R20 R21 改动 +
border-t 拆除) / HoverPeek 定位修复 — 都不引入新文案。

**做的事**:
- 跑 backend + web regression net + typecheck + lint → 全绿
- 检查 agent_loop 新增中文(160-174 + 490) → 都是 LLM 检测词表 / nudge
  SystemMessage,by-design 不翻译
- 扫表单 type="submit" / required → submit 文案全 t()
- HoverPeek + ProgressPanel 改动只动样式 / 几何,无文案变化

**剩余可做但低 ROI**:18+ 处 number `.toLocaleString()`(observatory / tasks /
traces / RunTurnList / ModelTestDialog / ModelRow)。zh-CN + en 两个 locale
千分位分隔符都是 `,`,navigator-default 行为不会撕裂这两种用户。仅
de-DE / fr-FR navigator + 应用切到 zh / en 时会显示 "1.234"。当前不修。

**结果**:1928 web tests + backend i18n tests + regression net 全绿 · 零代码改动

**commits**:仅本条 log

## Round 25 · 2026-04-26 12:13 (cron · 30m)

**主题**:把 R24 列在 backlog 的 18+ 处 number `.toLocaleString()` 一并收口

**做的事**:
- sed 批量替换 `.toLocaleString()` → `.toLocaleString(locale)`
  在 app/observatory · app/tasks/[id] · components/traces/TraceTable
- 给五个组件补 useLocale:
  - app/tasks/[id] TaskKpiStrip · components/runs/RunTurnList LLMCallTurn ·
    components/gateway/ModelRow · components/gateway/ModelTestDialog MetricsRow
  - 后两个还要给 fmtCount(n, locale) 加 locale 参数 + 三个调用点
- observatory(12 处)+ TraceTable(4 处)的 toLocaleString 都已经在
  组件内 useLocale 范围里(R18 R19 已 wire),sed 后零编译错

**验证**:`grep '\.toLocaleString()' app/ components/` 现在 0 行

**结果**:1928 web tests · typecheck · lint · regression net 全绿 · 全栈
任何 `.toLocaleString*()` 调用都跟随当前 locale,
de-DE / fr-FR navigator 用户也不再撕裂

**commits**:见 git log

## Round 26 · 2026-04-26 12:43 (用户报错触发)

**bug**:`/mcp-servers` 控制台报 `MISSING_MESSAGE: mcp.list.neverSynced
in messages for locale zh-CN` · buildKpis 调 `t("neverSynced")`,t 是
`useTranslations("mcp.list")`,但 catalog 把 key 嵌在 `mcp.list.kpi.neverSynced` 下。

**根因**:命名空间 / key 路径不一致 · 现有 catalog-audit 测试只比较两个 locale
的 shape 是否对齐(都缺也通过)· 没有验证「源码里 t(...) 引用的 key 必须在
catalog 里存在」。

**做的事**:
- app/mcp-servers/page.tsx:422 改 `t("neverSynced")` → `t("kpi.neverSynced")`
- 新增 web/tests/i18n-keys-resolve.test.ts(回归网):
  - 加载所有 catalog key(root + 8 namespace 文件)成 Set
  - 扫 app/ + components/ + lib/ 所有 .ts/.tsx,正则匹配
    `useTranslations("ns")` 把它绑定的局部变量名记下
  - 对每个 t-name 找 `t-name("a.b.c")` 调用,组合 `ns.a.b.c` 检查是否存在
  - 反向验证:把修复 sed-undo 后跑一次,确认能 surface 这个 bug · 然后
    再恢复

**结果**:1929 web tests · typecheck · lint · regression 全绿。
以后 PR 加错 namespace 或漏 key,这层会立刻挡住。

**commits**:见 git log

## Round 27 · 2026-04-26 13:13 (cron · 30m)

**主题**:把 R26 的 web key-resolver 复制到 backend

**做的事**:
- 新增 backend/tests/unit/test_i18n_keys_resolve.py:
  - 扫所有 backend/src/allhands/**/*.py 里 `t("literal")` 调用(只在
    `from allhands.i18n import t` 的文件)
  - 检查每个 key 在 _MESSAGES 任一 locale dict 里存在
  - 当前覆盖 17 个文件 / 61 处 t() 调用 · 全绿
- web 侧 R26 的 i18n-keys-resolve 也跑了一遍,1929 web tests 全绿

**结果**:web + backend 双侧都有 t() 漏 key 回归网。以后 PR 加错 namespace
或漏 key,本地跑测就 fail · 不会落到运行时报 MISSING_MESSAGE。

**commits**:见 git log

## Round 28 · 2026-04-26 13:43 (cron · 30m)

**main 新动作**:
- 4 个新 observatory 子页(employees/[id] · errors/[kind] · models/[ref] · tools/[id])
- 3 个新 skills 文件管理组件(SkillFileEditor / SkillFileTree / SkillFilesTab)
  + lib/skill-files-api · @uiw/react-codemirror 新依赖
- 大量新 catalog key(observatory.{employeeDetail,errorDetail,modelDetail,
  toolDetail} 块,both locale 同步)

**做的事**:
- pnpm install 拉新依赖 · 解决 vite 测试 transform 失败
- 4 个新 observatory 子页扫到 11 处 `new Date(...).toLocaleString()` /
  `n.toLocaleString()` 没传 locale · 批量 sed + 给每页加 useLocale()
- observatory/page.tsx:1146 (main 新代码) 也漏掉 row.runs_count.toLocaleString()
- 全部 toLocaleString 调用 → toLocaleString(locale)

**结果**:1982 web tests · typecheck · lint · regression net 全绿 ·
全栈再次 0 处 toLocaleString 不带 locale

**commits**:见 git log

## Round 29 · 2026-04-26 14:13 (cron · 30m)

**main 新动作**:
- ArtifactPanel + ArtifactDetail + DrawioView 调整(都不引入新文案)
- 新增 backend test_spawn_subagent_render_forward.py(测试 fixtures 含中文 by-design)
- 部分 catalog key 微调(menu / shortcuts 文案重排)

**做的事**:
- 跑完整 i18n 套件:web 1982 tests · backend 13 i18n tests · 全绿
- 检查 4 个 main 新触碰的组件:零硬编码 · 零 toLocaleString 不带 locale
- 全栈最后一次 grep `\.toLocaleString\(\)` → 0 匹配

**结果**:本轮零代码改动 · 零回归

**commits**:仅本条 log

## Round 30 · 2026-04-26 14:43 (cron · 30m)

**主题**:i18n-keys-resolve 回归网二期 · 覆盖 template-literal prefix

**背景**:R26 写的回归网只验证 `t("static.literal.key")` · 跳过了
`` t(`status.${var}`) `` 这种动态 key — 但代码里 21+ 处用这种模式
(SubagentProgressSection / PlanCard / MetricDrawer / CommandPalette /
artifacts page sort / review gates / skills+mcp tabs / KeyboardShortcutsModal …
)。如果有人 typo 写错前缀,运行时才会爆。

**做的事**:
- web/tests/i18n-keys-resolve.test.ts 升级:
  - 加第二条 regex `t(\`prefix.${...}\`)` 抓 template 模式
  - 预计算 catalog 所有 sub-prefix(`a`, `a.b` 都进 set)
  - prefix-style 调用要求 `${ns}.${prefix}` 在 prefix-set 里
- 反向验证:把 `t(\`status.${...}\`)` sed 成 `t(\`xstatus.${...}\`)`,
  test 立刻 surface `chat.subagent.xstatus.* (template prefix)` · 恢复后通过

**结果**:1984 web tests · typecheck · lint 全绿 · 回归网现在静态阻挡
两类 t() 漏 key:literal 和 template prefix · runtime MISSING_MESSAGE
被本地测试挡掉

**commits**:见 git log

## Round 31 · 2026-04-26 15:13 (cron · 30m)

**主题**:回归网三期 · 覆盖 t.rich / t.raw / t.has + 数组型 catalog entry

**做的事**:
- web/tests/i18n-keys-resolve.test.ts:
  - call regex 加 `\b${name}(?:\.(?:rich|raw|has))?\(` · 把 t.rich() / t.raw() /
    t.has() 也纳入扫描(此前都漏)
  - catalog loader 把 `Array.isArray(v)` 也认作终态 key(之前只认 string,
    导致 t.raw("modelFormTips") 这种数组消息被误判为「key 不存在」)
- 反向验证:扩展 regex 后第一次跑找到了 1 处真实问题 ——
  app/gateway/page.tsx:1226 `t.raw("modelFormTips")` 的 key 是数组 ·
  loader 漏识 · 修 loader 后通过

**结果**:1984 web tests · typecheck · lint 全绿。
回归网现在覆盖三类 t() 调用形式 × 三种值类型(string / array / nested object)。

**commits**:见 git log

## Round 32 · 2026-04-26 15:43 (cron · 30m)

**主题**:backend resolver 升级 · 把 t(f"...{var}") f-string prefix 也纳入

**做的事**:
- backend/tests/unit/test_i18n_keys_resolve.py:
  - 新加 `TPL_RE` 抓 `t(f"a.b.{var}…")` 模式 · 类型 web R30/R31 一致
  - 加 `_all_prefixes()` 把 catalog 所有 sub-prefix 进 set
  - f-string call 要求 prefix 在 set 里
- 反向验证:把 `t(f"providers.label.{p.kind}")` sed 成 `t(f"xproviders.label.{p.kind}")` ·
  test 立刻报 `xproviders.label.* (f-string prefix)` · 恢复后通过

**结果**:backend i18n test 通过 · 现在 web + backend 双侧都覆盖
literal + template-prefix 两种 t() 形式

**commits**:见 git log

## Round 33 · 2026-04-26 16:13 (cron · 30m)

**主题**:full build + 二级别口袋检查

**做的事**:
- pnpm build → 全栈构建通过 · 0 warning / 0 error · 所有路由统计正常
  (47+ 路由,大者 17 kB / 165 kB,小者 145 kB)
- catalog 反向扫:
  - en 目录里的中文字符 → 仅 `"zh-CN": "简体中文"` (locale name in own language · 故意)
  - zh-CN 目录里 3 词以上英文短语 → 0 处(排除技术术语 / brand name 后)
- backend Accept-Language 集成测试 → test_i18n.py + test_observatory_run_detail_api.py
  覆盖 cookie / header 协商
- t.has() / Set.has() 区分 → 当前 0 处 next-intl `t.has()` 调用,
  全部都是 `Set.has()`(数据结构操作 · 与 i18n 无关)

**结果**:本轮零代码改动 · 平台 i18n 状态良好 · 双侧 lint/type/build/test 全绿

**commits**:仅本条 log

## Round 34 · 2026-04-26 16:43 (cron · 30m)

**主题**:async / contextvar 完整性 + middleware 注册校核

**做的事**:
- 校核 LocaleMiddleware 已经在 backend/api/app.py:177 `app.add_middleware`
  注册 · 所有路由都过它
- contextvar 作用域审计:
  - asyncio.create_task 自动复制当前 ContextVar(Python 3.7+)· 4 个使用点
    (event_bus / retriever / market poller / chat SSE / channel_inbound)
    locale 都会跟过去
  - SSE 流式 endpoint 在请求 scope 内,t() 调用拿到正确 locale
  - startup / on_event 没有任何 user-facing 文案 · 不需要 i18n
- 跑完整 i18n 套件:web 1984 + backend 13 全绿

**结果**:本轮零代码改动 · contextvar 链路完整 · 平台 i18n 健康

**commits**:仅本条 log

## Round 35 · 2026-04-26 17:13 (cron · 30m)

**主题**:channel adapters / seed / outbound 内容审计

**做的事**:
- backend/src/allhands/execution/channels/(bark / email / feishu / pushdeer / telegram / wecom)
  扫硬编码中文 → 0 处。各 adapter 透传 agent 给的 message,内容由调用层
  决定 locale,符合 i18n 模式
- services/channel_inbound · channel_service · seed_service(489 行)
  扫硬编码中文 → 0 处
- 全 backend 用户可见硬编码中文最后一遍扫:剩下的都是 LLM system prompts ·
  artifact hallucination 检测词表 · DB seed 一次性写入字段 · by-design

**结果**:web 1984 tests + backend i18n tests + regression 全绿 · 零代码改动

**commits**:仅本条 log

## Round 36 · 2026-04-26 17:43 (cron · 30m)

**主题**:dead-key 反向审计工具(诊断,不强制修)

**做的事**:
- 新增 web/scripts/audit-i18n-dead-keys.mjs · 反过来扫:把所有
  `useTranslations("ns")` + `t("subkey")` 配对,组合 `ns.subkey` 集合 ·
  catalog 里有但 source 引用不到的 → 候选死 key
- 当前结果:catalog 2452 keys · live literal 8632(同一 key 被多处引用)·
  live template prefix 38 · 可能死 key 259 个(10.6%)
- 大头是 `common.*` 系列(loading / save / ok / yes / no…)和
  `welcome.highlights.*` 一些子项 —— 各页面用了页内同义 key 而不
  共享 common · 算冗余但不是 bug
- **不删除**:工具是诊断性的 · 启发式可能漏掉 props-passed namespace 或
  computed key,真删需要 case-by-case 评估 · 留作以后清理基线

**用法**:
```
node web/scripts/audit-i18n-dead-keys.mjs --list
```

**结果**:1984 web tests + backend i18n + lint 全绿 · 仅加诊断脚本

**commits**:见 git log

## Round 37 · 2026-04-27 00:13 (cron · 30m)

**主题**:ArtifactList 最近一次扩 12 kind 时漏译的 "other" fallback bucket

**main 新动作**:
- 用户报 csv 等类型在过滤面板里点击后空白 · main 修了 KIND_ORDER 加全 12 enum
  + 加 FALLBACK_BUCKET = "other" 兜底新增 kind
- 但 fallback 分组 title 直接用 "other" 字面量 · zh-CN 用户看到 "OTHER" 大写
  英文 mono 标签

**做的事**:
- catalog 加 artifacts.list.groupOther("其他" / "Other")
- ArtifactList.tsx fallback section title 走 t("groupOther")
- 其它 11 个 kind 标签是技术 enum(markdown / csv / xlsx 等),保留英文
  mono 风格,跨语言一致 · 不动

**结果**:1984 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 38 · 2026-04-27 00:43 (cron · 30m)

**main 新动作**:新 `/observatory/pricing` 路由 + components/ui/ErrorBoundary +
新 backend 测试(pricing meta tools / tool-arg validation / web search tool)+
ADR 0021 自解释 tool。

**做的事**:
- pricing page 漏一个 `new Date(iso).toLocaleString()` 没传 locale ·
  fix:formatDate(iso, locale) + useLocale() · 调用点更新
- ErrorBoundary 是通用 class component,无文案,fallback 由调用者注入
- 验证三个新 backend 测试不引入 i18n 漏洞
- pnpm install 拉新依赖 + pnpm build 刷新 routes manifest(routes-smoke
  之前两个失败是 .next 缓存陈旧,build 后绿)
- grep 复查 0 处 `.toLocaleString\(\)` 无 locale 残留

**结果**:1999 web tests · typecheck · lint · regression net 全绿

**commits**:见 git log

## Round 39 · 2026-04-27 01:13 (cron · 30m)

**主题**:resolver 多 alias 多重 decl 验证 + dead-key 数据更新

**做的事**:
- 验证 `tr` / `ta` 等非 `t` 命名 alias 仍能被 resolver 正确扫描:
  - app/mcp-servers/[id] 三个 `const tr = useTranslations(...)` 不同 ns ·
    每个 `tr.rich/...` 调用按 line-proximity 解析到正确 decl
  - app/knowledge `const ta = useTranslations("knowledge.advanced")` 同理
  - 现有 resolver 测试包含所有这些调用,通过
- dead-key 审计更新:catalog 2452 → 2481(+29 全在 pricing namespace,
  全部 alive)· 死 key 仍 259(10.4%)
- 大头仍然是 `common.*` 的 21 个通用词(`back / cancel / close / loading /
  ok / yes / no / save / search / settings / refresh / copy / copied …`)·
  这些是「共享词汇」预留 · 各页面用的是页内同义 key · 未删除(留作公约)

**结果**:本轮零代码改动 · regression net 全绿

**commits**:仅本条 log
