# Track K · /gateway 单页嵌套展开 · 设计笔记(阶段 1 交付)

> 目的:在动代码之前,把视觉形态、状态机、按钮行为、可用 token 都对齐到 `design-system/MASTER.md` 的既有组件上。用户过一眼即 OK,就进入阶段 2(TDD 后端 ping endpoint)。

---

## 1. 当前形态(before)

`web/app/gateway/page.tsx`(853 行)= master/detail:

```
┌─ ProviderTabs (横向 tab 条,底部 2px primary 激活线)────────────────────┐
│  [ 百炼·默认 ●✓ ]  OpenRouter ●  DeepSeek ○   ... + 新增             │
├─────────────────────────────────────────────────────────────────────────┤
│  ProviderDetail(max-w-3xl 居中)                                        │
│  ─ 百炼  [默认]                                                         │
│    https://dashscope.aliyuncs.com/compatible-mode/v1                    │
│    API Key: 已设置 · 默认模型: qwen3.6-plus                              │
│    [连通性测试] [设为默认] [删除供应商]                                   │
│    ┌ 模型 (4) ─────────────────────────── + 注册模型 ┐                   │
│    │ ▢ qwen3.6-plus   ctx=131072   [对话测试][删除] │                    │
│    │ ▢ qwen-max-latest ...                         │                   │
│    └─────────────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

痛点:要看第 2 个 provider 的 model 名字,要先点 tab 切换。产品评审想**一屏全貌**。

截图:`plans/screenshots/i0019-before.png`(阶段 1 结束前截,留作基线)。

---

## 2. 目标形态(after)

### 2.1 整体结构 · 单页 accordion

外层去掉 ProviderTabs,改成**纯垂直 accordion**:

```
┌ AppShell(title="模型网关", actions=[+ 添加供应商])──────────────────────┐
│                                                                         │
│  ▾ 百炼  ●已启用 · 默认 · 4 models · default=qwen3.6-plus               │
│     │    https://dashscope.aliyuncs.com/compatible-mode/v1              │
│     │    [连通性测试] [设为默认] [编辑] [删除]                           │
│     │                                                                   │
│     │   ┌── models ─────────────────────────────────────────────────┐   │
│     │   │ qwen3.6-plus         ctx=131072   ●就绪             [ping] [对话] [⋯] │
│     │   │ qwen-max-latest      ctx=32768    ✓  1240ms         [ping] [对话] [⋯] │
│     │   │ qwen-plus-2024-09-19 ctx=131072   ✗ 401 · 认证失败  [ping] [对话] [⋯] │
│     │   │ qwen-turbo           ctx=131072   ○                  [ping] [对话] [⋯] │
│     │   │ + 注册模型                                                     │
│     │   └────────────────────────────────────────────────────────────┘   │
│     ┘                                                                    │
│  ▸ OpenRouter  ●已启用 · 2 models  [连通性测试] [编辑]                    │
│  ▸ DeepSeek   ○已禁用 · 1 model   [启用] [编辑]                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- `▾` / `▸` = disclosure 三角,mono 字符(MASTER.md §3.3 "方向 / 流向 · mono 字符"),不引入 icon
- 每个 provider 是一个 `<ProviderSection>`(新组件),**默认全部展开**
- 折叠后留头部一行(provider 名 · 状态点 · meta · action 按钮)
- 展开态:provider 下面跟一个"1px 左竖线缩进的 model 列表"(Linear Precise 标志)

### 2.2 ProviderSection 头部规格

```tsx
<header className="flex items-center gap-2 px-3 py-2 border-b border-border">
  <button aria-expanded={open} onClick={toggle}
          className="font-mono text-text-muted hover:text-text w-4 text-center">
    {open ? "▾" : "▸"}
  </button>
  <span className="text-sm font-medium text-text">{provider.name}</span>
  {/* 状态点 */}
  <span aria-hidden className={`w-[7px] h-[7px] rounded-full
        ${provider.enabled ? "bg-success" : "bg-border"}`} />
  {provider.is_default && <Badge variant="primary">默认</Badge>}
  <span className="text-[11px] text-text-muted">
    {providerModels.length} models · default={provider.default_model}
  </span>
  {/* actions 靠右 */}
  <div className="ml-auto flex items-center gap-1.5">
    <GhostBtn onClick={onBulkPing}>连通性测试</GhostBtn>
    {!provider.is_default && <GhostBtn onClick={onSetDefault}>设为默认</GhostBtn>}
    <GhostBtn onClick={onEdit}>编辑</GhostBtn>
    <DangerBtn onClick={onDelete}>删除</DangerBtn>
  </div>
</header>
```

