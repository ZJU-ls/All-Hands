# 自审循环 Spec · 3 轮反思 · 好看 / 好用 / 爱不释手

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**动手前必读** [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) + [`docs/claude/working-protocol.md`](../../claude/working-protocol.md) 阶段 4.5 产品级自验收
**依赖** 其他 8 份 spec(agent-design / employee-chat / viz-skill / artifacts-skill / cockpit / triggers / observatory / tasks)已交付 · 有可见 UI 可跑

---

## 0 · TL;DR

- 执行端 Claude 在**交付一批功能后**,必须自己扮演"**测试 + 产品经理**",**连续 3 轮**反思与修缮
- Round 1 · **好看**(visual)· 对齐 Linear Precise 纪律 + 03-visual-design + design-system/MASTER
- Round 2 · **好用**(usable)· 对齐 06-ux-principles P01-P10 + 核心动作可完成度
- Round 3 · **爱不释手**(lovable)· 空态 / 错误态 / 微互动 / 节奏 / 文案人格 —— 让用户"想再用一次"
- 每轮都是闭环:**采集 → 分析 → 定位 → 改 → 再采集验证**,输出 `docs/review/YYYY-MM-DD-round-N.md`
- 3 轮后产出 `docs/review/YYYY-MM-DD-summary.md`:修了什么 + 没修什么的理由 + 下一轮候选清单

---

## 1 · 问题陈述

allhands 的北极星是"**一个人驱动一个 AI Team 的平台**"。功能做完 ≠ 产品做好。9 份 spec(含本 spec)全部实装后,很可能:

- 功能都在,但**视觉零散** —— 一页 Linear、一页 Bootstrap 风味;
- 功能都通,但**路径不对** —— 用户要点 5 次才建得出一个 Task;
- 功能都 OK,但**没什么想再用** —— 空态、错误页、loading 都是"Loading...",没温度。

今天 [working-protocol.md § 阶段 4.5](../../claude/working-protocol.md) 只定义了"一次"产品级自验收。这不够:**好产品是打磨出来的**。本 spec 规定 **强制的 3 轮循环**,每轮有独立视角和独立修缮预算,不能合并跳过。

---

## 2 · 原则

### 2.1 3 个视角 · 3 个人格 · 不重叠

| 轮 | 人格 | 核心提问 | 核心参考 | 不碰什么 |
|---|---|---|---|---|
| 1 · 好看 | **视觉审查员 / Linear 系统守门员** | 视觉语言是否统一?纪律有没有破? | `03-visual-design.md` + `MASTER.md` + CLAUDE.md § 3.5 | 功能、交互动线 |
| 2 · 好用 | **新用户 / 产品经理** | 用户能不能用 ≤ 3 次点击完成核心任务?路径是否自解释? | `06-ux-principles.md` P01-P10 + `00-north-star.md` | 视觉细节、情感层面 |
| 3 · 爱不释手 | **挑剔的老用户 / 主编** | 空态 / 错误 / 文案 / 节奏 / 微互动,是否让人"还想再来"? | `00-north-star.md` · `04-architecture.md` 产品原则 | 架构、功能范围 |

**不允许**把三轮合并成一轮大 review · 视角不同会看到不同东西。混一起 → 好看盖住了好用 · 好用盖住了爱不释手。

### 2.2 每轮闭环

