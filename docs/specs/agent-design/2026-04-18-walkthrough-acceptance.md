# 走查验收 Spec · 模拟人真点击 · 验证「一人驱动 AI 团队」

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**并列 spec** [self-review](./2026-04-18-self-review.md)(3 轮打磨) · [harness-review](./2026-04-18-harness-review.md)(工具链自审) · 本 spec(**交付前最后一关 · 模拟用户真点击**)
**动手前必读**
- [`docs/claude/working-protocol.md`](../../claude/working-protocol.md) § 阶段 4.5 产品级自验收
- [`docs/claude/learnings.md`](../../claude/learnings.md) L02(Playwright ≠ 产品验收)+ L03(好用 > 能用)
- [`docs/claude/error-patterns.md`](../../claude/error-patterns.md) E04(dev 缓存脏)· E11(emoji)· E12(测试端点简化)
- [`product/00-north-star.md`](../../../product/00-north-star.md) 北极星 · 「一个人驱动一个 AI 团队」
- [`product/06-ux-principles.md`](../../../product/06-ux-principles.md) P01-P11

---

## 0 · TL;DR

- **在所有其他任务完成后、向用户交付前的最后一关**:执行端 Claude 必须**打开浏览器,模拟一个真实用户**,把产品**从零到能干活**的主路径一遍遍点过
- 不是跑 Playwright 断言,不是"我觉得没问题" —— 是 **chrome-devtools MCP 驱动真实浏览器 → 每步截图 → 每步按「一人驱动 AI 团队」北极星打分**
- 核心验收问:"**我是一个没用过它的人,第一次打开它,能不能在 30 分钟内建出一个员工、派一个任务、拿到一个制品?**" 答不上来,就是不合格
- **这是一个闭环,不是一次性验收**:跑出债务 → **必须修 → 必须重跑 → 再打分** · 直到全绿(或剩余债务被用户显式接受)才算交付。**写完债务就停 = 偷工,PR 直接打回**(本 spec §3.7 硬闸门)
- 输出 `plans/<当前 plan>.md § 走查验收包 · YYYY-MM-DD`(每轮迭代独立小节 · 截图链接 + 每路径打分 + 本轮修了什么 + 下轮要修什么)
- 与 self-review 的关系:self-review 是**打磨产品外观 / 体感**(3 轮);本 spec 是**断言北极星达成**(**多轮修-评循环** · 直到绿灯)。顺序:**功能齐 → self-review 3 轮 → harness-review 1 轮 → walkthrough-acceptance 修-评循环 → 交用户**

---

## 1 · 问题陈述

过去的教训(都来自 learnings.md):

- **L02** · 我交过「Playwright 7 passed + pytest 202 passed = 全绿」的验收包,用户原话:"**http://localhost:3000/ 打不开啊,你自己做产品验收了吗?**"
- **L03** · 我交过「功能跑通 + 三态齐 + 深浅过」的验收包,用户原话:"两层页面点击是否合理?连接测试连供应商有啥用?**好的产品不是能用,而是好用**"

这两条告诉我:**测试绿 ≠ 启得来;启得来 ≠ 好用;好用 ≠ 北极星达成**。交付前必须**自己扮演那个第一次打开浏览器的用户**,把整条故事走一遍。

本 spec 把"自己扮演用户点一遍"从**软纪律**升级成**硬闸门**:

- 给出**走查路径矩阵**(自建 → 自派 → 自收 → 自评 的 7 条主动线)
- 给出**模拟点击的标准脚本**(每条动线一套 chrome-devtools MCP 命令序列)
- 给出**打分表**(6 条北极星维度,逐条用证据填)
- 规定 **DoD · 没跑完这一关的功能不许交付**

---

## 2 · 原则

### 2.1 「一人驱动 AI 团队」的 6 条可验证维度

北极星抽象,但 **走查验收必须能判**。本 spec 把它拆成 6 条**可逐条打分**的子维度。每条都要给证据(截图 + 操作记录 + 数值),不给就是没做。