- 头部不用大卡片,整行 `py-2` 紧凑布局
- hover 全行变 `bg-surface-2`(低强度)表示"可点"
- 点击 disclosure 三角或空白区都可折叠/展开(鼠标覆盖区域 = 整行,除去 action 按钮区)

### 2.3 ModelRow 规格

```tsx
<div className="group flex items-center gap-3 pl-6 pr-3 py-1.5 border-l border-border ml-6 hover:bg-surface-2 transition-colors duration-150">
  <span className="text-sm text-text font-medium truncate">{m.display_name || m.name}</span>
  <span className="font-mono text-[11px] text-text-subtle truncate">{m.name}</span>
  {m.context_window > 0 && (
    <span className="font-mono text-[10px] text-text-muted">ctx={m.context_window.toLocaleString()}</span>
  )}

  {/* 行内 ping 结果 · 状态机 */}
  <PingIndicator state={pingState} />

  {/* actions 靠右 */}
  <div className="ml-auto flex items-center gap-1">
    <GhostBtn onClick={onPing} disabled={pingState.status === "running"}>
      ping
    </GhostBtn>
    <GhostBtn onClick={onChatTest}>对话</GhostBtn>
    <GhostBtn onClick={onDelete} danger>删除</GhostBtn>
  </div>
</div>
```

- `ml-6` + `border-l` 给 model 列表一条 Linear Precise 左竖线,视觉上与 provider 头部缩进分离
- `py-1.5` 行密度紧凑(和 /models 列表对齐)
- ping 按钮是**文字 link 样式**(不用 Kbd chip ——chip 语义是"快捷键提示",这里是 action),复用 MASTER.md §2.3 Ghost 按钮模板,加 `disabled` 态

### 2.4 PingIndicator 状态机

| 状态 | 视觉 |
|---|---|
| `idle`(未跑过) | `<span className="w-[7px] h-[7px] rounded-full bg-border" aria-hidden/>`(灰静点) |
| `running` | 7px × 7px spinner(MASTER.md §2.12,borderTopColor=currentColor)· `text-text-muted 运行中` |
| `ok` | `bg-success` 脉动状态点(§2.11 · `ah-pulse`)· `font-mono text-[11px] text-success ✓ {latency}ms` |
| `fail` | `bg-danger` 静态点 · `font-mono text-[11px] text-danger ✗ {category}` · hover tooltip 显示完整 error text |

**成功/失败的状态点完全用 token 色 + 尺寸一致**,不借用任何 icon 库(L03 · MASTER.md §3)。

### 2.5 "批量 ping 该 provider 所有 model"

ProviderSection 头部的 `[连通性测试]` 按钮:
- 点击 → 并发跑该 provider 下所有 enabled model 的 `POST /api/models/{id}/ping`
- 按钮 label 动态:`连通性测试` → `测试中 (2/4)` → `连通性测试`
- 结果落到每一行的 PingIndicator(复用同一份状态)
- 不新开 modal · 不新开 toast · 结果就地展现

---

## 3. 触发对话测试 · 复用 ModelTestDialog(不动)

点 `[对话]` → `setChatModel(model)` → 原样打开 `<ModelTestDialog model onClose/>`。

Track K **不改** `web/components/gateway/ModelTestDialog.tsx` 和 `web/lib/stream-client.ts` —— 那是 Track J 的范围。Track K 只是它的**消费者**。

Track J 合并后 dialog 自然升级成 AG-UI 流式,Track K 视觉与 prop 契约不变。

---

## 4. 颜色 / token 自检(MASTER.md §0)

- [x] 不装 Lucide / Heroicons · 仅 mono 字符 (`▸ ▾ ✓ ✗`) + 自有 icon 集(不需要新 icon)
- [x] 不写 `bg-blue-500` / `text-zinc-*` / 十六进制 · 全用 `bg-bg` `bg-surface` `bg-surface-2` `text-text` `text-text-muted` `text-text-subtle` `border-border` `bg-primary` `bg-success` `bg-danger`
- [x] 激活/展开态**不**用背景色高亮 · 用 `▸/▾` 字符 + 1px 左竖线
- [x] `transition-colors duration-150` · 无 scale / shadow / bounce
- [x] 状态点一律 7px 圆点(§2.11)

**颜色密度核算**(CLAUDE.md §3.5 · ≤ 3):
- `bg-bg`(页面底)
- `bg-surface`(provider 块底 / hover 态 bg-surface-2)
- `bg-primary`(仅 CTA 如"添加供应商"按钮)
- 语义色 `success` / `danger`(状态点 · 不计入密度)

