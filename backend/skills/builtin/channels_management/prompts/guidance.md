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

## 调用示例

```
# 「把日报推到 Slack 工作区」
register_channel(
  kind="slack",
  display_name="日报频道",
  config={"webhook_url": "https://hooks.slack.com/...", "default_channel": "#daily"}
)
# → channel_id
test_channel(id=channel_id)   # 应该 ok=true · 不通就先排凭证
send_notification(
  channel_id=channel_id,
  payload={"text": "Q1 销售简报已就绪", "link": "https://app/artifacts/abc"}
)
# 之后想看历史
query_channel_history(channel_id=channel_id, limit=5)
```

## 常见坑

- Slack webhook URL 是渠道粒度的 · 同一个 token 别注册 N 次
- 邮件凭证:写错只在 `test_channel` 时暴露 · 创建后立即测一次
- subscriptions 是「topic → 多 channel 扇出」 · 想一对一直接 `send_notification(channel_id=...)`
- payload 里的 link / image_url 必须是 https · 内部 localhost 链接对接收方无效

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `test_channel` ok=false / "401 unauthorized" | webhook URL 失效或邮件凭证错 · 跟用户确认配置 |
| `send_notification` 200 但用户没收到 | Slack 检查 #channel 名拼写 · 邮件检查垃圾箱 / 反垃圾规则 |
| 发出去但格式乱 | payload 里别用 markdown 链接 · Slack 用 `<url|text>` · 邮件用 html_body |
