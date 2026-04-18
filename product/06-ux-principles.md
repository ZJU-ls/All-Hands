# 06 · UX Principles · 用户友好产品设计契约

> **所有 `web/` 面向用户的交互都必须遵守本文件。** 违反的设计会在 review 被打回。
>
> 本文件不是审美指南(那在 [`03-visual-design.md`](03-visual-design.md)),是交互硬规则 —— 页面长什么样可以迭代,用户感受到的流程必须这样。

---

## 核心信念

> **用户是带着目标来的,不是来学我们产品的。** 每个界面问自己:给用户一张白纸让他写出目标,比我这个界面更快吗?如果是,删掉。

---

## 目录

| # | 规则 | 一句话 |
|---|---|---|
| [P01](#p01--对话优先--表单后退) | 对话优先 | 能让用户"说"的就不要让他"填" |
| [P02](#p02--写操作必须过-confirmation-gate) | 确认门 | 任何改变世界的操作必须先给用户看 diff |
| [P03](#p03--长操作必须可观察可取消) | 可观察 | 超过 2s 的操作必须有进度流 + 取消 |
| [P04](#p04--三态必现-加载--空--错) | 三态 | 远程数据组件必须声明 loading / empty / error |
| [P05](#p05--错误消息指向下一步) | 可操作错误 | 报错必须告诉用户下一步怎么办 |
| [P06](#p06--渐进披露) | 默认简洁 | 复杂信息按需展开,不要一屏塞满 |
| [P07](#p07--键盘优先--kbd-chip-显式) | 键盘优先 | 主要操作必须可键盘触发且 UI 告诉用户怎么按 |
| [P08](#p08--反馈延迟分级) | 延迟分级 | <100ms 瞬时感 · <1s 不用 loading · >1s 必出 loading |
| [P09](#p09--跨入口状态一致) | 单一状态源 | 同一对象在所有入口看到的必须是同一份 |
| [P10](#p10--撤销优先于确认) | 撤销为先 | 能撤销就不要弹确认;确认只给真正不可逆的操作 |
| [P11](#p11--好用--能用) | 好用 > 能用 | 功能跑通只是代码级 DoD;产品层必须过一屏决策 / 测试有效性 / 关键数值露出 / 测试态对齐生产态四条 |

---

## P01 · 对话优先 + UI 并存(2026-04-18 修订 · 见 L01 扩展)

**规则** 员工、Skill、MCP、Provider、Model 等资源**允许独立 CRUD 页 + 对话式操作两个入口并存**。但两个入口**必须语义对等** —— UI 能做的每件事,Lead Agent 通过 Meta Tool 也必须能做,反之亦然。

**为什么** 两类用户目标并存:
- 想直观扫一眼 / 批量操作 / 表单精细调 → 独立页更快
- 想"帮我建一个做运营的员工" / "给 Lead Agent 一个 GitHub 地址让他装技能" → 对话更快

产品要 **都做**,不要逼用户二选一。核心:**Lead Agent 要全知全能**(平台上用户能做的,它都能通过 Tool 做)。

**实现强制**
- **一份 service,两个入口**:`services/<resource>_service.py` 是唯一实现;`api/routers/<resource>.py` 暴露给 UI,`execution/tools/meta/<resource>_tools.py` 暴露给 Agent。写业务逻辑**不许**只写一边
- 独立页上的每一个按钮 / 表单提交行为 → 必须有对应 Meta Tool(`test_provider_connection`、`upload_skill_from_zip`、`install_skill_from_github`、`connect_mcp_stdio` 等)
- Meta Tool 走 ConfirmationGate(P02),独立页直调 REST **也**要触发 Gate(不许 UI 绕 Gate)

**UI-only / Tool-only 的例外**
- **Bootstrap 候选版本切换**:UI-only(`/about` 或引导页),初始化不需要对话
- **敏感凭证录入**:UI-only(API key/OAuth token 明文不许进 Agent 上下文)
- **对话消息收发本身**:Tool-only(SSE 流就是 Agent 的输出通道,没意义再开 REST)
- **Confirmation Gate 回执**:UI-only(Gate 是用户护栏,Agent 不参与)

**仍然反例**
- 独立页的"添加 Provider"调 `/api/providers` POST,**但** Meta Tool 里没有 `add_provider` ❌(Agent 不全能了)
- Meta Tool 有 `create_employee` **但** 员工管理页没有"+ 新建"按钮 ❌(强迫对话)
- 两个入口各写一份业务逻辑 ❌(后面必然漂移)
- 独立页写操作**绕过** ConfirmationGate 直连 repo ❌

**如何验证**
- [`backend/tests/unit/test_learnings.py::TestL01ToolFirstBoundary`](../backend/tests/unit/test_learnings.py) 扫 Agent-managed 路由的每个 REST 写操作 → 要求在 `execution/tools/meta/` 里存在同名语义 Meta Tool(成对)
- Code Review 检查:新增 REST 写 endpoint 必须附带对应 Meta Tool;新增 Meta Tool 必须附带 UI 入口(或有明确 Tool-only 理由)

---

## P02 · 写操作必须过 Confirmation Gate

**规则** 任何 Tool `scope >= WRITE` 必须在 UI 上:
1. 展示**可读的** diff(不是 JSON dump),用户能一眼看出改了什么
2. 有清晰的"确认"主 CTA + "取消"次 CTA,视觉权重明显不同
3. `scope = IRREVERSIBLE` 的主 CTA 必须 danger 色,文案写清后果(「此操作不可撤销,将删除 3 个员工和 12 条对话」)

**为什么** Agent 会幻觉、会误操作。不让它背着用户改世界 —— 这是 L4 对话式操作能成立的前提。

**具体要求**
- diff 格式:左右两列 or 行内高亮,而不是 `{"before": {...}, "after": {...}}`
- 确认和取消按钮:主 CTA `bg-primary text-primary-fg`,次 CTA `border-border text-text-muted`,size 一致但颜色权重不同
- 超过 3 个字段的变更要折叠次要字段,默认展示关键差异
- 键盘支持:↵ 确认,Esc 取消

**反例**
- 直接 POST 不出确认弹窗 ❌
- 确认按钮和 × 关闭按钮视觉差太小 ❌
- diff 是 `<pre>{JSON.stringify(diff)}</pre>` ❌

**如何验证** 后端:[`backend/tests/unit/test_gate.py`](../backend/tests/unit/test_gate.py) 强制 `scope >= WRITE` 必走 Gate。前端:Confirmation 页面 review 检查 diff 可读性。

---

## P03 · 长操作必须可观察、可取消

**规则** 任何耗时超过 2s 的操作(LLM 推理、Tool 执行、Trace 回放)必须做到:
1. **≤100ms 内出 loading 状态**(按钮变禁用 + spinner 或 shimmer)
2. **过程中流出 progress/event**(SSE chunk、Tool Call 状态更新),不能静默等待
3. **有取消按钮**(SSE 的 AbortController,后端对应 cancel)

**为什么** Agent run 可能 30s+,用户不能盯着一个转菊花的按钮等,必须感受到"它在动"且有退出门。

**具体要求**
- 对话流:逐 token SSE 输出(已实现,别破坏)
- Tool Call:卡片实时更新 `pending → running → succeeded/failed`(已实现,见 [`components/chat/ToolCallCard.tsx`](../web/components/chat/ToolCallCard.tsx))
- Loading UI 统一走 `ah-pulse` / `ah-shimmer` keyframes([`globals.css`](../web/app/globals.css)),不要每个页面自己画骨架
- Agent run 中断按钮固定在对话输入区右侧,不要藏 3 层菜单

**反例**
- 提交按钮按下后变灰 15s,没有任何中间信号 ❌
- "正在处理..." + 菊花转 30s,用户不知道在哪一步 ❌
- 无法中断的 Agent run ❌

**如何验证** Review 检查:所有 async 按钮必须有 `isLoading` 状态绑定;所有长操作必须有 cancel 入口。

---

## P04 · 三态必现:加载 / 空 / 错

**规则** 任何展示远程数据的组件必须**同时**声明三个状态,缺一打回:

| 状态 | 要求 |
|---|---|
| **Loading** | 骨架屏 or `ah-shimmer`,**不要**显示「Loading...」四个字 |
| **Empty** | 说明"这里会出现什么" + "怎么让它出现"(下一步 CTA) |
| **Error** | 人话错误描述 + error digest(mono 小字) + 重试按钮 |

**为什么** 空白界面 = 最差的界面。用户不知道是坏了、在加载、还是他做错了什么。

**Empty 文案公式**
> 这里还没有 X。对 Lead Agent 说「……」,它会帮你加一个。

不是 `「暂无数据」`。不是空白页。不是一个大大的 illustration emoji。

**反例**
- `{data.map(...)}` 没处理空 ❌
- 接口 500 就让页面空白 ❌
- Empty state 写"暂无数据" ❌
- Loading 写"加载中..." ❌

**如何验证** Review checklist;后续加自动扫描:任何 `fetch(` / `useFetch(` 所在组件必须在同文件里出现 `loading`、`empty`、`error` 三个分支(regex-based,见 [`web/tests/ux-principles.test.ts`](../web/tests/ux-principles.test.ts))。

---

## P05 · 错误消息指向下一步

**规则** 错误消息必须同时包含:
1. **症状**(人话,不要技术词):「连不上服务器」而不是 `FetchError: ECONNREFUSED`
2. **Digest / ID**(mono 小字,方便查 log)
3. **下一步建议**:「稍后重试」或「检查 API key 是否过期」或「联系管理员」
4. **一个具体的 CTA**:重试 / 打开相关配置页 / 复制 digest

**为什么** "Error: Network Error" 对用户是死信号。好的错误消息让用户知道自己能做什么。

**统一组件** [`app/error.tsx`](../web/app/error.tsx) 是 App Router 的默认错误边界;任何业务 `try/catch` 里展示错误一律用 `<ErrorCard>`(待建,复用 error.tsx 的布局),不要每个页面自己写错误 UI。

**反例**
- `alert(err.message)` ❌
- `<pre>{err.stack}</pre>` 扔给用户 ❌
- "未知错误,请重试"(没有下一步信息量) ❌

**如何验证** Review 检查所有 `catch` 块是否走统一组件。

---

## P06 · 渐进披露

**规则** 默认视图只展示关键信息,复杂细节折叠在二级 / 详情里。一屏不许塞超过 **3 层结构** 的信息。

**具体要求**
- **列表**:每行只展示 name + 1 行描述,详情点进去看
- **卡片**:默认折叠 args / result,用户展开才看(ToolCallCard 已是标杆)
- **表格**:超过 4 列要么隐藏非关键列,要么允许用户自选列
- **对话里的 render tool**:默认紧凑卡片,点击进入详情页看全量

**为什么** 密度 ≠ 信息量。一屏 20 个指标 = 用户啥也看不到。

**反例**
- 员工列表把所有 tool_ids / skill_ids JSON 展平显示 ❌
- 一张表默认 15 列全开 ❌
- 所有卡片默认展开 ❌

**如何验证** 设计 review:超过 4 个字段就必须分层或折叠。视觉纪律见 [`03-visual-design.md § 密度`](03-visual-design.md)。

---

## P07 · 键盘优先 + kbd chip 显式

**规则** 每一个**主要操作**(定义:每日高频 / 写操作 / 新建 / 切换)必须:
1. 有键盘快捷键
2. 在 UI 上显示 `<kbd>` chip 告诉用户怎么按(不是藏在帮助文档里)
3. 聚焦态用 `outline: 2px solid var(--color-focus-ring)`,不许关

**必须支持的快捷键**
| 快捷键 | 操作 |
|---|---|
| ⌘+↵ | 发送消息 / 确认表单(已实现) |
| ⌘+K | 全局命令面板 / 新对话 |
| ⌘+B | 切换侧栏 |
| ↑ / ↓ | 列表页上下导航 |
| ↵ | 打开当前项 |
| Esc | 关闭弹窗 / 返回上一层 |
| ⌘+/ | 显示本页所有快捷键 |

**kbd chip 组件** 见 [`design-system/MASTER.md`](../design-system/MASTER.md);一律 `font-mono text-[10px] px-1.5 py-0.5 border border-border rounded text-text-muted`。

**反例**
- 只能鼠标点的"新建对话"按钮 ❌
- 按钮上只有图标/文字,没有 kbd chip ❌
- Tab 焦点看不出来 ❌

**如何验证** 每个页面过一遍:能不能只用键盘走一遍?

---

## P08 · 反馈延迟分级

**规则** 用户操作 → 界面响应的时长分三档,每档有不同要求:

| 档位 | 时长 | 要求 |
|---|---|---|
| **瞬时** | < 100ms | hover、按钮按下、tab 切换 —— 必须**没有延迟感**,动画用 `--dur-fast`(120ms) |
| **短任务** | 100ms – 1s | 本地计算、单次 cached fetch —— 不强制 loading,但不能卡帧 |
| **长任务** | > 1s | Agent run、Tool 执行 —— **≤100ms 内**出 loading,至少每 2s 一个 progress event,>5s 必须有 cancel |

**为什么** 人的耐心是有上限的。Doherty threshold(400ms)内用户感觉"系统跟得上我",超过就会分心。

**动效时长统一使用 token**(禁止硬编码 ms):
- `--dur-fast: 120ms` — hover、小状态切换
- `--dur-base: 180ms` — 展开/折叠
- `--dur-mid: 220ms` — 页面内元素进入
- `--dur-slow: 320ms` — 大区域转场

**反例**
- `transition: all 500ms` ❌(超过 `--dur-slow`)
- Hover 用 `ease-in-out 400ms` ❌(hover 只允许 `--dur-fast`)
- 按钮点完 2s 才变 loading 态 ❌

**如何验证** [`web/tests/error-patterns.test.ts § E10`](../web/tests/error-patterns.test.ts) 已禁硬编码颜色;新增扫 transition-duration 硬编码 → 全部必须走 var(--dur-*)。

---

## P09 · 跨入口状态一致

**规则** 同一个对象(Employee、Conversation、Provider)在任何入口看到的状态必须一致且实时同步:
- Chat 页改了员工名字 → 列表页立刻更新
- 一个 Conversation 被归档 → 所有展示它的位置立刻反映
- Tool 执行完 → Traces 页、Chat 页、Confirmation 页同时刷新

**具体要求**
- **单一状态源**:同一对象只有一个权威源(Zustand store 或 server state),UI 从它派生
- **写操作完成 → 必须 invalidate 相关订阅**,不允许"页面切换后才看到"
- **SSE 是推式真相来源**:Agent run 期间所有相关订阅者接同一个 SSE 流,不要各 page 各 poll

**反例**
- 每个页面各自 fetch,互不通气 ❌
- 员工改名后 Chat 头像上还是旧名(要刷新才变) ❌
- Traces 列表和 Chat 的 Tool Call 状态不一致 ❌

**如何验证** Review 检查:对同一个对象是否存在多份 fetch 源;写操作是否带了完整 invalidation 路径。

---

## P10 · 撤销优先于确认

**规则** 按 `scope` 决定门槛:

| scope | 默认行为 |
|---|---|
| `READ` | 无任何门槛 |
| `WRITE` | **优先做撤销**:立即执行 + 5s toast + "撤销" 按钮;做不到撤销再弹确认 |
| `IRREVERSIBLE` | 必须走 Confirmation Gate(P02),danger CTA |

**为什么** 确认弹窗是"征税",对每次操作都要用户二次判断,磨耗信任。撤销让小错误无代价,是更高级的解法。

**能用撤销的典型场景**
- 删除消息 → 立删 + "已删除,5s 内可撤销" toast
- 归档对话 → 立归档 + 撤销 toast
- 取消订阅某个 Skill → 立改 + 撤销 toast

**必须确认(不能撤销)的典型场景**
- 删除 Employee(带对话和 Trace)
- 删除 Provider(影响所有引用它的 Model)
- 重置系统(BOOTSTRAP 类)

**反例**
- 所有写操作都弹确认 ❌(用户会养成无脑点确认的肌肉记忆)
- 破坏性操作没有确认 ❌
- 撤销 toast 按钮长得像装饰 ❌(必须是 CTA 级别)

**如何验证** 新 Tool 声明 scope 时 review 决策:此操作真的不可逆吗?如果数据库/磁盘/API 状态可以还原,它就是 WRITE,默认走撤销。

---

## P11 · 好用 > 能用(2026-04-18 加入 · 见 L03)

**规则** "功能跑通 + 三态齐 + 深浅主题 过"只是**代码级 DoD**。产品层的 DoD 是"用户觉得**好用**",必须同时满足以下 **4 条子维度**。任一不 pass → **打回去重新设计**,不是改文案、不是"先 ship 再补"。

| 子维度 | 追问 | 典型反例 |
|---|---|---|
| **① 一屏决策** | 用户做一个典型决策,需要的信息能否一屏看全?父对象和它的子对象要不要被迫跨页跳转? | Provider 列表和它下面的 Model 拆成两个页,配了几个模型要点两次 ❌ |
| **② 测试有效性** | 测试 / 预览 / 试跑 按钮测的是**用户最终关心的那件事**,还是平台某个中间层?通过了到底能证明什么? | "测试 Provider 连接"测的是 HTTP 握手,但用户最终调的是**模型**,连接通不代表模型能用 ❌ |
| **③ 关键数值露出** | 结果卡 / 详情抽屉里,**用户下一次决策会用到的数据**是否全部露出了?延迟(p50/p95)/ Token / 成本 / 失败原因 / 思维链等 | 测试结果只有 ✓/✗,用户要自己 curl 才能知道延迟 ❌ |
| **④ 测试态 ≡ 生产态** | 生产里用户能用到的能力(流式输出 / thinking 开关 / temperature / top_p / max_tokens 等),测试态能不能**全部**用上? | 模型对话测试无流式、无 thinking 开关、参数锁死 —— 用户测试里 OK 不等于生产里 OK ❌ |

**为什么**
- **代码层绿是上限**:测试 / lint / 三态齐,证明的是"没坏",不是"好用"。
- **"能用"和"好用"之间隔着一整套设计决策**:页面结构、Tool 语义、数据露出、能力 parity。这些决策一旦 ship 出去,改回来的代价远高于一开始就问对问题。
- **产品感不能靠主观打分**。把"好用"拆成 4 条可问可答的子维度,每条都能拿证据(截图 / 数值 / 配置列表),才能在 review 里被客观打回。

**一屏决策的具体要求**
- 资源的**父 + 其下子**如果在用户心智里是一体的(Provider → 其下的 Models / Skill → 其下的 Tools / Employee → 其下的 Skills),默认**同屏展示**(左右两栏、master-detail、展开行等),不要强迫跳转
- 列表行的默认信息量要够:Name + 1 行描述 + 关键状态(子对象数量 / 最近一次测试结果)
- "查看详情 / 编辑"是二级操作,不是主路径。主路径是**看一屏就知道现在怎么样**

**测试有效性的具体要求**
- 测试按钮的语义层级要等于**用户最终使用动作的最外层语义**。Gateway 的例子:
  - ❌ "测试 Provider 连接" — 测中间层,用户不直接用它
  - ✅ "用这个 Model 发一条 prompt" — 测用户最终会做的事
- Tool 命名直接反映:`test_provider_connection`(弱信号)< `chat_test_model`(强信号)
- 一个测试按钮只测一个断言,不要"连接通了就当模型能用"这种隐式等价

**关键数值露出的具体要求**
- 任何"测试 / 试跑 / 预览"结果至少露出:
  - **延迟**:单次请求的总耗时(ms);多次采样时给 p50 / p95
  - **Token**:prompt tokens / completion tokens / total
  - **成本**:按当前模型定价估算的 USD / CNY
  - **失败原因**:4xx/5xx 的具体 message;超时 vs 拒绝要分开
  - **可选**:首 token 延迟(TTFT)、流式速率(tokens/s)、思维链 token 数(若模型支持 thinking)
- 数值用 mono 字体 + 右对齐,便于对比
- 失败卡要指向下一步(P05),比如"API key 过期 → 去 /gateway/providers/<id> 重配"

**测试态对齐生产态的具体要求**
- 列出该模型/Tool/Skill **生产时用户可配的所有参数**,测试 UI 里要**全部**有对应控件
- 模型对话测试必须:
  - 流式输出(token-by-token,和生产 /chat 页面视觉一致)
  - thinking / reasoning 开关(若模型支持)
  - temperature / top_p / max_tokens / stop sequences 的可调控件
  - system prompt 输入框
  - 多轮对话(不只是 single-shot)
- Skill 测试 / MCP Tool 测试 同理:生产里能传的参数,测试里都要能传

**反例 & 打回范式**
- "我们先上一个简化版测试,后面再补流式" ❌ — 违反 ④,打回
- "Provider 连接测试是第一步,模型测试在详情页" ❌ — 违反 ① + ②,打回
- "测试结果显示 'Success' 就够了,具体数值用户自己去看日志" ❌ — 违反 ③,打回
- "主路径绿了,三态齐了,深浅过了,可以 ship" —— 这只是代码层 ✅,产品层要再过 4 条

**如何验证**
- 阶段 4.5b 验收表格里 4 条子维度各独立一行,每行要拿证据(截图 / 数值 / 配置列表),不能主观断言
- Review 纪律:任何含"测试/预览/试跑"按钮的 PR,reviewer 必须按这 4 条点名问一遍,回答不完整 → 打回
- 设计纪律:plan 的 Task 描述若涉及"测试按钮 / 预览抽屉 / 试跑面板",必须在 Task 内明确 4 条如何满足;不能先写"加一个测试按钮"然后留白
- 对照 [`docs/claude/learnings.md § L03`](../docs/claude/learnings.md) 的 Gateway 案例作为**永久反面教材**

**与其他 P 的关系**
- **与 P01 的关系**:P01 保证"对话 + UI 并存",P11 保证 **UI 本身好用**。P01 绿了不代表 P11 绿
- **与 P04 / P05 的关系**:P04/P05 是每个状态必须有,P11 是"即使三态齐全,结构错了也不行"
- **与 P06 的关系**:P06 是"别塞满",P11 的"一屏决策"是"该看到的要看到" —— 两者共同定义"正确的信息密度"

---

## 每次开发前的 UX 自检(60 秒过一遍)

改任何 `web/` 代码前:

- [ ] 这是写操作吗?过 P02 / P10 了吗
- [ ] 有远程数据吗?Loading / Empty / Error 三态都写了吗(P04)
- [ ] 耗时 > 2s 吗?Loading + cancel + progress 都有吗(P03)
- [ ] 错误消息有下一步建议吗(P05)
- [ ] 想开独立页?先问自己 Lead Agent 能不能接(P01)
- [ ] 主要操作有 kbd chip 吗(P07)
- [ ] 默认视图是不是塞得太满?该折叠吗(P06)
- [ ] 改了对象状态,所有订阅位置会同步吗(P09)
- [ ] 有"测试 / 预览 / 试跑"按钮吗?4 条都过了吗(P11:一屏决策 / 测试有效性 / 关键数值露出 / 测试态≡生产态)

视觉层面的自检清单在 [`design-system/MASTER.md`](../design-system/MASTER.md),和本清单**互补,不重叠**。

---

## 违反的代价

| 违反 | 后果 |
|---|---|
| P01 不走 Lead Agent 开 CRUD 页 | Review 打回,需要 ADR 论证 |
| P02 / P10 写操作不过 Gate / 无撤销 | Review 直接打回(L4 护栏) |
| P04 三态缺失 | Review 打回 |
| P05 错误消息无下一步 | Review 打回 |
| P03 长操作无进度 | Review 打回 |
| P07 / P08 键盘 / 延迟违规 | Issue,下一迭代必须改,不 block merge |
| P06 / P09 密度 / 一致性 | Issue,视严重程度决定是否 block |
| P11 4 条任一不 pass | **Review 打回去重新设计**(不只是改文案),设计本身要回阶段 1 改 plan |

---

## 与其他契约的关系

| 契约 | 管什么 |
|---|---|
| [`00-north-star.md`](00-north-star.md) | 产品哲学 + 4 条核心原则(最高仲裁) |
| [`03-visual-design.md`](03-visual-design.md) | 视觉契约 · Linear Precise(颜色、字体、图标、动效) |
| **`06-ux-principles.md`(本文件)** | **交互契约 · 用户感受到的流程** |
| [`design-system/MASTER.md`](../design-system/MASTER.md) | 组件与 token 速查表(战术层) |
| `web/tests/ux-principles.test.ts` + `web/tests/error-patterns.test.ts` | 本文件的机械可验证子集(回归测试) |

冲突时按「00 → 03 / 06 → MASTER → 测试 assertion」优先级仲裁。