| # | 子维度 | 核心问 | pass 判据 | fail 信号 |
|---|---|---|---|---|
| **N1** | **对话即操作**(Tool First 兑现) | 用户在 chat 里说"帮我 X"能不能做到,不用点任何独立页?(L01 扩展版) | 主要 CRUD 操作(建员工 / 建 skill / 装 MCP / 建 provider / 建 task / 建 trigger)都能**纯聊天**做完 | 任何一个操作必须打开独立页才能完成 |
| **N2** | **一屏决策**(P11 · ①) | 每个决策页,父对象 + 其关键子对象能**一屏看到**? | 员工列表行里直接露"对话数 / 最近任务 / skills 名";模型行里直接露"p50 延迟 / cost / 上次测试时间" | 要点详情页才能看关键数据 · 要跨多页凑信息 |
| **N3** | **测试有效性**(P11 · ②) | 测试 / 预览按钮测的是**用户最终关心的那件事**? | Gateway 模型测试 → 真发一次 LLM 请求 + 流式返回 · MCP 装完 → 真列 tool · Skill 挂给员工 → 真跑一次 | 只测了 HTTP 握手 / 只跑了 init,不代表"能用" |
| **N4** | **关键数值露出**(P11 · ③) | 结果卡 / 状态卡有没有把用户下次决策会用的全露出? | LLM 调用 → latency / TTFT / tokens in/out / cost / error category 都有;Task → 当前步 / 已用时 / 已用 token / 剩余预算;员工 → 最近 3 次任务成功率 | 只有 ✓/✗ 或 "成功 / 失败" 文本 |
| **N5** | **测试态 ≡ 生产态**(P11 · ④) | 测试面板里的能力和生产里实际用的对齐吗? | Gateway 测试支持流式 / thinking / temperature / top_p / max_tokens · 员工 preview 支持同样的 tools 集合和 skill 组合 | 测试简化参数 · 测试关了流式 · 测试换了 prompt |
| **N6** | **失败可恢复**(P04 三态 + 产品感) | 任意一步出错,UI 给不给用户下一步? | 空态 → 引导 ("新建第一个员工 →") · 错误态 → 指向下一步("重试" / "去 Gateway 配 provider") · 长操作有 loading + progress + cancel | 只写 "Loading..." / "No data" / "Error: <stack>" |

**判分口径:**
- 6 条全过 → 绿灯(发)
- 任一条挂 red → **红灯 · 打回去重新设计 / 实现**(不是"先 ship 后补")
- 任一条 yellow(有证据但有缺) → **黄灯 · 列入 § 4.3 产品体验债务**

### 2.2 走查必须是浏览器真交互,不是 Playwright 断言

CLAUDE.md + learnings L02 已经写清楚。本 spec 再一次硬性重申:

- **必须** 起常驻 `pnpm dev`(不是 Playwright 内部 WebServer)
- **必须** 用 chrome-devtools MCP 驱动 —— 有 MCP 就**不准**用 Playwright 脚本替代(MCP 可视 / 可截图 / 可实时纠错,Playwright 跑完即关)
- **必须** 每一步都生成截图落盘 `plans/screenshots/<plan>/walkthrough-acceptance/<step>.png`
- **必须** `list_console_messages` 每条动线末尾采样 · 有 0 个 error(warn 可容忍 + 注释原因)

### 2.3 走的是「新用户第一次」的故事线

**关键人格**:Claude 要假装自己是**第一次装 allhands 的用户**(不是维护者)。
- 不假设任何 seed 数据已存在
- 不跳过空态("反正最后也要有员工就直接建")
- 每进一个页都**先看空态长什么样**,再造数据看有态

这一条决定走查剧本的编排方式(下面 § 3)。

### 2.4 打不开就是打不开

如果 dev 起不来 / 某路由 500 / 关键 tool 永久 pending — **不许填 ✅**,直接写「**blocker**」+ 诊断 + 建议修法,把走查包交出去等授权。本次本对话里就碰到了 E04(`.next` chunk 缺失 → React 不 hydrate → "正在初始化对话…"永远不走),这就是典型的 blocker:沙盒拒绝 `rm -rf .next` · 我必须停下等授权,而不是填绿糊弄。

---

## 3 · 实现

### 3.1 走查路径矩阵(7 条主动线 · 必须全跑)

每条动线都按**「空态 → 操作 → 有态 → 失败态」**四步走,每步都要截图 + 控制台检查。

