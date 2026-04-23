# 模型管理 · allhands.model_management

管理 LLM Gateway(Provider + 他们下面的 Model)。

## 工具地图

| 场景 | 用这个 |
|---|---|
| 加一个 provider(OpenAI / Anthropic / 阿里百炼 / OpenRouter...) | `list_provider_presets` → `create_provider` |
| 改 provider(换 URL / 改 key / 改 default_model) | `update_provider` |
| 删 provider(连同其 Model 一起删) | `delete_provider`(IRREVERSIBLE · 需确认) |
| 设默认 provider(未指定 model_ref 的员工都用它) | `set_default_provider` |
| 验证 provider 是否联通(/models 端点) | `test_provider_connection` |
| 在一个 provider 下注册具体的 model | `create_model` |
| 改 / 删 model | `update_model` · `delete_model` |
| 给某个 model 跑一次小延迟 ping | `ping_model` |
| 给某个 model 发一条 prompt 看流式回答 + 延迟 / Token / 成本 | `chat_test_model` |

## 工作套路

1. **先 preset 后 create** —— `list_provider_presets` 给用户 base_url / default_model 选单,别凭记忆硬填。
2. **测试优于相信** —— 加完 provider 先 `test_provider_connection`,加完 model 先 `ping_model`,等用户真用起来时不踩 401 / 404。
3. **敏感信息保护** —— 显示 provider 时 `api_key` 已经被打码成 `***set***`(见 E21)· 不要试图绕过这条去给用户看 key 原文。
