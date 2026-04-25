"""Meta tools for LLM Model — mirrors REST routes in routers/models.py.

L01 扩展版(2026-04-18):Lead Agent 对话入口 + UI 独立页并存。
models.py 的 list / get / create / update / delete / chat-test 都对应 Meta Tool。
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

_MODEL_ID_REQUIRED: dict[str, object] = {
    "type": "object",
    "properties": {"model_id": {"type": "string"}},
    "required": ["model_id"],
}


LIST_MODELS_TOOL = Tool(
    id="allhands.meta.list_models",
    kind=ToolKind.META,
    name="list_models",
    description=("List LLM models. Pass provider_id to filter to one provider, omit for all."),
    input_schema={
        "type": "object",
        "properties": {"provider_id": {"type": "string"}},
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_MODEL_TOOL = Tool(
    id="allhands.meta.get_model",
    kind=ToolKind.META,
    name="get_model",
    description="Get a specific LLM model by id.",
    input_schema=_MODEL_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

CREATE_MODEL_TOOL = Tool(
    id="allhands.meta.create_model",
    kind=ToolKind.META,
    name="create_model",
    description=(
        "Register a model under a provider. Provide provider_id, the model's "
        "API name (e.g. 'gpt-4o-mini'), optional display_name and context_window."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "provider_id": {"type": "string"},
            "name": {"type": "string"},
            "display_name": {"type": "string", "default": ""},
            "context_window": {"type": "integer", "default": 0},
        },
        "required": ["provider_id", "name"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_MODEL_TOOL = Tool(
    id="allhands.meta.update_model",
    kind=ToolKind.META,
    name="update_model",
    description="Update an LLM model by id. Only passed fields are changed.",
    input_schema={
        "type": "object",
        "properties": {
            "model_id": {"type": "string"},
            "name": {"type": "string"},
            "display_name": {"type": "string"},
            "context_window": {"type": "integer"},
            "enabled": {"type": "boolean"},
        },
        "required": ["model_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

DELETE_MODEL_TOOL = Tool(
    id="allhands.meta.delete_model",
    kind=ToolKind.META,
    name="delete_model",
    description="Permanently remove an LLM model from its provider.",
    input_schema=_MODEL_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

SET_DEFAULT_MODEL_TOOL = Tool(
    id="allhands.meta.set_default_model",
    kind=ToolKind.META,
    name="set_default_model",
    description=(
        "Promote one model to the workspace default — Lead Agent + AI explainer "
        "use this (provider, model) when nothing more specific is pinned. "
        "Atomic: clears the prior default and sets this one in a single "
        "transaction. Replaces the legacy set_default_provider + "
        "update_provider(default_model=...) two-step."
    ),
    input_schema=_MODEL_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

PING_MODEL_TOOL = Tool(
    id="allhands.meta.ping_model",
    kind=ToolKind.META,
    name="ping_model",
    description=(
        "Two-layer health probe. Returns `{endpoint, model_probe, status, "
        "ok, latency_ms, ...}`: endpoint = GET /v1/models reach + auth, "
        "model_probe = minimal chat call (max_tokens=1) classified by "
        "whitelist (only network/auth/model_not_found mark unusable; "
        "400/429/5xx still count as connected). Use before a full chat test."
    ),
    input_schema=_MODEL_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

CHAT_TEST_MODEL_TOOL = Tool(
    id="allhands.meta.chat_test_model",
    kind=ToolKind.META,
    name="chat_test_model",
    description=(
        "Send chat request(s) through (provider, model) and return the reply + "
        "latency + token usage + reasoning text (for thinking models) + "
        "categorized error. Supports multi-turn messages, system prompt, "
        "temperature / top_p / max_tokens, and an enable_thinking toggle for "
        "Qwen3 / DeepSeek-R1 / o1-class reasoning models. Returned metrics "
        "match the Gateway Test UI so results are comparable end-to-end."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "model_id": {"type": "string"},
            "prompt": {
                "type": "string",
                "default": "ping",
                "description": "Simple single-turn shortcut. Ignored if messages[] is provided.",
            },
            "messages": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "role": {"type": "string", "enum": ["system", "user", "assistant"]},
                        "content": {"type": "string"},
                    },
                    "required": ["role", "content"],
                },
                "description": "Multi-turn history. Takes precedence over `prompt`.",
            },
            "system": {"type": "string", "description": "System prompt."},
            "temperature": {"type": "number", "minimum": 0.0, "maximum": 2.0},
            "top_p": {"type": "number", "minimum": 0.0, "maximum": 1.0},
            "max_tokens": {"type": "integer", "minimum": 1, "maximum": 32000},
            "stop": {"type": "array", "items": {"type": "string"}},
            "enable_thinking": {
                "type": "boolean",
                "description": (
                    "Turn on provider-side reasoning (thinking models). Omit "
                    "for provider default. Non-thinking models ignore this field."
                ),
            },
        },
        "required": ["model_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ALL_MODEL_META_TOOLS: list[Tool] = [
    LIST_MODELS_TOOL,
    GET_MODEL_TOOL,
    CREATE_MODEL_TOOL,
    UPDATE_MODEL_TOOL,
    DELETE_MODEL_TOOL,
    SET_DEFAULT_MODEL_TOOL,
    PING_MODEL_TOOL,
    CHAT_TEST_MODEL_TOOL,
]