| # | 动线 | 起点 → 终点 | 必须碰到的关键 tool / 页 | 北极星维度打分重点 |
|---|---|---|---|---|
| **W1** | **Bootstrap · 从零到可用** | 空仓库 → 配好一个 provider + 一个 model + 跑通 hello-world chat | `/gateway` · `add_provider` · `create_model` · `chat_test_model` · `/chat` 首问 | N1/N3/N4/N5 |
| **W2** | **自建一个员工**(纯对话) | `/chat` → Lead 建员工 → 员工列表出现 | `create_employee` Meta Tool · `/employees` 列表 · render tool `EmployeeCard` | **N1 最关键**:不打开 `/employees` 就能建 |
| **W3** | **自派一个任务**(fire-and-forget) | `/chat` → Lead 分配任务给员工 → `/tasks` 看到 running → 5 分钟后拿到 artifact | `tasks.create` · `/tasks/:id` 详情页 · `/artifacts` · `task.request_approval` → `/confirmations` | N2/N4/N6 |
| **W4** | **装一个 skill 给员工**(纯对话) | `/chat` → "给员工加个会写 PPT 的 skill" → 员工 skills 增 | `install_skill` / `bind_skill_to_employee` Meta Tool | N1/N3 |
| **W5** | **装一个 MCP server + 真调一次** | `/chat` → "接入 filesystem MCP" → 员工会用它了 | `install_mcp_server` · `/mcp-servers` 列表 · MCP tool 在员工 preview 里真跑一次 | N3/N5 |
| **W6** | **建一个 trigger + 等它自动触发** | `/chat` → "每天 9 点让 X 员工读 HN 首页摘要" → 手动 `fire_now` → 看到 run → 看到制品 | `triggers.create` · `/triggers` 列表 · `fire_now` Meta Tool · `/cockpit` 看到 activity | N4/N6 |
| **W7** | **观测 · 失败恢复** | 故意配错一个 model key → 跑任务 → 看错误文案 → 去 `/gateway` 修 → 再跑通 | `/traces` · `/confirmations` · error category · 文案指向下一步 | **N6 最关键** |

**顺序约束:** W1 必须先跑(Bootstrap 先)· W2 → W3 → (W4 ‖ W5) → W6 → W7。W7 必须**最后**(要故意搞坏)。

### 3.2 每条动线的模拟点击脚本标准

每条动线在 `plans/screenshots/<plan>/walkthrough-acceptance/<W-N>/` 下产出:

```
00-empty-state.png        # 进页面第一眼
01-initial-action.png     # 第一次操作前 UI
02-...nn-operation.png    # 中间每个关键操作
nn-success-state.png      # 操作成功后的 UI(最终态)
console.log               # list_console_messages 采样
walkthrough.md            # 步骤流水账 + 每步 N1-N6 打分 + 证据指针
```

`walkthrough.md` 模板(机读友好,也人读):

```markdown
## W-2 · 自建一个员工(纯对话)

**起点** /chat 空会话
**终点** /employees 列表里有 "Sally"

### 步骤
| 步 | 动作 | 截图 | 预期 | 实际 | N1-N6 有没有踩到红线 |
|---|---|---|---|---|---|
| 1 | `click` 新建会话按钮 | 00-empty-state.png | 对话框聚焦输入 | ✅ | - |
| 2 | `fill` "帮我建一个叫 Sally 的数据分析员工,加 python-repl skill" | 01-prompt.png | Lead 开始流式回复 | ✅ | - |
| 3 | 观察 tool call card | 02-tool-call.png | 显示 `create_employee` 待确认(scope=WRITE) | ❌ 直接执行了没卡 | **N3 red** · WRITE 必须卡 gate(L01 + CLAUDE §3.3) |
| 4 | `click` 确认按钮(补设) | - | - | - | - |
| 5 | 走完 → 切 /employees | 05-list.png | 列表里有 Sally + 今日建 | ✅ | - |

### N1-N6 打分
- N1 对话即操作: **Green** · 纯 chat 完成 · 未打开独立页
- N2 一屏决策: **Yellow** · 员工列表行只有名字 · 没露 skill / 最近任务
- N3 测试有效性: **Red** · WRITE tool 没过 gate
- N4 关键数值露出: **Yellow** · 建员工耗时 / token 没露
- N5 测试态 ≡ 生产态: **Green** · 对话建的员工立刻能用
- N6 失败可恢复: **N/A** · 本路径未触发错

### 本轮自修
- [x] 补 ConfirmationGate 拦 `create_employee`(code commit <sha>)
- [ ] 员工列表行补 skill / 最近任务 —— 结构改动,列入产品体验债务

### 本轮未修(债务)
- 员工列表行信息密度不足 · 需改 DTO + 组件 · 转交 plan 下一 iteration
```

### 3.3 Meta Tool:`cockpit.run_walkthrough_acceptance`

和 self-review / harness-review 对齐,暴露成 Meta Tool 让 Lead 也能"叫它跑":

