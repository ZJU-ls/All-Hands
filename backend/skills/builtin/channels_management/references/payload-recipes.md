# Channel Payload Recipes · 各端最佳格式

> `read_skill_file('allhands.channels_management', 'references/payload-recipes.md')` 拉这份 · 直接套。

## Slack(webhook · incoming-webhook 兼容)

最小:
```json
{ "text": "Q1 简报已就绪" }
```

带链接:
```json
{
  "text": "Q1 简报已就绪 <https://app/artifacts/abc|查看>",
  "username": "allhands-bot"
}
```

正式 block 格式(可富文本):
```json
{
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "📊 Q1 销售简报" } },
    { "type": "section", "text": { "type": "mrkdwn",
      "text": "*营收* +18% · *客户* +35\n<https://app/artifacts/abc|查看完整报告>" }},
    { "type": "context", "elements": [
      { "type": "mrkdwn", "text": "由 stock-analyst 自动生成 · 2026-04-25 09:00" }
    ]}
  ]
}
```

**坑**:Slack 的 markdown 链接是 `<url|text>` 不是 `[text](url)`。

---

## 邮件

最小:
```json
{ "subject": "Q1 简报", "text_body": "纯文本内容..." }
```

带 HTML:
```json
{
  "subject": "Q1 销售简报",
  "html_body": "<h1>Q1 销售简报</h1><p>营收 +18%</p><a href='https://...'>详情</a>",
  "text_body": "Q1 销售简报\n营收 +18%\n详情: https://..."
}
```

**坑**:
- 同时给 `html_body` 和 `text_body`,客户端会自动 negotiate · 别只给 html
- subject 不要超 80 字符 · 邮件客户端会截断
- 内嵌图片 base64 占带宽 · 优先用 `<img src=https://...>` 外链

---

## Webhook(通用 POST)

直接转你的 payload:
```json
{
  "event": "report.ready",
  "timestamp": "2026-04-25T09:00:00Z",
  "data": {
    "artifact_id": "art_abc",
    "title": "Q1 销售简报",
    "url": "https://app/artifacts/abc"
  }
}
```

**坑**:对方接口对 `Content-Type` 敏感 · 默认 `application/json` · 个别老接口要 `application/x-www-form-urlencoded`

---

## Topic / Subscription 模式

发到 topic:
```python
send_notification(
  topic="alerts.q1",
  payload={"text": "Q1 关键指标异常 · -12% 跌幅"}
)
```

订阅了 `alerts.q1` 的 channel(可能是多个 — slack + email + webhook)都会收到,各自按上面的格式发。

订阅管理:
```python
update_subscription(
  channel_id=channel_id,
  topics=["alerts.q1", "alerts.global", "report.daily"]
)
```

**坑**:topic 命名约定 `<家族>.<具体>` · 别用空格 / 中文 · 后续的脚本依赖这个匹配规则。
