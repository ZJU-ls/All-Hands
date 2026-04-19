# 2026-04-19 · 并行执行编排(3 条轨道 · 10-13h 交付 v0)

> **受众:autopilot 执行端 Claude · 每条轨道启动前必读本文的对应一节。**
>
> 目的:把剩余 11 份 spec 拆成 3 条**文件级无冲突**的轨道,从串行 12-14h 压到并行 7-9h + 最终串行 3-4h = **10-13h**。

---

## 0 · 背景

- Wave A(agent-design)+ Wave B.1(viz-skill)**已交付**(commit `2b1ac9b`、`20fce44`)
- Track 1 已在 main 分支上跑(就是目前这个执行 Claude · 继续推 Track 1)
- Track 2、Track 3 **新开执行 Claude · 在 git worktree 里跑 · 不回 main 之前互不干扰**
- 最终还有 3 份 spec(visual-upgrade / self-review-harness-review / walkthrough-acceptance)**必须串行** · 3 条 track 汇合后由**任一**空闲 Claude 接力

---

## 1 · 3 条轨道(file-level 无冲突)

### Track 1 · Backend infra(已在 main 跑 · 沿用现 Claude)

**Spec 顺序:**
1. [observatory](./2026-04-18-observatory.md) · Langfuse 自部署 + bootstrap + `/observatory` 页
2. [triggers](./2026-04-18-triggers.md) · events 表(migration **0004**)+ timer/event executor + `/triggers` 页
3. [tasks](./2026-04-18-tasks.md) · tasks 表(migration **0005**)+ 异步 worker + `/tasks` 页
4. [toolset](./2026-04-18-toolset.md) · 核心工具集 Plan/SubAgent/Sandbox/Web/FS · `execution/tools/*` 扩展

**文件白名单(只许动这些):**
- `backend/src/allhands/observability/**`
- `backend/src/allhands/execution/{triggers,tasks}/**`
- `backend/src/allhands/execution/tools/meta/{triggers_tools.py,tasks_tools.py,sandbox_tools.py,web_tools.py,fs_tools.py}`
- `backend/src/allhands/execution/tools/plan_tools.py`(toolset 扩展)
- `backend/src/allhands/services/{triggers_service.py,tasks_service.py,observatory_service.py}`
- `backend/src/allhands/api/routers/{triggers.py,tasks.py,observatory.py}`
- `backend/alembic/versions/0006_*.py`(triggers · **进行中**)
- `backend/alembic/versions/0007_tasks.py`(tasks)
- `backend/tests/unit/{test_triggers,test_tasks,test_observatory,test_toolset}_*.py`
- `docker-compose.yml`(observatory 要加 Langfuse service)
- `web/app/{observatory,triggers,tasks}/page.tsx` + 对应 components
- `web/components/{observatory,triggers,tasks}/**`

**不许动:**
- `web/app/employees/[id]/**`(Track 2)
- `web/app/artifacts/**`(Track 2)
- `web/app/page.tsx`(cockpit · Track 2)
- `web/{components/ui,app/globals.css,tailwind.config.ts}`(visual-upgrade · 最终串行)
- `backend/src/allhands/services/{chat.py,artifacts_service.py}`(Track 2)
- `docs/claude/**`(Track 3 + owner)
- `product/**`(只有 ADR 流程或本 spec 作者能动)
- `CLAUDE.md`(同上)

**migration 保留:triggers=0004 · tasks=0005**(不要生成 0006+)

---

### Track 2 · UI 链 · 需要新开一个执行 Claude(worktree)

**Spec 顺序:**
1. [employee-chat](./2026-04-18-employee-chat.md) · `/employees/[id]` + MessageList 扩展
2. [artifacts-skill](./2026-04-18-artifacts-skill.md) · `allhands.artifacts` skill + `/artifacts` + multimodal 持久化(migration **0006**)
3. [cockpit](./2026-04-18-cockpit.md) · `/` 首页驾驶舱 + workspace-level SSE