```python
Tool(
    id="allhands.meta.run_walkthrough_acceptance",
    kind=ToolKind.META,
    name="cockpit.run_walkthrough_acceptance",
    description=(
        "[WHEN TO USE] 在自审(self-review)3 轮打磨和工具链自审(harness-review)之后 · "
        "模拟真实新用户打开浏览器,按 W1-W7 走一遍全平台主动线 · 输出验收包含截图 / 控制台 / 每步 N1-N6 打分\n"
        "[WHEN NOT TO USE] 未完成 self-review · dev server 没起 · 没有可用 provider/model\n"
        "[PARAMS] paths: 可选 · 只跑其中几条(默认 all)· fail_fast: 默认 true(red 出现就停)"
    ),
    scope=ToolScope.WRITE,
    requires_confirmation=True,
    ...
)
```

输入:
```json
{
  "paths": ["W1","W2","W3","W4","W5","W6","W7"],
  "fail_fast": true,
  "screenshot_dir": "plans/screenshots/<current-plan>/walkthrough-acceptance"
}
```

输出:
```json
{
  "summary_path": "plans/<plan>.md#走查验收包-YYYY-MM-DD",
  "per_path_verdict": {"W1":"green","W2":"yellow","W3":"red",...},
  "blockers": ["W3 step-3 gate 缺失"],
  "debts": ["W2 员工列表行信息密度 · P11-①"],
  "next_action": "先修 W3 blocker 再跑下一轮 · 或把 debts 写进 plan iteration"
}
```

### 3.4 REST 端点(独立页也要能跑)

按 L01 · 一份能力两个入口:

- `POST /api/walkthrough/run` · body `{paths, fail_fast, screenshot_dir}` → 202 + run_id
- `GET /api/walkthrough/runs/:id` · SSE 流式每步事件(`event: step`/`verdict`/`summary`)
- `GET /api/walkthrough/runs/:id/result` · 最终 JSON
- 独立页 `/acceptance` · 触发按钮 + 实时流 + 下载截图 zip

### 3.5 运行时:chrome-devtools MCP 失败时的降级

| 环境 | 首选 | 次选 | 禁用 |
|---|---|---|---|
| 本地开发(有 MCP) | **chrome-devtools MCP** | - | - |
| CI(无 MCP) | 本地 Chromium + **Playwright 录制主路径**(仅此一处 playwright 是补丁) | - | WebFetch(静态 HTML 不能代表动态) |
| 极限兜底 | 已禁 | - | **不允许只跑 pytest + playwright 就填 ✅**(L02 铁律) |

CI 模式下 Playwright 脚本必须:(a) 独立 `walkthrough.spec.ts`,(b) 不复用 `pnpm test:e2e` 的 snapshot,(c) 落截图和本地 MCP 同目录结构,(d) 跑完**不能自动关 dev**(要求 CI 留存容器 15 分钟供人接管)。

### 3.6 触发时机 · 和其他 review 的顺序

```
[所有功能 spec 实装] → self-review 3 轮(好看/好用/爱不释手)
    → harness-review 1 轮(协作工具链对齐 + 冷却回看)
    → walkthrough-acceptance 修-评循环(见 § 3.7) · 直到全绿或用户显式接受剩余债务
    → [向用户交付 · plans/<plan>.md 末尾追加 § 走查验收包]
```

任一前序环节未完成,本 spec 不许跑(跑也是垃圾证据)。

---

### 3.7 修-评循环(Fix-Reeval Loop · 本 spec 最硬的闸门)

**原则**:`write debts ≠ done`。写完债务列表立刻关文件 = **偷工**。债务必须**修完 → 重跑 → 再打分**,循环到达成退出条件为止。

#### 3.7.1 每一轮的动作(固定 5 步)

```
Iteration N:
  1. 跑 W1-W7(或 fail_fast 模式下遇 red 停) · 截图落 plans/screenshots/<plan>/walkthrough-acceptance/iter-N/
  2. 打分 N1-N6 · 分类 verdict(red / yellow / green)
  3. 归档债务 · 按 P0/P1/P2 (见 § 3.7.2)
  4. **立即修 P0 全部 + P1 至少 50%**(不修完 iter 不算结束) · 每条修完 commit 一次
  5. 进入 Iteration N+1 · 重跑被修过的那几条动线(回归) · 再评分
```

#### 3.7.2 债务分级(决定本轮必修 / 可延)

