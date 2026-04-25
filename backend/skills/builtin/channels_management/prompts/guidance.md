# 通知渠道 · 工作流

## 何时调用

用户提到「通知」「Slack」「邮件」「webhook」「告诉我 / 提醒我」 → 先 `list_channels` 看现有,再决定 register / send。

## 典型工作流

1. **盘点** — `list_channels()` 看已有渠道
2. **注册新渠道**(只在没有合适的时候才做)
   - Slack:`register_channel(kind="slack", config={"webhook_url": "...", "default_channel": "#general"})`
   - 邮件:`register_channel(kind="email", config={"smtp_host":..., "smtp_user":..., "smtp_pass":..., "from":...})`
   - 通用 webhook:`register_channel(kind="webhook", config={"url": "..."})`
3. **测连通** — `test_channel(id)` · 失败优先排凭证 / URL
4. **发消息** — `send_notification(channel_id, payload={text, ...})`
   - 也可以 by topic(走 subscriptions 系统):`send_notification(topic="alerts.q1", payload={...})` · 所有订阅了 topic 的渠道都会收到
5. **查发送历史** — `query_channel_history(channel_id, limit=20)` · 看最近 N 条,排「为啥用户没收到」

## 常见坑

- Slack webhook URL 是渠道粒度的 · 同一个 token 别注册 N 次
- 邮件凭证:从 .env 读不到的话会用注册时填的 · 凭证写错只在 test_channel 时暴露
- subscriptions 是「topic → 多 channel 扇出」 · 想一对一直接 send_notification(channel_id=...)