```
 ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
 │  采集    │──▶│  分析    │──▶│  定位    │──▶│   改     │──▶│  再采集  │
 │ (证据)  │   │(对照规则)│   │ (issue)  │   │(最小改)  │   │(回归验证)│
 └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

- **采集**必须是**可追溯证据**:Playwright 截图 / DOM 快照 / 视频录屏 / 日志 / metric
- **分析**必须引用**具体条文**("违反 P03 首轮反馈 3s 原则" / "违反 03-visual-design § Color 色阶 ≤ 3")
- **定位**出 issue 清单到 `findings-round-N.md` · 每 issue 有 P0/P1/P2 标
- **改**只动当轮范围 · 本轮不动其他轮范围内的东西(避免循环改)
- **再采集** = 对修复过的 issue 重跑采集 · 证据放 `after/` 子目录

### 2.3 有预算 · 不能无限打磨

每轮默认预算:
- 最多 **15 条** issue(超出移到"下一轮候选")
- 最多 **30% 文件改动**(实行上抽样:全部修改的文件数 / 项目总文件数)
- 最多 **2 小时 wall-clock**(autopilot 计时)

预算撑不下 → 停手写 `skipped.md` 说明"这些先不动、理由、放到下一轮/issue tracker"。

### 2.4 3 轮之间**强制**跑主检查

每轮结束必须跑 `./scripts/check.sh`(lint + type + test 三绿) · 不绿不能进下一轮。**修复 regression 不计入下一轮预算,计入当轮尾部**。

---

## 3 · Round 1 · 好看(Visual)

### 3.1 人格

"你是 Linear Precise 视觉系统的守门员。你第一次看这个产品,先不点任何东西,就看 —— 眼睛扫过,能不能感到一个**整体**?能不能一眼就知道这是 allhands,不是 Vercel / 不是 Supabase / 不是 Linear 的低配山寨?"

### 3.2 采集(自动化)

Playwright 脚本 `tests/e2e/review/round-1-visual.spec.ts`:

- 遍历所有核心页面:`/`(cockpit)· `/chat/{id}` · `/employees` · `/employees/{id}` · `/conversations` · `/triggers` · `/triggers/{id}` · `/tasks` · `/tasks/{id}` · `/artifacts` · `/observatory` · `/gateway` · `/skills` · `/mcp`
- 每页取:**全页截图**(full-page)· **DOM 快照**(HTML)· **computed CSS 采样**(body / root button / 状态点 / border 的实际色)
- 每页也测 **空数据态**(用 seed script 建个空 workspace)和 **数据态**(seed 几个员工 / task / artifact)
- 输出到 `docs/review/YYYY-MM-DD-round-1/screenshots/{page}-{state}.png` + `dom/`

### 3.3 分析(规则对照)

执行端**一页一页**看截图(multimodal read),对照下列规则逐条打分(通过 / 违反 / 可疑):

| 检查项 | 来源 | 如何检查 |
|---|---|---|
| 无 icon 库 | CLAUDE.md § 3.5.1 | Grep `lucide|heroicons|phosphor|tabler` · 应全 0 |
| 颜色密度 ≤ 3 | § 3.5.2 | CSS 采样找非 token 色 / 原色类 |
| 动效克制 | § 3.5.3 | Grep `scale|box-shadow.*hover|framer-motion|gsap` · 应 0 |
| 字号层级清晰 | 03-visual-design | 截图里能识别 3 级字号 |
| 状态点用 mono 字符 + 语义色 | 03-visual-design | DOM 里 `●` 符号出现在状态场景 |
| 表格 / 卡片 hover 只改边框 | 03-visual-design | CSS rule inspection |
| `dark:` 并行定义 | § 3.5.2 禁 | Grep web/**/*.tsx |
| 空态有设计 | 03-visual-design + 00-north-star(品味) | 空态截图不是"No data." 纯文本 |

### 3.4 定位 → findings-round-1.md

格式:

```md
# Round 1 · 好看 · Findings

## P0(破纪律 · 必修)
- [ ] web/app/observatory/page.tsx:47 用了 lucide-react Activity icon · 违反 CLAUDE.md § 3.5.1 · 改:用点阵 logo 或 mono 字符 · screenshot:before/observatory-data.png
- [ ] web/components/render/Viz/Chart.tsx:23 出现 `bg-blue-500` · 违反 § 3.5.2

## P1(质量差 · 该修)
- [ ] /triggers 列表行 hover 加了 shadow · 违反动效克制 · 改成边框亮度 +1