| 优先级 | 判据 | 处理 |
|---|---|---|
| **P0 · Blocker** | 任一 `red`(N1-N6 有一条踩红) · 或 主动线跑不通 · 或 dev 起不来 | **本轮必修 · 不修不许进下一轮**;修不动 → 写 blocker 申请用户授权(比如本次 E04 那种沙盒级阻塞) |
| **P1 · Structural yellow** | 黄灯但根因是**组件 / DTO / API 缺字段 / tool 缺参数** · 改不了就会继续在下轮复发 | **本轮至少修 50%** · 剩余列入下轮迭代的 P0 |
| **P2 · Polish yellow** | 黄灯但根因是**文案 / 留白 / 微动效** · 不修不影响北极星打分升级 | 本轮可延 · 但连续 **3 轮** 不修自动升 P1 |

**判定工具**:Meta Tool `cockpit.run_walkthrough_acceptance` 的输出里 `debts[]` 数组自动填 `priority` 字段,不让执行端"自己拍脑袋"。

#### 3.7.3 退出条件(任一满足即退出循环)

| 条件 | 如何证明 |
|---|---|
| **全绿** · N1-N6 都 green · 债务 P0/P1 清零 | 本轮所有动线 verdict=green · `debts.filter(d => d.priority !== 'P2').length === 0` |
| **用户显式接受剩余债务** | `plans/<plan>.md § 走查验收包` 末尾追加 "**用户接受**" 一节 · 列出剩余 P1/P2 清单 + 用户的一句话签字 + 签字时间 |
| **循环预算耗尽** | 已跑 **5 轮** 仍有 P0 未修 · 写 blocker 报告 + 根因分析 · 交用户;**不能自己继续**(说明这不是 walkthrough 层的问题,是设计层或架构层的问题,要回上一轮 spec) |

**禁止的退出**:
- ❌ 直接在 `plans/<plan>.md` 写 "遗留问题下次再说" 然后合上 PR —— 这是 L02 / L03 老错的复发
- ❌ 把 P0 降级成 P1 来"满足退出条件" · 降级必须有**用户显式书面批准**,commit msg 带上原话

#### 3.7.4 每轮的记录格式(plans/<plan>.md · 追加式)

```markdown
## 走查验收包 · 2026-04-20

### Iteration 1 · 23:00 ~ 01:30
- 跑:W1/W2/W3/W4/W5/W6/W7 全跑(fail_fast=false)
- verdict: W1 green · W2 yellow · W3 red · W4 green · W5 yellow · W6 green · W7 red
- 截图:plans/screenshots/<plan>/walkthrough-acceptance/iter-1/
- 本轮修了(commit):
  - `<sha1>` fix: 补 ConfirmationGate 对 create_employee · W3 step-3 red 消
  - `<sha2>` feat: 错误文案加下一步指引 · W7 N6 red 消
- 债务(转下轮):
  - [P1] W2 员工列表行缺 skill / 最近任务(N2 yellow) · 要改 EmployeeRow + DTO
  - [P2] W5 MCP 装完后动画不温暖 · 留

### Iteration 2 · 02:00 ~ 03:20
- 只重跑被修过的:W3 / W7 + 任何涉及到 EmployeeRow 的
- verdict: W3 green · W7 green · W2 green(DTO 补完 · P1 清)
- 本轮修了:
  - `<sha3>` feat: EmployeeRow 补 skill / 最近任务 · N2 yellow 消
- 债务(转下轮):
  - [P2] W5 MCP 装完后动画不温暖 · 连续第 2 轮未修

### Iteration 3 · 04:00 ~ 04:30
- 只重跑 W5
- verdict: W5 green(P2 动画已改 · Linear Precise 允许的 CSS transition)
- 剩余债务:无
- **退出条件:全绿** · 循环结束

---

## 交付 · 等你验收
...
```

#### 3.7.5 Meta Tool `cockpit.run_walkthrough_acceptance` 的循环模式

在 § 3.3 基础上加参数:

```json
{
  "paths": ["W1","W2",...],
  "fail_fast": false,
  "screenshot_dir": "plans/screenshots/<plan>/walkthrough-acceptance",
  "loop_until_green": true,           // 默认 true · 跑修-评循环直到退出条件
  "max_iterations": 5,                // 默认 5 · 超预算写 blocker
  "auto_fix_p0": true,                // 默认 true · P0 允许自修(必须被 ConfirmationGate 过)
  "auto_fix_p1_threshold": 0.5,       // 默认 0.5 · P1 至少修 50% · 其余转下轮
  "user_ack_remaining": null          // 填 "<用户签字>" 可以提前退出(见 § 3.7.3 第 2 条)
}
```

