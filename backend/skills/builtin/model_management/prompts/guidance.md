# 模型管理 · allhands.model_management

## 何时调用

用户说「加 provider」「换模型」「换 API key」「测一下连通」「设默认模型」「跑一下 chat 试一下」 → 这套技能。

## 工作流

1. **先看现状** — `list_providers()` + `list_models()`
2. **加 provider 用 preset** — `list_provider_presets()` 看 OpenAI / Anthropic / 阿里百炼 / OpenRouter 等 · 选一个再 `create_provider`
3. **加完先测连通** — `test_provider_connection(provider_id)` 走 /models 端点 · 不通就改 base_url / api_key
4. **注册 model** — `create_model(provider_id, ref, ...)` · ref 形如 `openai/gpt-4o-mini`
5. **设默认** — `set_default_model(model_id)` · 影响未指定 model_ref 的员工
6. **跑一次确认行为** — `ping_model(model_id)` · 或 `chat_test_model(model_id, prompt)` 看流式 + 延迟 + token

## 工具地图

| 场景 | 用 |
|---|---|
| 看现有 | `list_providers` · `list_models` · `list_provider_presets` |
| 加 provider | `create_provider` |
| 改 provider | `update_provider` |
| 删 provider | `delete_provider`(IRREVERSIBLE) |
| 设默认 model | `set_default_model` |
| 测 provider 连通 | `test_provider_connection` |
| 注册 model | `create_model` |
| 改 / 删 model | `update_model` · `delete_model` |
| ping 延迟 | `ping_model` |
| 跑 chat 看效果 | `chat_test_model` |

## 调用示例

```
# 「加百炼 provider · 用通义千问」
list_provider_presets()                      # 找 dashscope preset
create_provider(
  kind="bailian",
  name="bailian-prod",
  base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
  api_key="sk-..."
)
test_provider_connection(provider_id="prov_xxx")    # 必须 ok
create_model(provider_id="prov_xxx", ref="bailian/qwen3-plus")
chat_test_model(model_id="m_xxx", prompt="你是?")  # 走通
```

## 常见坑

- **`api_key` 显示是 `***set***`** — E21 已打码 · 不要尝试给用户看明文 · 也别把 api_key 拷到 trace
- **base_url 末尾斜杠** — OpenAI-compat 一般 `https://api.x.com/v1`(无尾斜杠)· 错了只在 test 时暴露
- **set_default_model 会同时打开 provider 的 default 开关** — 主动告知用户
- **chat_test_model 长上下文费钱** — 默认 prompt 短即可

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `test_provider_connection` 401 | api_key 错 / 过期 · 让用户重输 |
| `test_provider_connection` 404 | base_url 错 · 检查协议 + 路径 |
| `chat_test_model` 报 "thinking rejected" | 模型不支持 thinking · 切 thinking=False 重试 |
| `create_model` ref 冲突 | 同 provider 下 ref 必须唯一 · 改 ref 或 update 已有 |
| `delete_provider` 卡 "has linked models" | 先 list_models(provider_id) 删干净再 delete |