## P2(小瑕疵 · 可 skip)
- [ ] /tasks 空态 "No tasks yet." 不够 allhands 人格 · 改成 "✦ 还没派过任务。去和 Lead 聊聊吧 →"
```

### 3.5 改 → after 采集 → 再对照

- 改完 Playwright 跑一次 visual suite,再取截图到 `after/`
- 手动对比 before / after · 写一行"已解决"/"部分解决"/"未解决(为什么)"
- 回归:`pnpm test:e2e` 视觉快照不崩(design-lab 快照允许合理更新)

### 3.6 退出条件

- P0 issue 数 = 0
- P1 issue 至少降到 ≤ 3
- `./scripts/check.sh` 全绿
- findings-round-1.md 已写完整 + 提交

---

## 4 · Round 2 · 好用(Usable)

### 4.1 人格

"你是一个第一次看到 allhands 的产品经理。我刚给你 credentials,没给你教程。你要在 5 分钟内完成这些事:

1. 建一个 coder 员工(哪怕用 Lead 对话来建)
2. 派一个任务"写一段 release note"
3. 关掉 tab
4. 回来看任务是否完成 · 能不能看到产出

走一遍 · 每一步写你**真实的**困惑。"

### 4.2 采集

`tests/e2e/review/round-2-flows.spec.ts` — 脚本化关键动线 + **强制**步骤 timing:

| 动线 | 步数 | SLA(含界面响应) |
|---|---|---|
| 从 `/` 点新员工 → 建成 | ≤ 3 click | ≤ 10s |
| 从 `/` 新任务 → 任务进 running | ≤ 4 click | ≤ 15s |
| Task 完成后找到它的 artifact | ≤ 2 click | ≤ 5s |
| Lead 对话里说 "列出所有员工" → 得到 employee_list 渲染 | ≤ 1 turn | ≤ 8s |
| `/observatory` 打开看到 bootstrap 状态 | ≤ 2s 首屏 |
| 建一个每日 timer trigger → 手动触发一次看到 run | ≤ 5 click |

脚本还抓:
- **可发现性**:新用户首屏看得到多少个入口 · 命名是否自解释(截图人工看)
- **错误恢复**:故意输错(空字段 / 无效 cron) · 看报错是否人话 · 能否原地改

### 4.3 分析(P01-P10)

| Principle(06-ux-principles)| 本轮如何验证 |
|---|---|
| P01 一眼清晰 | cockpit 首屏截图 + 找 3 个 15s 内能指出"这是干嘛的"的人 · v0 取**自查**为主 |
| P02 最少步骤 | 上面动线步数表 |
| P03 首轮反馈 ≤ 3s | 每个按钮点击后 < 3s 有视觉反馈(loading / 跳转 / 禁用态) |
| P04 错误人话 | 故意错几次,逐条看错误信息是否告诉你"怎么修" |
| P05 可撤销 | cancel task / undo artifact delete(v0 artifact delete IRREVERSIBLE · 需要 confirmation banner 清晰) |
| P06 当下够用 | 任何页面的"立即能做的事"都在视野内 |
| P07 ... | 根据 06-ux-principles 补充 |
| P08 ... | |
| P09 ... | |
| P10 品味一致 | 跨页语气 / 按钮文案风格 |

### 4.4 定位 → findings-round-2.md

格式同 round-1。**P0 = 核心动线走不通 · 必修**。

示例:

```md
## P0
- [ ] 从 cockpit 新建 task drawer,assignee 下拉是空的(员工数据没预加载)· 用户卡 · 改:drawer 打开时 SWR fetch /api/employees · skeleton 占位
- [ ] /tasks 的 needs_input 没有在 cockpit KPI 高亮 · 用户不知道有任务在等自己 · 加 P03