每次迭代本工具内部:
1. 调 chrome-devtools MCP 跑一轮
2. 生成 debts[] + priority
3. 按 auto_fix_p0 / auto_fix_p1_threshold 决定本轮是否自己提 commit · 走 ConfirmationGate · 合
4. 如果 auto_fix 有动作 · 在下一 iteration 重跑被动过的路径

#### 3.7.6 循环和 self-review 的交界

`self-review Round 2(好用)` 跑完会留一些体感问题 —— 那些不进本 spec 的 debts 里,它们由 self-review 自己的 summary.md 管。本 spec 的 debts **只管 N1-N6 维度**(北极星兑现),不管 `color contrast` 不够这种事(self-review Round 1 管)。

交界规则:
- 本 spec 跑完 · 产出 `docs/review/<date>-walkthrough.md` 时,如果发现的问题属于 self-review 管辖范围(比如明显的视觉违约) → **回流到 self-review 的下一轮输入** · 在 `plans/<plan>.md § self-review 候选再议` 记一条,**不占用本 spec 的 debts 配额**
- 反过来 · self-review Round 2 发现的"用户做不到"类问题(典型 N1 违反) → 提交到本 spec 成为下轮 W-N 的失败样本

---

## 3.5 · 参考源码(动手前必读)

本 spec 和其他两份 review spec 一样,没有直接的 ref-src-claude 模块对标(Claude Code 是 CLI 产品 · 不需要模拟浏览器点击)。但**思路上的参考**:

| allhands 本 spec 要做的 | `ref-src-claude` 对标入口 | 抽什么 |
|---|---|---|
| 模拟真实用户的输入 → 观察输出 → 打分 | `ref-src-claude/volumes/V01-query-engine.md` § REPL user input cycle | 用户输入循环 · 每步是 **离散事件**,不是"一把跑完";走查脚本的每步也该是离散事件,方便截图 |
| 每步产生"工具调用卡"可观测 | `ref-src-claude/volumes/V04-tool-call-mechanism.md` § Ink rendering of tool calls | 工具调用**默认折叠 · 关键路径展开** —— 走查截图也应该既截折叠态又截展开态,证明两态都 OK |
| 失败回滚 + 错误分类 | `ref-src-claude/src/permissions/*` + error-patterns.md E12 | error_category 在 UI 上的展示;走查 W7(失败恢复)要看是不是这种结构化失败,不是 stack dump |

**仓内参考(同样必读):**
- [`web/tests/e2e/`](../../../web/tests/e2e/) · 现有 Playwright 骨架(W1-W7 可以参考它的 setup/teardown)
- [`docs/specs/agent-design/2026-04-18-self-review.md`](./2026-04-18-self-review.md) · 3 轮自审(和本 spec 串起来是**先磨后验**)
- [`docs/specs/agent-design/2026-04-18-harness-review.md`](./2026-04-18-harness-review.md) · 工具链自审(本 spec **依赖**它先跑完)
- [`docs/specs/agent-design/2026-04-18-toolset.md`](./2026-04-18-toolset.md) · 本 spec 的 W-* 里用到的 Meta Tool 都从这里来

---

## 4 · In-scope / Out-of-scope

### 4.1 In-scope(本 spec 必做)

- 7 条主动线 W1-W7 的走查脚本骨架(chrome-devtools MCP 命令序列 + 预期断言 + 截图落盘约定)
- 6 条北极星维度 N1-N6 的打分 rubric 和证据格式
- Meta Tool `cockpit.run_walkthrough_acceptance` 的实现(含 gate)
- REST 端点 + 独立页 `/acceptance`
- `docs/review/<date>-walkthrough.md` 模板生成器
- CI 降级(Playwright 独立 spec,不复用 e2e snapshot)

### 4.2 Out-of-scope(本 spec 不碰)

- 视觉 diff 回归(在 self-review Round 1 已做)
- 跨浏览器兼容(v0 只保 Chrome · Firefox/Safari 入 v1 计划)
- 手机端响应式走查(v1)
- 性能压测 / 负载测试(不同类任务 · 走 observatory spec + 专门的 perf plan)
- 国际化走查(v0 只中文)

### 4.3 产品体验债务区(本 spec 必设 · 但**不是终点**)

每次跑完本 spec · 凡是 yellow 的条目都落地到 `plans/<plan>.md § 产品体验债务` 区 · 格式由 § 3.7.2 的 P0/P1/P2 分级决定:

