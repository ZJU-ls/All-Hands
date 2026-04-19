"""Channel Meta Tools — spec § 6.

Mirror the REST router one-to-one. WRITE/IRREVERSIBLE operations default to
``requires_confirmation=True`` so the gate intercepts them; the ``auto_approve_outbound``
channel flag only affects ``send_notification``.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

LIST_CHANNELS_TOOL = Tool(
    id="allhands.meta.list_channels",
    kind=ToolKind.META,
    name="list_channels",
    description=(
        "List all registered notification channels. Returns id, kind "
        "(telegram|bark|wecom|feishu|email|pushdeer), display_name, enabled, "
        "inbound/outbound flags, and today's message counts."
    ),
    input_schema={
        "type": "object",
        "properties": {"enabled_only": {"type": "boolean", "default": False}},
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

REGISTER_CHANNEL_TOOL = Tool(
    id="allhands.meta.register_channel",
    kind=ToolKind.META,
    name="register_channel",
    description=(
        "Register a new notification channel. `kind` is the adapter "
        "(telegram/bark/wecom/feishu/email/pushdeer). `config` carries the "
        "adapter-specific credentials (e.g. telegram requires bot_token + "
        "chat_id; bark requires device_key). Set `inbound_enabled=true` to "
        "also expose /api/channels/{id}/webhook for user-initiated chats."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["telegram", "bark", "wecom", "feishu", "email", "pushdeer"],
            },
            "display_name": {"type": "string", "minLength": 1, "maxLength": 128},
            "config": {"type": "object"},
            "inbound_enabled": {"type": "boolean", "default": False},
            "outbound_enabled": {"type": "boolean", "default": True},
            "auto_approve_outbound": {"type": "boolean", "default": False},
            "webhook_secret": {"type": "string"},
        },
        "required": ["kind", "display_name", "config"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.BOOTSTRAP,
    requires_confirmation=True,
)

UPDATE_CHANNEL_TOOL = Tool(
    id="allhands.meta.update_channel",
    kind=ToolKind.META,
    name="update_channel",
    description=(
        "Partial update of a channel — pass only the fields you want to "
        "change. Useful for rotating webhook_secret, flipping "
        "auto_approve_outbound, or disabling without deleting."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "channel_id": {"type": "string"},
            "display_name": {"type": "string"},
            "config": {"type": "object"},
            "inbound_enabled": {"type": "boolean"},
            "outbound_enabled": {"type": "boolean"},
            "auto_approve_outbound": {"type": "boolean"},
            "webhook_secret": {"type": "string"},
            "enabled": {"type": "boolean"},
        },
        "required": ["channel_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

DELETE_CHANNEL_TOOL = Tool(
    id="allhands.meta.delete_channel",
    kind=ToolKind.META,
    name="delete_channel",
    description="Permanently delete a channel and cascade its subscriptions and message audit rows.",
    input_schema={
        "type": "object",
        "properties": {"channel_id": {"type": "string"}},
        "required": ["channel_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

TEST_CHANNEL_TOOL = Tool(
    id="allhands.meta.test_channel",
    kind=ToolKind.META,
    name="test_channel",
    description=(
        "Probe a channel's adapter credentials — Telegram hits getMe, Bark "
        "sends a tiny test push. Returns {ok, latency_ms, detail}. Stub "
        "adapters return ok=false with 'NotImplemented'."
    ),
    input_schema={
        "type": "object",
        "properties": {"channel_id": {"type": "string"}},
        "required": ["channel_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

SEND_NOTIFICATION_TOOL = Tool(
    id="allhands.meta.send_notification",
    kind=ToolKind.META,
    name="send_notification",
    description=(
        "Send a notification. Pass `topic` to fan out via matching "
        "subscriptions, or `channel_ids` to force specific recipients. "
        "`payload` carries title + body + severity (info|warn|P2|P1|P0) + "
        "optional actions ([{label,url}]). Per-channel `auto_approve_outbound` "
        "decides whether this particular dispatch still requires confirmation."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "topic": {"type": "string"},
            "payload": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "minLength": 1, "maxLength": 200},
                    "body": {"type": "string"},
                    "severity": {
                        "type": "string",
                        "enum": ["info", "warn", "P2", "P1", "P0"],
                    },
                    "icon": {"type": "string"},
                    "actions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "url": {"type": "string"},
                                "command": {"type": "string"},
                            },
                            "required": ["label"],
                        },
                    },
                    "meta": {"type": "object"},
                },
                "required": ["title"],
            },
            "channel_ids": {"type": "array", "items": {"type": "string"}},
            "conversation_id": {"type": "string"},
        },
        "required": ["topic", "payload"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

LIST_SUBSCRIPTIONS_TOOL = Tool(
    id="allhands.meta.list_subscriptions",
    kind=ToolKind.META,
    name="list_subscriptions",
    description=(
        "List subscriptions — pass `channel_id` for a single channel, or "
        "`topic` to see every channel listening to that topic (or * fans "
        "across all topics)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "channel_id": {"type": "string"},
            "topic": {"type": "string"},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

UPDATE_SUBSCRIPTION_TOOL = Tool(
    id="allhands.meta.update_subscription",
    kind=ToolKind.META,
    name="update_subscription",
    description=(
        "Create/update/delete a channel subscription. Omit `subscription_id` "
        "to create. Pass `enabled=false` to pause without deleting. "
        "`filter` narrows the topic (e.g. {severity: [P0, P1]})."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "subscription_id": {"type": "string"},
            "channel_id": {"type": "string"},
            "topic": {"type": "string"},
            "filter": {"type": "object"},
            "enabled": {"type": "boolean"},
            "delete": {"type": "boolean", "default": False},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

QUERY_CHANNEL_HISTORY_TOOL = Tool(
    id="allhands.meta.query_channel_history",
    kind=ToolKind.META,
    name="query_channel_history",
    description=(
        "Return recent in/out messages for a channel, newest-first. Optional "
        "`direction` (in|out) filter and `limit` (1-200)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "channel_id": {"type": "string"},
            "direction": {"type": "string", "enum": ["in", "out"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
        "required": ["channel_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ALL_CHANNEL_META_TOOLS = [
    LIST_CHANNELS_TOOL,
    REGISTER_CHANNEL_TOOL,
    UPDATE_CHANNEL_TOOL,
    DELETE_CHANNEL_TOOL,
    TEST_CHANNEL_TOOL,
    SEND_NOTIFICATION_TOOL,
    LIST_SUBSCRIPTIONS_TOOL,
    UPDATE_SUBSCRIPTION_TOOL,
    QUERY_CHANNEL_HISTORY_TOOL,
]


__all__ = ["ALL_CHANNEL_META_TOOLS"]