**前置依赖(必须等 Track 1 这几个文件落 main 才能起):**
- cockpit 消费 events 表 → **必须等 Track 1 的 `0006_*.py` 完成 + merge main**(Track 2 做 cockpit 前 pull main 即可 · 目前 Track 1 在 Wave B.3 · 做到 2/N)
- artifacts 和 employee-chat 不依赖 Track 1

**文件白名单:**
- `web/app/employees/**`
- `web/app/artifacts/**`
- `web/app/page.tsx`(cockpit 首页重构)
- `web/components/{chat,employees,artifacts,cockpit}/**`
- `web/lib/{sse.ts,component-registry.ts}`(只许**追加** · 不许删已有注册)
- `backend/src/allhands/services/{chat.py,artifacts_service.py}`
- `backend/src/allhands/execution/tools/meta/artifacts_tools.py`
- `backend/src/allhands/api/routers/artifacts.py`
- `backend/alembic/versions/0008_artifacts.py`
- `backend/tests/unit/test_{chat,artifacts}_*.py`
- `web/tests/{employees,artifacts,cockpit}-*.test.ts`

**不许动:**
- Track 1 白名单里的一切
- `web/app/globals.css` / `tailwind.config.ts` / `design-system/**`(visual-upgrade 最后改)
- `docs/claude/**` / `product/**` / `CLAUDE.md`

**migration 保留:artifacts=0006**

---

### Track 3 · 可靠性 / 护栏 · 需要新开一个执行 Claude(worktree)

**为什么单独立:**
- I-0001(E04 chunks)**现在就阻塞** Track 1 和 Track 2 的亲测交付 · 没人修它所有 walkthrough 都跑不了
- I-0002、I-0003 是 gateway 数据瑕疵 · 修起来小 · 但要配回归测试 · 没有能打扰 Track 1 节奏的路径
- 写 walkthrough-acceptance 之前就能把"跑什么/怎么跑"的 smoke 底座铺好(W1-W7 骨架)· 最终 Track 汇合时 walkthrough 就是"跑满 + 修债" · 而不是从零写 runner
- 过程中 Track 1 / Track 2 撞到的新 bug · Track 3 接手建 issue + 初步分诊 · 不打断主 coding

**Spec / 任务顺序(Track 3 不做 feature · 做护栏):**

1. **立即修 I-0001**(E04 chunks)· 按 `docs/issues/open/I-0001-next-chunks-404-hydration-dead.md` § 建议修法执行 · 跑回归测试 `web/tests/routes-smoke.test.ts`(如不存在先建)· 关闭 issue 走标准流程
2. **修 I-0002 + I-0003**(gateway 数据瑕疵)· 各配一条回归测试
3. **搭 walkthrough-acceptance 的 runner 骨架**(**不跑 W1-W7 · 只铺代码**):
   - `backend/src/allhands/services/walkthrough_service.py`(空接口 + WalkthroughReport 数据模型)
   - `backend/src/allhands/execution/tools/meta/walkthrough_tools.py`(Meta Tool 签名 · TODO 实现)
   - `backend/src/allhands/api/routers/walkthrough.py`(REST 入口 · TODO 实现)
   - `web/app/acceptance/page.tsx`(页面骨架 · 显示"未跑" 状态)
   - 单元测试覆盖数据模型 + Meta Tool 签名 + REST shape
   - **不写 W1-W7 具体 chrome-devtools 编排** · 留给最终串行 Claude
4. **每 30 min 扫一次 INDEX.md + 最新 commit**:
   - 新 commit 引入的新 bug → 建 I-NNNN issue · 追加到 INDEX
   - 已升级条件满足的 issue → 按 bug-fix-protocol § 升级规则改 severity