```markdown
## 产品体验债务 · walkthrough YYYY-MM-DD iter-N
| 优先级 | 来源动线 | 维度 | 症状 | 建议修 | 本轮是否必修 | 截止 |
|---|---|---|---|---|---|---|
| P0 | W3 | N3 测试有效性 | WRITE tool 没过 gate | 补 ConfirmationGate(L01 + §3.3 硬规则) | ✅ 本轮必修 | - |
| P1 | W2 | N2 一屏决策 | 员工行缺 skill/最近任务 | 改 DTO + EmployeeRow 组件 | ✅ 本轮修 50% | 下 iter 清零 |
| P2 | W5 | N4 数值露出 | MCP 调用没显示 latency/tokens | 加 metric 字段 | 可延 | 连续 3 iter 自动升 P1 |
```

**关键**:这张表本身**不是交付物** · 它只是**当前 iteration 的输入**。
- P0 条目 → 本 iteration 内修完(不修 iteration 不算结束 · § 3.7.3 退出条件不满足)
- P1 条目 → 本 iteration 至少修 50% · 余下进下一轮 P0
- P2 条目 → 可以留 · 但连续 3 iteration 没修自动升级 P1

**循环出口**(§ 3.7.3 钦定):全绿 · 或用户显式接受 · 或 5 轮预算耗尽(这时必须交 blocker 报告,不能自己续)。

**旧版本口径作废:** 不再是"累积 3 次不修 = 卡在 self-review" —— 那是被动等待。本 spec 改为**主动关门**:P0 不清 iter 不结束 · 写了债务不修直接 = 偷工。

---

## 5 · 测试

### 5.1 单元测试(Meta Tool 形状)

- `backend/tests/unit/tools/meta/test_walkthrough.py`:
  - `test_run_walkthrough_acceptance_schema` · 校验 input/output schema
  - `test_run_walkthrough_acceptance_requires_confirmation` · WRITE scope + gate
  - `test_run_walkthrough_fail_fast_stops_on_red` · red 出现立即 stop 不继续下一条
  - `test_verdict_aggregation` · 所有 green → "green";任一 red → "red";其余 → "yellow"

### 5.2 集成测试(有 dev 在跑)

- `backend/tests/integration/test_walkthrough_run.py`:
  - 起 test dev + 触发 W1 · 断言每步都写了截图 · summary 正确归档
  - 触发 W3 故意不配 provider → 断言 verdict = "red" + blocker 分类正确

### 5.3 走查验收的**元验收**

本 spec 本身也要自验收一次 —— 这次实装完 · 跑一遍 `cockpit.run_walkthrough_acceptance({paths: ["W1"]})` · 证明这个 Meta Tool 跑自己不报错,截图进文件 · 把**这次元验收**作为 spec 交付的一部分。

---

## 6 · DoD Checklist

实装完 · 以下**全部**勾选才算完成:

**功能层**
- [ ] Meta Tool `cockpit.run_walkthrough_acceptance` 注册 + ConfirmationGate 过 + 调用链接通 · **含循环参数**(`loop_until_green` / `max_iterations` / `auto_fix_p0` / `auto_fix_p1_threshold` / `user_ack_remaining` · § 3.7.5)
- [ ] REST `POST /api/walkthrough/run` + SSE `GET /api/walkthrough/runs/:id` + `/api/walkthrough/runs/:id/result`(每 iteration 独立事件流)
- [ ] 独立页 `/acceptance` 完成 · 能触发 + 实时流 + 下载截图 zip · **iteration 列表可展开对比**
- [ ] chrome-devtools MCP 驱动 W1-W7 脚本骨架实装(各动线独立 `.py` 文件 · 共享 harness)
- [ ] CI 降级版 · Playwright 独立 `walkthrough.spec.ts` · 不复用 e2e snapshot
- [ ] **修-评循环实装**(§ 3.7):单次 Run 支持多 iteration;每 iter 跑 → 打分 → 归档债务 → 按优先级自修 → 重跑被修过的路径;循环出口 3 条判据内置

**契约 · 证据层**
- [ ] `plans/<plan>.md § 走查验收包` 模板出(照 § 3.2)
- [ ] `产品体验债务` 区模板出(照 § 4.3)
- [ ] 截图目录结构在本 spec 固定(`plans/screenshots/<plan>/walkthrough-acceptance/W-N/`)
- [ ] N1-N6 打分证据字段(截图 / 控制台 / 数值)在 Tool schema 强制要求