✅ 合规。

---

## 5. 交互细节 · UX 原则(product/06-ux-principles.md)

- **P01 Zero state is a tutorial**:空状态(0 provider)保留当前的"添加第一个供应商 →"大 CTA,移到 accordion 顶部
- **P02 Progressive disclosure**:accordion 默认全开 · 用户显式折叠后 localStorage 记 `gateway_collapsed_providers: string[]`(V2 再做)· 本期不做持久化,刷新重置
- **P05 Show latency honestly**:ping 用 `performance.now()` 前端计时 + 后端返 `latency_ms` · UI 显示前端数值(含网络 RTT)· 这和 provider-level [连通性测试] 保持一致
- **P07 Errors are first-class**:失败态行内展示 `category + 简短 msg`,hover tooltip 完整 error text;**不弹 modal 打断**

---

## 6. 不做的事(scope 守门)

- ❌ 不做折叠状态持久化(localStorage)· 下个迭代
- ❌ 不做 model 排序/搜索 · 下个迭代
- ❌ 不改 provider/model 的 CRUD form(ProviderFormDialog / ModelFormDialog 原样留)
- ❌ 不改 ModelTestDialog 内部 · 只作为 consumer
- ❌ 不改 /api/providers/{id}/test(provider-level 端点健康检查)· 只新加 /api/models/{id}/ping
- ❌ 不改 stream-client.ts · 不改 AG-UI 协议(Track J)

---

## 7. 文件清单(预估)

### 新增
- `web/components/gateway/ProviderSection.tsx`(~120 行)
- `web/components/gateway/ModelRow.tsx`(~100 行)
- `web/components/gateway/PingIndicator.tsx`(~40 行)
- `backend/tests/integration/test_model_ping_endpoint.py`
- `backend/tests/unit/test_ping_model_meta_tool.py`
- `web/tests/e2e/gateway-nested.spec.ts`
- `plans/screenshots/i0019-{before,after,ping-ok,ping-fail}.png`

### 修改
- `web/app/gateway/page.tsx`(853 → ~300 行 · 拆分 + accordion 化)
- `backend/src/allhands/api/routers/models.py`(+ `POST /{id}/ping`)
- `backend/src/allhands/execution/tools/meta/model_tools.py`(+ `PING_MODEL_TOOL`)
- `backend/src/allhands/services/bootstrap_service.py`(+ `ensure_gateway_demo_seeds()`)
- `backend/tests/unit/test_learnings.py`(如需要更新白名单)

### 不动
- `web/components/gateway/ModelTestDialog.tsx`(Track J)
- `web/lib/stream-client.ts`(Track J)
- `backend/src/allhands/services/model_service.py`(复用 `run_chat_test`)

---

## 8. 风险 / 未解

1. **端口**:prompt 要求 backend 8010 · web 3010,需确认 docker-compose / dev 启动脚本是否支持;若否,先用默认 8000/3000 跑 e2e,并在 TRACK-K-DONE 记录
2. **seed 数据真实 API key**:`.env.example` 只给 `ALLHANDS_DASHSCOPE_API_KEY`,OpenRouter / DeepSeek 的 key 未在 env 暴露;**seed 只写 base_url + model name,api_key 留空**,由用户在 UI 里补 · ping 未设 key 时直接返 `ok=false · category=auth`,这也是 demo 的正确路径
3. **L01 白名单**:`models.py` 已在 AGENT_MANAGED_ROUTERS 且 meta tool 已有 `model_tools.py`,新加 `PING_MODEL_TOOL` 不动白名单;除非测试有 per-endpoint 检查(当前是 resource-level,OK)
4. **i18n**:UI 文案沿用现有中文(`连通性测试` / `对话` / `删除`)· 不新增

---

## 9. 待用户一眼确认

- [ ] accordion 形态 · 默认全开 · 1px 左竖线缩进 → **OK?**
- [ ] ping 是**文字 link 样式**而非 Kbd chip → **OK?**
- [ ] ping 结果行内展示(7px 圆点 + mono latency/error)· 失败走 tooltip 而非 modal → **OK?**
- [ ] provider 头部 `[连通性测试]` 变成"批量该 provider 下全部 model"语义 → **OK?**
- [ ] Track J 的 ModelTestDialog 不改 · 只当 consumer → **OK?**

用户说 "go" 即进入阶段 2:后端 TDD `POST /api/models/{id}/ping` + `ping_model` meta tool。