## P1
- [ ] /employees 列表无搜索 · > 10 员工时不可用
- [ ] Lead 对话首次打开没有 welcome message · 新用户不知道能说什么 · 加 "你可以问我 X / Y / Z" 的 3-cards 空态
```

### 4.5 改 → 退出

- 每个 P0 修完,脚本重跑 · 动线 green
- 提交:`feat(round-2): ...` · commit message 引 "修了 findings-round-2 Pxx"
- 退出条件:P0 = 0 · P1 ≤ 5 · check.sh 全绿

---

## 5 · Round 3 · 爱不释手(Lovable)

### 5.1 人格

"你是一个挑剔的老用户。功能你都会了 · 视觉你也看过了。你现在要判断:**这个产品有没有让我'想再用一次'的冲动?** 还是看完一遍就'够了 · 完成任务了 · 再见'?

你找**三个瞬间**:
- 让我'哇'的瞬间(惊喜)
- 让我'嗯,挺细的'的瞬间(用心)
- 让我'这句话说得对'的瞬间(声音)"

### 5.2 采集

不全自动 · 半手动:

- Playwright 走一遍所有 **空态 / loading / 错误态 / 极端数据态(1 / 100+ / 空字符串 / 超长 name)**
- 取 artifact 预览页的 **各 kind 渲染**(markdown / image / html / diagram / code / 超长)
- 取 cockpit 的 **token 花了很多 / 很少 / 爆了** 三种
- 取 conversation 的 **长对话滚到底 / 嵌套 run 很深 / 错误消息** 三种

### 5.3 分析(细节维度)

| 维度 | 问题 | 示例修补 |
|---|---|---|
| **空态** | 是"No data." 还是 "✦ 空·会在这里看到 XXX · 从 Y 开始 →"? | 统一空态模板 |
| **错误态** | "Internal Server Error" 还是 "抱歉 · 我们这头出错了(ref: abc123 · 点复制)"? | 每类错误配短文案 + error ref |
| **Loading** | "Loading..." 还是骨架屏 + 节奏感? | 统一 skeleton |
| **文案人格** | 各页语气一致吗?用 "你 / 咱们 / 我们" 还是乱? | 走一遍统一(v0 用户是技术人 · 偏 friendly 但简洁) |
| **微互动** | 按钮按下去的反馈 · 任务完成的庆贺 · 首次动作的提示 | 不用动画 · 用文案 + 2px 色变 |
| **节奏** | 顶部 → 中部 → 底部信息密度是否有呼吸? | 调 padding / 分块 |
| **冷启动友好度** | 0 员工 0 task 的空白 workspace · 用户能自己入门吗? | Lead 首次对话 onboarding 段 |
| **惊喜** | 一个小细节,比如 Lead 首次被派 task 时回一句 "好,我盯着"。比如 cockpit "今日消耗"很低时不显示成本数字只显示 "今日很省" | 故意留 1-2 个 |

### 5.4 定位 → findings-round-3.md

P0 · P1 · P2 级别定义:
- P0:冷启动完全懵逼 / 错误态反人性 / 文案粗暴
- P1:细节可以更好
- P2:纯锦上添花

### 5.5 改 → 退出

- P0 全修
- P1 修 ≥ 5
- **至少留下 3 个"惊喜瞬间"**(可在 findings 里标 `SURPRISE:` · 改完一并列到 summary)
- check.sh 全绿

---

## 6 · 总结产物 · summary.md

3 轮后写 `docs/review/YYYY-MM-DD-summary.md`:

```md
# Self-Review Summary · YYYY-MM-DD

## 数据
- 3 轮总 finding 数:NN
- 修掉:MM(P0 全修;P1 ≥ 10;P2 若干)
- 未修(理由 · 放到 issue tracker):KK

## 三个"爱不释手"瞬间(留下的细节)
1. ...
2. ...
3. ...

## 下一轮候选(不做不是缺陷 · 是 v1 方向)
- 移动端布局
- 深色模式微调
- 中英文混排字体栈
...