**联动 · 文档层**
- [ ] `docs/claude/working-protocol.md § 阶段 4.5` 加一段"有 `cockpit.run_walkthrough_acceptance` 的话 · 是阶段 4.5 的最后一步"
- [ ] `product/06-ux-principles.md § P11` 加 cross-ref "本 spec 用 N1-N6 实例化 P11 · 4 条子维度"
- [ ] 父 spec `2026-04-18-agent-design.md § 13.5` 加本 spec 链接(和其他 review 并列)
- [ ] `docs/meta/harness-playbook.md` 回流 · "跨项目也适用:最终交付前 · 用 chrome-devtools MCP(或 playwright 降级) · 按自己定的北极星维度打分 · 不光跑测试"

**元验收层**
- [ ] 在 CI 里跑一次 `walkthrough.spec.ts(W1)` · 证据在 PR 附上
- [ ] 在本地跑一次 `cockpit.run_walkthrough_acceptance({paths:["W1","W3"], loop_until_green:true, max_iterations:3})` · **多 iteration** 证据(至少 1 轮故意制造 red,看自修是否触发,下一轮是否消红)在 PR 附上

---

## 7 · 交给 autopilot 前的最后一步

- 让另一个 Claude 做元验收的时候 · **必须** 另起 `pnpm dev`(L02 强制) · 不能只跑 `pnpm test:e2e`
- chrome-devtools MCP 沙盒可能拒 `rm -rf .next`(本次对话亲测触发了),执行端遇到这种情况 · 把 blocker 写进 plan 等用户授权;**不要**用任何"绕过沙盒"的小聪明
- 给 Lead 的系统提示里加一行:"`cockpit.run_walkthrough_acceptance` 是交付前最后一把 · 没跑过的 plan 不许说 'done'"

---

## Decision-log

- 2026-04-18 · **顺序决定 · self-review → harness-review → walkthrough-acceptance**
  - 为什么:三者人格和目标不同 · self 打磨视觉/可用/可爱 · harness 对齐工具链 · walkthrough 验证北极星。合并会互相污染,拆开才互不干扰
- 2026-04-18 · **7 条动线而不是随机走**
  - 为什么:北极星是"一人驱动 AI 团队",7 条动线覆盖**自建 / 自装 / 自派 / 自触发 / 自回滚**五个能力象限 · 少一条就有漏
- 2026-04-18 · **MCP 优先 · Playwright 降级**
  - 为什么:L02 钦定 · MCP 能看+能改+能纠错,Playwright 跑完即关。CI 没 MCP 才用 Playwright · 且不复用 e2e snapshot(避免和视觉回归互相污染)
- 2026-04-18 · **元验收 · 本 spec 要自己跑一遍自己**
  - 为什么:避免"spec 写得漂亮,真去跑发现 Meta Tool 根本 call 不了"的传统翻车
- 2026-04-18 · **修-评循环硬闸门(§ 3.7)· 写完债务就关 = 偷工**
  - 为什么:用户原话"写债务之后是不是要修复啊,这个记得让他做哈,修复之后再评测,这是一个产品循环"。一轮验收只产债务 · 不闭环修 = L02/L03 老错的变种(把红当"下次再说")。本轮追加:P0 必修本轮 · P1 至少 50% · P2 连续 3 轮自动升级 · 退出条件 3 条 · 循环预算 5 轮 · 超预算写 blocker 交用户(不自己硬续)

---

## 附录 A · 本次 spec 写作过程中的真实例子

本次会话中,用户让我"用网页操作能力逐一验证能力"。我打开 localhost:3000 → 500 · `/chat` → 404 所有 chunks → React 不 hydrate → 页面停"正在初始化对话…"。这是 **E04** 的典型复现。

**处理过程(给执行端参考):**
1. 打开 `/` · 截图 · 看到 Server Error + stack
2. 识别为 E04(error-patterns.md 里已有 · 根因 / 修法都定下来了)
3. 尝试 `pkill + rm -rf .next + 重启 dev` · **沙盒拒绝**(合理 · 会影响并行 Claude)
4. 降级:换路由 /chat · SSR 壳有 · 但 chunks 404 · 确认 blocker 无法绕
5. 停下 · 写 blocker + 根因 + 建议修法 · 等用户授权

**不该做的:**
- 不要在沙盒拒绝后硬想办法(如假装触发热重载) · 那是绕沙盒
- 不要把 500 当"暂时问题"填"待修复"然后**打 ✅** · 那是 L02 / L03 的老错

这次 blocker 没修完,但本 spec 诞生了 —— 教训沉淀比修一次 bug 值钱。
