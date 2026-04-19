# spec · 多格式 LLM 供应商(Provider Kind)

- **Date:** 2026-04-19
- **Owner:** conductor (this session)
- **Scope:** `backend/core/provider`、`backend/services/*`、`backend/api/routers/providers`、`backend/execution/runner`、`backend/execution/tools/meta/provider_tools`、`backend/alembic/versions`、`web/app/gateway/page.tsx`、`web/components/gateway/ProviderSection.tsx`、`web/lib/protocol.ts`、seed

## 1. 背景

目前 `LLMProvider` 只有 `name / base_url / api_key / default_model`,所有调用统一走 `langchain_openai.ChatOpenAI`(见 [runner.py:81](../../backend/src/allhands/execution/runner.py#L81) 与 [providers.py:150](../../backend/src/allhands/api/routers/providers.py#L150))。因此:

- "Anthropic" 只能通过 OpenRouter 的 OpenAI-compat shim 接入,Prompt Caching / 原生工具调用等 Anthropic 特性拿不到。
- 用户添加供应商时要手动记 base_url、默认模型名,容易填错。
- 没有"格式"这个心智入口,用户不知道同一个 key 能在哪些平台用。

## 2. 目标

1. **支持三种原生格式**:`openai` · `anthropic` · `aliyun`(DashScope compat-mode)。
2. **添加/编辑供应商变简单**:选格式 → base_url 与默认模型自动填好,用户只需输 key。
3. **列表上看得见格式**:每个供应商卡片右侧挂一个 format badge(`OPENAI` / `ANTHROPIC` / `ALIYUN`)。
4. **向后兼容**:已有 provider 行 `kind` 默认 `openai`,不需要重填。
5. **Seed fixture**:首次启动看到 3 种格式各一个 provider(无 key),直观展示格式差异。

## 3. 设计

### 3.1 Provider kind 枚举

```python
# core/provider.py
class LLMProvider(BaseModel):
    id: str
    name: str
    kind: Literal["openai", "anthropic", "aliyun"] = "openai"
    base_url: str
    api_key: str = ""
    default_model: str = "gpt-4o-mini"
    is_default: bool = False
    enabled: bool = True
```

**命名:** `kind`(保持项目内一致风格 · 见 `tools/base.py` 的 `ToolKind`)。

### 3.2 格式 preset 注册表

新增 `backend/src/allhands/core/provider_presets.py`(纯数据,无外部依赖):

```python
@dataclass(frozen=True)
class ProviderKindPreset:
    kind: Literal["openai", "anthropic", "aliyun"]
    label: str                      # 中文标签 · UI 下拉显示
    base_url: str
    default_model: str
    key_hint: str                   # placeholder · "sk-..." / "sk-ant-..." / "sk-..."
    doc_hint: str                   # 一句话说明 · 如 "Anthropic Messages API(x-api-key 鉴权)"

PROVIDER_PRESETS = {
    "openai":    ProviderKindPreset(kind="openai",    label="OpenAI 兼容",   base_url="https://api.openai.com/v1",                         default_model="gpt-4o-mini",              key_hint="sk-...", doc_hint="OpenAI / OpenRouter / DeepSeek / Ollama / vLLM — Authorization: Bearer"),
    "anthropic": ProviderKindPreset(kind="anthropic", label="Anthropic",     base_url="https://api.anthropic.com",                         default_model="claude-3-5-sonnet-latest", key_hint="sk-ant-...", doc_hint="Anthropic Messages API — x-api-key + anthropic-version"),
    "aliyun":    ProviderKindPreset(kind="aliyun",    label="阿里云(百炼)", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1", default_model="qwen-plus",                key_hint="sk-...", doc_hint="DashScope compatible-mode — OpenAI 兼容 wire"),
}
```

前端通过 `GET /api/providers/presets` 拉同一份数据(单一真源),UI 下拉直接渲染。

### 3.3 Factory dispatch

`execution/runner.py` 与 `api/routers/providers.py` 各自把"建 LLM"抽到一个模块级工厂:

```python
# backend/src/allhands/execution/llm_factory.py
def build_llm(provider: LLMProvider, model_name: str) -> BaseChatModel:
    if provider.kind == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_name,
            api_key=provider.api_key,
            base_url=provider.base_url or None,
        )
    # openai + aliyun 都走 OpenAI-compat wire
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model_name,
        api_key=provider.api_key or "dummy",
        base_url=provider.base_url or None,
    )
```

**Ping** 分支:openai + aliyun 走 `{base_url}/models` + `Authorization: Bearer`;anthropic 走 `{base_url}/v1/models` + `x-api-key` + `anthropic-version: 2023-06-01`。失败回退到 `build_llm().ainvoke([ping])` 统一成功路径。

### 3.4 REST 契约

- `GET /api/providers` → Response 新增 `kind: str`。
- `POST /api/providers` → Body 新增 `kind: Literal[...] = "openai"`。
- `PATCH /api/providers/:id` → Body 新增 `kind?: Literal[...]`。
- `GET /api/providers/presets` → **新端点**,返回 `PROVIDER_PRESETS.values()` 的 JSON。

### 3.5 Meta Tool(L01 · Tool-First 对称)

`create_provider` / `update_provider` 的 `input_schema` 加 `kind` 属性(enum = openai / anthropic / aliyun · default = openai)。
`list_providers` 返回的每条也带 `kind`。
新增 **`list_provider_presets`** meta tool(`scope=READ`),让 Lead Agent 对话时能查格式列表。

### 3.6 Frontend UX

**添加/编辑对话框** 改造(`app/gateway/page.tsx` 的 `ProviderFormDialog`):

```
┌ 添加 LLM 供应商 ────────────────┐
│ 格式  [OpenAI 兼容        ▾]    │ ← 新增,置顶
│       (OpenAI / OpenRouter ...) │ ← 副文本 = preset.doc_hint
│ 名称  [My OpenAI           ]    │
│ Base URL  [https://api.openai.com/v1]  ← 切格式即 preset.base_url
│ API Key   [sk-...          ]          ← placeholder = preset.key_hint
│ 默认模型  [gpt-4o-mini     ]          ← 切格式即 preset.default_model
│ ☐ 设为默认供应商                │
│                    取消  保存   │
└─────────────────────────────────┘
```

切换格式时,**只覆盖与当前 preset 一致的字段**(避免抹掉用户已编辑过的 base_url)。编辑已有 provider 时,kind 只读(换 kind 相当于新建,产品复杂度收敛)。

**供应商卡片** (`ProviderSection.tsx`) — 在 DotGridAvatar 和 name 之间加 format badge:

```tsx
<span className="text-[10px] font-mono px-1.5 rounded bg-surface-2 text-text-muted border border-border">
  {provider.kind.toUpperCase()}
</span>
```

**avatar initial** 用 `initialFromName(preset.label)` → "OA" / "AN" / "AL"。这样即使 3 个供应商都叫 "My xxx",头像也能区分格式。

### 3.7 Migration

`alembic/versions/0003_add_provider_kind.py`:

```python
op.add_column(
    "llm_providers",
    sa.Column("kind", sa.String(32), nullable=False, server_default="openai"),
)
```

SQLite alembic 对 `add_column` 友好(不需要 batch_alter_table)。

### 3.8 Seed

替换 `bootstrap_service.py::GATEWAY_SEED_PRESETS` 为 3 条(每格式各一):

- "OpenAI"(kind=openai,默认 gpt-4o-mini,2 条模型)
- "Anthropic"(kind=anthropic,默认 claude-3-5-sonnet-latest,2 条模型)
- "阿里云 百炼"(kind=aliyun,默认 qwen-plus,3 条模型)

全部 `api_key=""`,用户需要填 key。

## 4. 参考源码

> **对标项**:LangChain 的多格式 `BaseChatModel` 工厂(`langchain_openai.ChatOpenAI` / `langchain_anthropic.ChatAnthropic`)— 两者实现同一 `invoke/astream` 接口,所以我们上层 AgentRunner / Ping 代码只需要一次分派,之后的流式/错误路径不变。

## 5. DoD

- [ ] `pnpm build` + `uv run ruff check .` + `uv run mypy src` + `uv run pytest` 全绿(`./scripts/check.sh`)
- [ ] 迁移跑得通:`uv run alembic upgrade head` 在现有 app.db 上加 `kind` 列无报错
- [ ] 浏览器验收:打开 /gateway 看到 3 种格式的 seed provider,每个带 format badge;打开添加供应商对话框,切换格式 → base_url / default_model 自动换
- [ ] Anthropic kind 的 ping 用对 header(`x-api-key`)— 即便无 key 也应返回 401 而非 Bearer 错误
- [ ] Seed 幂等:重跑 `uv run allhands-seed dev` 不重复插入

## 6. 不做

- 不做 Gemini / Bedrock 适配(用户未要求,实际需求低)。
- 不做 kind 变更:编辑 provider 时 kind 只读,换格式等于新建。
- 不做 Anthropic 专属特性(Prompt Caching / Extended Thinking)— 留给后续 spec。
- 不改模型级 format 覆盖:模型沿用 provider 的 kind,不支持单模型 override。

## 7. 风险

- `langchain-anthropic` 新增依赖,`pyproject.toml` + `uv lock` 要重跑。
- 旧 Bailian seed 名字被替换,已经改过 provider 名的用户 idempotent 失效;但因为 seed 判空才跑,影响限于从未添加任何 provider 的首次用户。