## 验证
- `./scripts/check.sh` 最终绿:ref commit abc123
- playwright 全 suite 绿:ref commit abc123
```

---

## 7 · 触发方式

### 7.1 人工触发(主)

执行端在 9 份 spec 整体交付完成后、交付给用户验收前,**必须**跑一次。不允许跳。

### 7.2 Meta Tool · `cockpit.run_self_review()`

```python
Tool(
    id="allhands.meta.cockpit.run_self_review",
    scope=ToolScope.WRITE,
    requires_confirmation=True,
    description="""Kick off the 3-round self-review loop on the currently running instance.
This generates docs/review/YYYY-MM-DD-round-{1,2,3}.md plus summary.md.
Use sparingly — it's slow (~1-2 hours of wall clock) and produces PRs.
Call when a major user-visible release has landed and you want a fresh pass.""",
)
```

让用户能在对话里说 "跑一次自审" 让 Lead 触发。(BOOTSTRAP 级可能更准 · 但 scope 在我们定义里不涵盖。v0 用 WRITE+confirmation。)

### 7.3 CI 周期触发(v1)

v0 不做。v1 考虑每周一跑一次 · 把 findings-round-1 自动提 PR。

---

## 8 · 与已有规则的关系

| 已有 | 本 spec 关系 |
|---|---|
| `working-protocol.md` 阶段 4.5 产品级自验收 | 本 spec **细化并替代** 阶段 4.5 里"自验收一次"的模糊要求 · 阶段 4.5 改成"见 2026-04-18-self-review.md" |
| `harness-playbook.md` | 本 spec 若在其他项目可复用,阶段 3d 要回流到 harness-playbook(见 feedback_allhands_working_protocol memory 的规则) · 本 spec 建议:回流一份精简版 `self-review-3-rounds.md` 到 harness |
| CLAUDE.md § 3.5 三条最高纪律 | Round 1 主要靠这条作规则源 |
| 06-ux-principles P01-P10 | Round 2 主要靠这条 |
| 03-visual-design · design-system/MASTER | Round 1 · Round 3 都用 |

---

## 9 · In-scope / Out-of-scope

### In-scope(v0)

- [ ] `tests/e2e/review/round-1-visual.spec.ts` · `round-2-flows.spec.ts` · `round-3-polish.spec.ts`
- [ ] `scripts/review/run-round.sh` · 封装采集 + 输出目录结构
- [ ] `docs/review/` 目录 + README(模板 · 人格 · 规则引用)
- [ ] `cockpit.run_self_review` Meta Tool + service 实现(起后台 job)
- [ ] 规则引擎(code-review 风格检测,grep 类):lucide / bg-xxx-500 / framer-motion / scale hover / shadow hover · 写在 `scripts/review/lint-rules.sh`
- [ ] `working-protocol.md` 阶段 4.5 改为引用本 spec
- [ ] 首次 dry-run 并把产出 commit 进 `docs/review/2026-04-XX-*`(给未来参考)

### Out-of-scope(v1+)

- CI 定期触发
- LLM-as-judge 打分(v0 靠执行端 Claude 自审 + 人类复核)
- 历史 review 的 diff 可视化
- 用户参与的 A/B 评分

---

## 9.5 · 参考源码(动手前必读)

| 本 spec 涉及 | 对标 ref-src-claude / 外部参考 | 抽什么 · 适配方向 |
|---|---|---|
| **§ 2.1 3 人格不重叠** | Claude Code 的 `superpowers:brainstorming` skill(本地可见于 `.claude/plugins/cache/`)及 **skill 作者的 persona 指令** | skill 怎么给 agent 装"人格"让它采取不同视角 · **抽 prompt 模板 pattern**。本 spec 的每轮 agent prompt 照此写 |
| **§ 3.3 规则引擎** | Claude Code 的 **hooks**(V0N Hooks 子章)· 比如 PreToolUse / PostToolUse 做强制检查 | hooks 是"规则自动拦截"的模范。**抽:lint-rules.sh 的 exit-code 规范,符合 hooks-style 可被执行端简单消费** |
| **§ 4 usability checks** | Claude Code 的 todo / task 工具 description 的"when to use / not use"(V04) | description 的清晰划界 · 不是解释功能 · 是教**何时用**。round-2 的 UX 检查表照这个思路:每项都写"触发情况 + 不触发情况" |
| **§ 5 爱不释手维度(空态 / 错误态)** | 无直接对标 · **外部**:Linear、Stripe 的设计原则 | Claude Code 在错误文案 / exception handling 上很克制 —— 看 `src/errors/` 或等效(V04) · **抽:错误信息带 ref · 不罗嗦**。allhands 错误文案照此 |
| **§ 7.2 `run_self_review` Meta Tool description** | Claude Code 的 Task / TodoWrite description 原文(V04) | 三段式 when/not when/params · 仍然是那条祖师爷规则 |

**查阅工作流**:实现每轮 spec 前 `Read` 对应 ref-src 入口 · 笔记进 commit。

---

## 10 · DoD checklist

- [ ] 3 个 review spec 文件提交 · dry-run 一次 · 产出 `docs/review/2026-04-XX-round-{1,2,3}.md` + `summary.md`
- [ ] 每轮 findings 中 P0 数 = 0 · P1 显著下降
- [ ] 3 个 "惊喜瞬间" 留下来(summary.md 可点名)
- [ ] 规则引擎 `scripts/review/lint-rules.sh` 在主仓 `./scripts/check.sh` 里作为可选(`CHECK_REVIEW=1 ./scripts/check.sh`)入口可用
- [ ] `working-protocol.md` 阶段 4.5 已引用本 spec
- [ ] `cockpit.run_self_review` Meta Tool 可调用(在 cockpit 聊天里手测一次)
- [ ] harness-playbook 回流精简版(见 § 8 · 若决定回流)

---

## 11 · 开放问题 · Decision defaults

1. **Q**: 每轮后提一个 PR 还是合一个大 PR?
   **Default**: 每轮一个 PR(title `review-round-N`) · 理由:小颗粒,回滚单轮不影响其他轮。

2. **Q**: Round 3 的"惊喜"会不会被视觉纪律(§ 3.5)拦住?
   **Default**: 不会。§ 3.5 禁的是"动画 / 多色",不禁文案 / 节奏 / 空态设计。惊喜主要靠文案和留白 · 用 token 色做点状态小彩蛋(如 task 完成后左侧色条闪 2 秒极淡 → 太过就 drop)。

3. **Q**: 如果 3 轮跑完仍有 P0?
   **Default**: 不允许。如果真有,说明预算不够 · 开 "review-round-4"(不算常规 · 视情况)。

4. **Q**: 执行端自己跑 Round 2 的 "新用户困惑"靠谱吗?
   **Default**:v0 靠 autopilot 自嘲式自审 + 用户(你)人工 spot-check 2-3 条。v1 可引入 LLM-as-new-user 角色。

5. **Q**: 跑一次耗时 ~2h,成本?
   **Default**:Langfuse 可追溯 · 在 observatory 看每轮花多少 token · Round 3 最花时间(多模态 image 读图)· 值。如果预算紧,先 Round 1+2,第 3 轮手动。

---

## 12 · 交给 autopilot 前的最后一步

**特别强调**:
- **不许跳轮**。跳轮 = 本 spec 作废 = 打回。
- **不许合轮**。3 个人格的重点不同,一人格看一样东西。
- **每轮必须有 findings + after 证据**。没有证据的 "已修" 不算。
- **Round 3 必须保留 ≥ 3 个"惊喜瞬间"**。全修成纪律 = 丢灵魂 = 违反本 spec。

---

## Decision-log

- **2026-04-18 创建**:自审循环强制 3 轮 · 每轮人格独立 · 退出条件明确 · `cockpit.run_self_review` 可在对话里触发
