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