5. **维护 INDEX.md 计数**:每关一条 issue 更新"分布"表 · 每加一条更新表体
6. **空闲时补 P2 回归测试**:project-level test 覆盖 CLAUDE.md §3.5 三条视觉纪律 · `web/tests/design-contract.test.ts`

**文件白名单:**
- `docs/issues/**`(独占)
- `backend/src/allhands/services/walkthrough_service.py`(新建)
- `backend/src/allhands/execution/tools/meta/walkthrough_tools.py`(新建)
- `backend/src/allhands/api/routers/walkthrough.py`(新建)
- `web/app/acceptance/page.tsx`(新建)
- `web/tests/routes-smoke.test.ts`(新建 · I-0001 回归)
- `web/tests/design-contract.test.ts`(新建 · 视觉纪律回归)
- `backend/tests/unit/test_walkthrough_service.py`(新建)
- `backend/src/allhands/services/model_service.py`(I-0002 修)
- `backend/src/allhands/services/provider_service.py`(I-0003 修)
- `backend/alembic/versions/0003_*.py`(I-0002 / I-0003 的 seed 值)— **只许改值 · 不许加字段**
- `backend/tests/unit/test_gateway.py`(I-0002 / I-0003 回归)
- `.next/` 清理脚本(I-0001 修法)· 不进 git

**不许动:**
- Track 1 和 Track 2 白名单里的任何东西
- `CLAUDE.md` / `product/**` / `docs/claude/**`(docs/claude 本地 gitignore · 但别碰)
- `web/app/globals.css` / `tailwind.config.ts`

**migration 保留:Track 3 不新增 migration**(只改 0003 的 seed · 不改 schema)

---

## 2 · Worktree 设置(Track 2 / Track 3 启动前 · 用户一次性做)

Track 1 继续在 `/Volumes/Storage/code/allhands`(main 分支)跑。
Track 2、Track 3 各自进独立 worktree · 独立分支:

```bash
cd /Volumes/Storage/code/allhands
git worktree add -b track-2-ui    ../allhands-track-2 main
git worktree add -b track-3-ops   ../allhands-track-3 main

# 结果:
#   /Volumes/Storage/code/allhands         main(Track 1 现 Claude 在跑)
#   /Volumes/Storage/code/allhands-track-2 track-2-ui(Claude #2 在这)
#   /Volumes/Storage/code/allhands-track-3 track-3-ops(Claude #3 在这)
```

**数据库隔离:** 三个 worktree 各自的 `backend/data/allhands.db` 是独立文件 · 不冲突。

**端口隔离:** Track 2 / Track 3 起 dev server 前改端口:
- Track 1:backend 8000 · web 3000(保持现状)
- Track 2:backend 8001 · web 3001
- Track 3:backend 8002 · web 3002

端口配置走环境变量(`.env.local`)· 不要改 `.env.example`(公共契约)。

---

## 3 · 合并规则

### 3.1 每条 track 的自足性

每条 track 在自己 worktree 里 **独立:commit / 跑测试 / 跑 dev / 跑 pre-commit hook** · **不 push · 不 merge · 不 rebase main**。

**原因:** pre-commit hook 全量 check.sh · 如果 Track 1 正在改一个 backend 文件但还没 commit · Track 2 pull 过来就会红。各 track 只信自己的 worktree 状态。

### 3.2 合并窗口(用户或协调 Claude 触发)

Track 1 每完成一个 spec(observatory / triggers / tasks / toolset)的最后一个 commit · 落到 main。
Track 2 / Track 3 完成一整份 spec 后 · 通知用户 · 用户触发:

```bash
cd /Volumes/Storage/code/allhands
git fetch origin
git merge --no-ff track-2-ui    # 或 track-3-ops
# 跑 ./scripts/check.sh · 绿了 commit · 红了 Track N 负责修
```

**合并冲突:** 理论上白名单不重叠 → 不会冲突。如果冲突了 → 说明白名单被违反 → 立 L{nn} + 回滚。

### 3.3 特殊合并:cockpit 等 triggers

