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
