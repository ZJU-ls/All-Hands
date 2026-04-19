# 通知渠道 · `allhands.channels` Spec

**日期** 2026-04-19
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**并列 spec** [2026-04-18-triggers.md](./2026-04-18-triggers.md)(触发源 · 已交付)· [2026-04-19-market-data.md](./2026-04-19-market-data.md)(行情源之一)· [2026-04-19-stock-assistant.md](./2026-04-19-stock-assistant.md)(首个消费者)
**动手前必读** [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · 按本 spec § 10 对照 ref-src(LobeChat plugin channel / Slack incoming webhook / Telegram Bot API shape)

---

## 0 · TL;DR

- 平台级**通知渠道**抽象 · 任何 skill / trigger / agent 都能通过一条 Meta Tool 把消息发出去 · 用户也能通过同一套渠道回话反塞进 chat
- **出站 + 入站对称**:`send(payload, channel_id)` / `parse_inbound(webhook)` · 入站直接命中 `ConversationService` 复用现有 chat loop
- v0 首发:Telegram(双向)· Bark(iOS 单向)· v0 脚手架 stub:企业微信应用 · 飞书 bot · 邮件 · PushDeer
- 扩展约束:**新 channel = 一个 adapter.py + 一行注册** · 和 Tool 一样走"发现式"注册

---

## 1 · 问题陈述

现状:allhands 内部有 agent · trigger · skill · 但没有"对外推送/对外被动接收"的统一抽象。

驱动场景:
- Stock-assistant 监测到持仓股急拉 5% · 需要**秒级**推送到用户手机
- 用户出差不在电脑边 · 想在微信 / Telegram 里直接问 "A股今天怎么样" · agent 回一句
- 任何 skill 都可能需要"离线通知"能力 · 这是平台级基础设施 · 不是某个 skill 的私有

**如果不做** · 每个 skill 自己接 webhook / 自己处理入站消息 → L01 Tool First 违反 · 代码重复 · 渠道扩展要改 N 份代码。

---

## 2 · 原则

### 2.1 channel 是资源 · 不是代码

- Channel 在 DB 里是一行记录(`kind` + `config_json`)· 不是 python class
- 代码里的 `ChannelAdapter` 是**驱动**(driver)· 根据 `kind` 路由到对应 adapter 实例
- 用户加一个新的 Telegram Bot = 新一行 DB 记录 + 走现有 TelegramAdapter · 无需改代码

### 2.2 出入对称

- 出站:`send(channel_id, payload) -> delivery_id`
- 入站:`POST /api/channels/{id}/webhook` → adapter 解析 → 扔进 `ConversationService.handle_inbound_message(channel_id, user_ref, text)` → 走正常 chat loop → 结果走 `send` 回给用户
- 不做半吊子"只出不进" · 因为那就等于 SMS · 失去 agent 交互价值

### 2.3 订阅关系显式

- 不是每条 notification 都广播到所有 channel
- `subscriptions`(channel_id × topic × filter)表决定"哪些消息送到哪个 channel"
- 用户可在 UI 选择:"Telegram 只收 P0 异动 · Bark 收所有 · 邮件只收每日 briefing"

### 2.4 **Meta Tool First**(L01 硬规则)

REST 路由给 UI · Meta Tool 给 Lead Agent · 每一个能力双入口:`send_notification` / `register_channel` / `list_channels` / `update_subscription` / `test_channel` · scope ≥ WRITE 的全部过 `ConfirmationGate`(默认可 auto-approve · 由用户在 channel 配置里选)。

---

## 3 · 数据模型(新增)

### 3.1 `channels` 表(migration 0009)

```sql
CREATE TABLE channels (
  id TEXT PRIMARY KEY,                    -- uuid
  kind TEXT NOT NULL,                     -- 'telegram' | 'bark' | 'wecom' | 'feishu' | 'email' | 'pushdeer'
  display_name TEXT NOT NULL,
  config_json TEXT NOT NULL,              -- adapter-specific (bot_token / chat_id / device_key / ...)
  inbound_enabled BOOLEAN DEFAULT FALSE,
  outbound_enabled BOOLEAN DEFAULT TRUE,
  webhook_secret TEXT,                    -- 入站签名验证用(adapter 不自带签名时)
  auto_approve_outbound BOOLEAN DEFAULT FALSE,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
CREATE INDEX idx_channels_kind ON channels(kind) WHERE enabled;
```

### 3.2 `channel_subscriptions` 表

```sql
CREATE TABLE channel_subscriptions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,                    -- 'stock.anomaly' / 'briefing.daily' / 'agent.task.done' / '*'
  filter_json TEXT,                       -- {"severity": ["P0","P1"], "symbols": ["600519"]} · NULL = 全量
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP
);
CREATE INDEX idx_subs_topic ON channel_subscriptions(topic) WHERE enabled;
```

### 3.3 `channel_messages` 表(审计 + 入站追踪)

```sql
CREATE TABLE channel_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  direction TEXT NOT NULL,                -- 'out' | 'in'
  topic TEXT,                             -- 出站才有
  payload_json TEXT NOT NULL,
  conversation_id TEXT,                   -- 入站命中的会话(或出站的关联会话)
  external_id TEXT,                       -- 第三方返回的 message_id(追踪用)
  status TEXT,                            -- 'pending' | 'delivered' | 'failed' | 'received'
  error_message TEXT,
  created_at TIMESTAMP
);
CREATE INDEX idx_chmsg_channel_time ON channel_messages(channel_id, created_at DESC);
CREATE INDEX idx_chmsg_conv ON channel_messages(conversation_id) WHERE conversation_id IS NOT NULL;
```

### 3.4 `core/channel.py`(Pydantic 域模型)

```python
class ChannelKind(str, Enum):
    TELEGRAM = "telegram"
    BARK = "bark"
    WECOM = "wecom"          # 企业微信应用
    FEISHU = "feishu"        # 飞书 bot
    EMAIL = "email"
    PUSHDEER = "pushdeer"

class NotificationPayload(BaseModel):
    title: str
    body: str                          # markdown allowed
    severity: Literal["info", "warn", "P2", "P1", "P0"] = "info"
    icon: str | None = None            # mono 字符(·/!/‼) · 不用 icon 库
    actions: list[NotificationAction] = []  # {label, url | command}
    meta: dict[str, Any] = {}          # channel-specific passthrough

class InboundMessage(BaseModel):
    channel_id: str
    external_user_ref: str             # Telegram chat_id / 飞书 open_id
    text: str
    received_at: datetime
    raw: dict                          # 原始 payload (debugging)
```

---

## 4 · ChannelAdapter ABC + 实现清单

### 4.1 ABC(`execution/channels/base.py`)

```python
class ChannelAdapter(ABC):
    kind: ClassVar[ChannelKind]

    @abstractmethod
    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        """出站。返回 external_id + 耗时。"""

    async def parse_inbound(self, channel: Channel, headers: dict, body: bytes) -> InboundMessage | None:
        """入站。默认 raise NotImplementedError。不支持入站的 adapter 覆盖。"""
        raise NotSupportedError(...)

    async def verify_signature(self, channel: Channel, headers: dict, body: bytes) -> bool:
        """签名验证。默认用 HMAC + webhook_secret。adapter 有自己签名方案的覆盖。"""

    async def test_connection(self, channel: Channel) -> TestResult:
        """配置联通测试 · UI 注册页按钮调用。"""
```

### 4.2 v0 必做

| kind | 出站 | 入站 | 备注 |
|---|:-:|:-:|---|
| `telegram` | ✓ | ✓ | Bot API · 长轮询或 setWebhook · 首选双向 |
| `bark` | ✓ | ✗ | HTTP GET · 最快 iOS 推送 |

### 4.3 v0 脚手架(只写 ABC 实现 + 标 `NotImplementedError` · 不接真接口)

- `wecom` 企业微信应用(双向 · 国内首选 backup)
- `feishu` 飞书 webhook bot(出站 + 订阅消息回话)
- `email`(出站 · SMTP)
- `pushdeer`(出站 · key 推送)

### 4.4 自注册(execution/channels/__init__.py)

```python
def discover_channel_adapters() -> dict[ChannelKind, ChannelAdapter]:
    from .telegram import TelegramAdapter
    from .bark import BarkAdapter
    # v0 stubs
    from .wecom import WeComAdapter
    from .feishu import FeishuAdapter
    from .email import EmailAdapter
    from .pushdeer import PushDeerAdapter
    return {a.kind: a() for a in [TelegramAdapter, BarkAdapter, WeComAdapter, FeishuAdapter, EmailAdapter, PushDeerAdapter]}
```

---

## 5 · 后端服务 + API

### 5.1 `services/channel_service.py`

```python
class ChannelService:
    async def register(self, kind: ChannelKind, display_name: str, config: dict, ...) -> Channel
    async def list(self, enabled_only: bool = True) -> list[Channel]
    async def get(self, channel_id: str) -> Channel
    async def update(self, channel_id: str, ...) -> Channel
    async def delete(self, channel_id: str) -> None
    async def test(self, channel_id: str) -> TestResult
    async def notify(self, payload: NotificationPayload, topic: str, *, channel_ids: list[str] | None = None) -> list[DeliveryResult]
        # 没传 channel_ids 就按 subscriptions 里匹配 topic 的 channel 广播
    async def handle_inbound(self, channel_id: str, headers: dict, body: bytes) -> InboundMessage
        # verify_signature + parse + 塞 conversation_service
```

### 5.2 REST 路由(`api/routers/channels.py`)

- `GET /api/channels` · list
- `POST /api/channels` · register
- `GET /api/channels/{id}` · get
- `PATCH /api/channels/{id}` · update
- `DELETE /api/channels/{id}` · delete
- `POST /api/channels/{id}/test` · test
- `POST /api/channels/{id}/webhook` · **入站 webhook**(公开 · 按签名验签)
- `GET /api/channels/{id}/subscriptions` / `POST` / `DELETE /{sub_id}`
- `POST /api/notifications/send` · 直接发(UI debug 用 · 也给 skill 没用 Meta Tool 的场景)

---

## 6 · Meta Tools(给 Lead Agent · L01 对称)

`execution/tools/meta/channel_tools.py`

| Tool | scope | gate | 说明 |
|---|---|---|---|
| `list_channels` | READ | no | 列出所有启用渠道 |
| `register_channel` | WRITE | yes | kind + config_json(带敏感 · BOOTSTRAP) |
| `update_channel` | WRITE | yes | |
| `delete_channel` | IRREVERSIBLE | yes | |
| `test_channel` | READ | no | 发测试消息 |
| `send_notification` | WRITE | **per-channel auto_approve_outbound 决定** | 主发送入口 |
| `list_subscriptions` | READ | no | |
| `update_subscription` | WRITE | yes | 动态订阅 |
| `query_channel_history` | READ | no | 按 channel_id / topic 查出入站记录 |

**回归测试**(L01):`test_learnings.py::TestL01ToolFirstBoundary::test_channels_dual_entry` 验证 REST 写操作和 Meta Tool 一一对应。

---

## 7 · 前端(`web/app/channels/page.tsx`)

- 列表视图:kind icon(mono 字符:📨 用 `→`)· 状态灯(连接 / 断线)· 今日出入消息数
- 注册向导:选 kind → 动态表单(基于 adapter 的 `config_schema()`)→ 联通测试 → 保存
- 详情页:最近 100 条 in/out 消息 · subscriptions 管理 · 编辑配置 · 删除
- 设计纪律:Linear Precise 三条律 · 严格 token · 无 icon 库

---

## 8 · 入站 → chat loop 的接线

```
POST /api/channels/{id}/webhook
  → ChannelService.handle_inbound
    → adapter.verify_signature
    → adapter.parse_inbound → InboundMessage
    → channel_messages INSERT(direction=in)
    → ConversationService.find_or_create_by_external_ref(channel_id, external_user_ref)
    → ConversationService.append_user_message(conv_id, text)
    → AgentRunner.run(conv_id)  (异步 · 不阻塞 webhook 响应)
    → 200 OK 返回 webhook

AgentRunner 结束
  → Lead Agent 调 send_notification tool
  → ChannelService.notify(payload, topic='conversation.reply', channel_ids=[same_channel])
  → adapter.send
  → channel_messages INSERT(direction=out · conversation_id 关联)
```

**关键:** 入站会话走与 web 聊天**同一个** `AgentRunner` + `ConversationService` · 一份实现两个入口。

---

## 9 · Trigger 消费(与 Wave B.3 triggers 的对接)

- triggers 表已经有 `action` 字段 · 扩 action type:`send_notification`(payload_template + topic)
- 触发时 trigger engine 走 `ChannelService.notify(rendered_payload, topic)` · 按 subscriptions 广播
- stock-assistant spec 里的"持仓急拉"是一条 trigger + 一条 send_notification action 的组合

---

## 10 · 参考源码(动手前必读)

- `ref-src-claude`:Claude Code 没直接对标 · 但看 `src/tools/Notification.ts`(用户提示 hook)学"payload 结构"
- **LobeChat**(外部):`src/server/modules/[channels]` 的 driver 抽象 · 对称 send/receive · config_json 驱动(我们照抄)
- Slack incoming webhook:signature 验证(`v0:` prefix + HMAC-SHA256 + timestamp)· v0 BarkAdapter 参照
- Telegram Bot API:`sendMessage` + `setWebhook` · 官方 doc

---

## 11 · In-scope / Out-of-scope

### In-scope v0
- `channels` / `channel_subscriptions` / `channel_messages` 三表 + migration 0009
- ChannelAdapter ABC + Telegram + Bark(**真实**)+ 其他 4 个 stub
- `ChannelService` + 9 REST + 9 Meta Tool
- 入站 webhook → conversation loop 闭环
- `web/app/channels` 管理页(注册 / 列表 / 详情 / 订阅)
- trigger 的 `send_notification` action

### Out-of-scope v0(v1 再做)
- 消息模板引擎(现在 payload 里 markdown 即所得)
- 重试 / 死信队列(现在失败就记日志)
- 富媒体(图片/视频附件 · 只支持文本 + 链接)
- 多用户(现在单用户 · external_user_ref 只做一对一匹配)
- 消息加密传输(v1 加 TLS + 端到端可选)

---

## 12 · 测试

- `tests/unit/channels/test_adapter_*.py` · 每个 adapter 的 send/parse/signature 单元测(mock HTTP)
- `tests/integration/test_channel_api.py` · REST + webhook 入站走通
- `tests/integration/test_channel_inbound_to_chat.py` · 入站 webhook → agent 回复 → 出站消息 全链路
- `tests/unit/test_trigger_send_notification.py` · trigger action 解析 + 调用路径
- `tests/unit/test_learnings.py::test_channels_dual_entry` · L01 对称

---

## 13 · DoD checklist

- [ ] migration 0009 · alembic heads 单一
- [ ] 三张表 + Pydantic 域 + service
- [ ] ChannelAdapter ABC + Telegram(真)+ Bark(真)+ 4 个 stub
- [ ] 9 REST 路由 + 9 Meta Tool · L01 对称测试过
- [ ] 入站 webhook → chat loop 闭环(有 integration test 作证)
- [ ] trigger `send_notification` action 可用(integration test)
- [ ] `web/app/channels` 注册/列表/详情/订阅 四屏 · 视觉纪律过
- [ ] 所有测试绿 · ruff / mypy / lint-imports / pnpm lint / typecheck / vitest 零报
- [ ] 手测:注册 Telegram bot → 发一条 → 回一条 → 看到 chat 里被塞

## 14 · Decision-log

- 2026-04-19 · 出入对称不是二选一(Lob 风格)· 单向 channel 只是"入站 raise NotSupportedError"的 adapter · 不开特例
- 2026-04-19 · 订阅用 topic 字符串匹配 + filter_json 补丁 · 不上 CEP 引擎(YAGNI)
- 2026-04-19 · v0 不做模板引擎 · payload 里传 markdown · agent 自己渲染