- Track 2 做到 employee-chat + artifacts-skill 之后 · 停下 cockpit · **等 Track 1 的 triggers spec 完整 merge 进 main**(events 表落地)
- 然后 Track 2 在自己 worktree 里 `git merge main` 把 events 表拉过来 · 再开 cockpit
- 这是全流程唯一的"跨 track 等待点"

---

## 4 · 汇合后的最终串行(任一空闲 Claude 接力)

3 条 track 全绿 + merge main 后 · 剩:

1. [visual-upgrade](./2026-04-18-visual-upgrade.md) · 改 tokens / globals.css / 所有 UI 组件 · **必须串行** · 跑完后 Track 1 + Track 2 所有 UI 页做回归截图对比
2. [self-review](./2026-04-18-self-review.md) · 3 轮反思 · 产出 debt list
3. [harness-review](./2026-04-18-harness-review.md) · audit docs/claude/* + harness-playbook
4. [walkthrough-acceptance](./2026-04-18-walkthrough-acceptance.md) · **修-评循环** · 把 Track 3 铺的骨架填满 · W1-W7 真跑 · 按 § 3.7 Fix-Reeval Loop 跑到全绿 / 用户接受 / 5-iter 耗尽

**预计 3-4h**(walkthrough 可能膨胀到 5h · 取决于债多深)

---

## 5 · 跨 track 共享约束(所有 Claude 必读)

### 5.1 contracts(动一个字都必须先问用户)

- `CLAUDE.md` / `CLAUDE.local.md`
- `product/**`(包括 03-visual-design / 06-ux-principles / 04-architecture / ADR)
- `docs/claude/**`(属于 CLAUDE.local.md 工作册)
- `docs/specs/agent-design/2026-04-18-agent-design.md` 的 § 0-13
- 本文件(`2026-04-19-parallel-execution.md`)

**谁能改:** 用户 / 走查 Claude(我)· 执行端 track 只能读。

### 5.2 bug triage 归属

- Track 3 **独占**写 `docs/issues/**` 的权利
- Track 1 / Track 2 撞到 bug → 按 `bug-fix-protocol.md` § 情况 B 的流程:复制 TEMPLATE → 写 repro/evidence → 追加到 INDEX.md · 但**不要修** · 留给 Track 3(除非阻塞当前 task 属情况 A)
- Track 3 修 issue 时 · `status: in-progress` 的 commit 要显式出现 · 其他 track 看到就不再去碰这条

### 5.3 migration 预分配(硬约束 · 违反必冲突)

**已占用**(2026-04-19 撰写时):
- 0001 initial · 0002 llm_providers · 0003 llm_models · 0004 skills_install · 0005 agent_plans · 0006 triggers_and_events(Track 1 做中)

**本 spec 保留:**

| ID | Spec | Track |
|---|---|---|
| 0007 | tasks 表 | Track 1 |
| 0008 | artifacts 表 | Track 2 |
| 0009+ | 保留(最终串行阶段)| — |

**硬约束(每条 track 生成 migration 前):**

1. 先跑 `uv run alembic heads` · 只许一个 head · 否则停下来把自己 rebase 到那个 head
2. 生成 migration 时 · 检查已存在最大 ID · 按本表分配自己的 ID · **不要自动 +1**(Track 1 可能刚好也在落 migration)
3. Track 1 继续走它的自然节奏(下一个 tasks 按 0007)· Track 2 / Track 3 严格按本表

### 5.4 commit message 标注 track

每条 commit message 加前缀:`[track-1] feat(observatory): ...` · `[track-2] feat(employee-chat): ...` · `[track-3] fix(I-0001): ...` · 方便用户读 git log 知道谁在做什么。

---

## 6 · 什么时候收(每个 track 自己的 DoD)

### Track 1 完成标准

- [ ] observatory / triggers / tasks / toolset 4 份 spec 的 § DoD 全部勾满
- [ ] backend ruff + mypy + pytest 全绿
- [ ] 对应前端页可直接打开(route 不 404)
- [ ] 新建 migration(0006 triggers 已做 · 0007 tasks)通过 `alembic upgrade head` + `alembic downgrade -2`
- [ ] 本 spec § 5.2 的 bug 归属遵守(只读 INDEX · 撞到新 bug 建 issue 不修)
- [ ] `git log --oneline main..track-1` 可读性清爽(虽然 Track 1 在 main · 对比点是 Wave B.1)

### Track 2 完成标准

- [ ] employee-chat / artifacts-skill / cockpit 三份 spec 的 § DoD 勾满
- [ ] 页面不报错 · SSE 能连上(可以只连 mock · 因为 walkthrough 阶段才真跑)
- [ ] artifacts migration 0008 双向
- [ ] cockpit 已消费 events 表(依赖 Track 1 merge 过来)
- [ ] 本 track worktree `./scripts/check.sh` 全绿

### Track 3 完成标准

- [ ] I-0001 / I-0002 / I-0003 全部 closed(文件 mv 到 `closed/` · INDEX.md 三行删掉)
- [ ] walkthrough runner 骨架 + 数据模型 + Meta Tool 签名 + REST shape + 空骨架页面全就位
- [ ] `backend/tests/unit/test_walkthrough_service.py` 跑过(只测数据模型 + Meta Tool 签名 · 不测 W1-W7)
- [ ] `web/tests/routes-smoke.test.ts` 覆盖 I-0001 回归 · 全站 10 路由 200 + chunks 无 404
- [ ] `web/tests/design-contract.test.ts` 覆盖 CLAUDE §3.5 三条纪律
- [ ] INDEX.md 在 Track 3 退出时分布准确(P0/P1/P2 计数 = 实际 open/ 文件数)

---

## 7 · 回流到 harness-playbook

如果"3 轨并行 + worktree 隔离 + 预分配 migration + 文件白名单"这套做法最后被证明**有效地压缩了交付周期** · 走查 Claude(我)要在阶段 3d 把它抽象回 `docs/meta/harness-playbook.md`:

- 新增一节"多 Claude 并行协作的底座"
- 内容:worktree / 端口隔离 / migration 预分配 / 白名单 / 合并窗口 / 单 Claude 独占 triage
- 引用本 spec 作为原生实例

这是第一次尝试 · 效果要用最终总时长验证(目标 ≤ 13h · 比串行的 14h 少 1h 就算有效)。

---

## 8 · 给执行端 Claude 的一句话

**Track 1 现 Claude:** 继续推你手上的 observatory / triggers / tasks / toolset · 不用停 · 不用 rebase · 按本 spec § 1 的白名单约束动作。撞到新 bug 按 § 5.2 建 issue 不修。

**Track 2 新 Claude:** 你在 `allhands-track-2` worktree 里启动 · 只读 `docs/specs/agent-design/2026-04-19-parallel-execution.md § 1.2 + § 2 + § 3 + § 5 + § 6.2` · 其他 track 的内容忽略。按 employee-chat → artifacts-skill → cockpit 顺序推。

**Track 3 新 Claude:** 你在 `allhands-track-3` worktree 里启动 · 你不做 feature · 你修 bug + 铺骨架 · 按 § 1.3 的 6 步顺序执行 · 你是 `docs/issues/**` 的唯一写入者。

---

## 附录 · 快速排障

- **"我建 migration 报 multiple heads"** → 你违反了 § 5.3 · 删掉你的 migration · 重新按预分配 ID 生成
- **"我的 check.sh 挂了 · 但代码没改"** → 可能 Track X 在 main 改了某个你依赖的文件 · 不要 pull · 在 worktree 里自己解决 · 最终 merge 窗口一起修
- **"我的 test 依赖另一 track 的 feature"** → 说明白名单设计有漏 · 立即停 · 通知用户 · 不要跨白名单写代码
- **"我看到 INDEX.md 有 P0 但不是我这 track 的"** → 按 § 5.2 · Track 3 独占 issue · 你不许拾 · 继续做你的 spec

---

## 9 · Wave 2(2026-04-19 夜 · 重新分工)

### 9.1 Wave 1 实际结果

- **T1(main)**:超额完成 — 完成 Wave B.3 triggers + Wave C 全三份(employee-chat / artifacts / cockpit)+ visual-upgrade + 关 I-0001 + 关 I-0004。
- **T2(track-2-ui)**:新 Claude 未启动 · 0 commit · 被 T1 替代。
- **T3(track-3-ops)**:起床后发现 I-0004 阻塞 · 写完 issue 停机 · 被动退休(I-0004 已由 T1 关)。

剩余 32-41h + 新增 stock 套件 22-28h · 重新开 Wave 2 · 3 条并行。

### 9.2 Wave 2 三轨

#### Track 1(main 沿用 · 当前 Claude 继续)
- 分支 `main` · 端口 8000/3000
- scope:toolset(12-15h)+ tasks(6-8h)
- 白名单:`execution/tools/builtin/**` · `services/task_service.py` · `core/task.py` · `api/routers/tasks.py` · migration 0011 · `web/app/tasks/**` + tests
- 不动其他 track 白名单

#### Track 2(新 · `track-2-qa`)
- 复用 `/Volumes/Storage/code/allhands-track-2` worktree · 端口 8001/3001
- scope:self-review + walkthrough-acceptance + harness-review(9-12h)+ 审计已交付 7 份 spec
- 白名单:`scripts/{self-review,walkthrough-acceptance}.sh` · `backend/tests/acceptance/**` · `web/tests/acceptance/**` · `docs/claude/qa-playbook.md` · `harness/**`
- **只动测试 / 脚本 / 文档 · 不动 feature 代码**

#### Track 3(新 · `track-3-stock`)
- 复用 `/Volumes/Storage/code/allhands-track-3` worktree · 端口 8002/3002
- scope:notification-channels + market-data + stock-assistant(22-28h · v0 三份)
- 白名单:`core/{channel,market}.py` · `services/{channel,market}_service.py` · `execution/{channels,market}/**` · `execution/tools/meta/{channel,market}_tools.py` · `api/routers/{channels,market,notifications}.py` · `skills/stock_assistant/**` · migration 0009+0010 · `web/app/{channels,market,stock-assistant}/**` · `web/components/{channels,market,stock-assistant}/**`
- **严格只新增 · 零修改既有文件**

### 9.3 Wave 2 migration 预分配

| ID | 归属 | 表 |
|---|---|---|
| 0009 | T3 | channels / channel_subscriptions / channel_messages |
| 0010 | T3 | watched_symbols / holdings / market_snapshots / market_news |
| 0011 | T1 | tasks |

### 9.4 Merge 信号

- T2 完成 → `allhands-track-2/TRACK-2-QA-READY.md`
- T3 完成 → `allhands-track-3/TRACK-3-STOCK-READY.md`
- T1 就在 main · 无信号

协调 Claude(cron 9afb88dd)每 30 min 扫 · 试 `git merge --no-ff <branch>` + check.sh · 冲突走 MERGE-BLOCKED 文件。

### 9.5 汇合后最终串行

1. observatory(5-6h · non-blocking)
2. 视觉 + stock / market / channels 三组新页的 Linear Precise 微调(~2h)
3. walkthrough-acceptance 全仓 W1-W7(由 T2 铺完的框架跑)
4. v0 tag

### 9.6 一句话

- **T1(main · 当前 Claude)** 继续推 toolset + tasks · 按白名单
- **T2(track-2-qa · 新 Claude)** QA 闸门三件套 + 审计 · 只动测试/脚本
- **T3(track-3-stock · 新 Claude)** 落 3 份新 spec · 严格只新增
