"""Meta tools for LLM Provider — mirrors REST routes in routers/providers.py.

L01 扩展版(2026-04-18):独立 UI 页面(/gateway/providers)与 Meta Tool 并存。
Lead Agent 通过对话能做 UI 上能做的每件事:list / get / create / update /
delete / set-default / test-connection。
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

_PROVIDER_ID_REQUIRED: dict[str, object] = {
    "type": "object",
    "properties": {"provider_id": {"type": "string"}},
    "required": ["provider_id"],
}


LIST_PROVIDERS_TOOL = Tool(
    id="allhands.meta.list_providers",
    kind=ToolKind.META,
    name="list_providers",
    description="List all LLM providers configured in the Gateway.",
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_PROVIDER_TOOL = Tool(
    id="allhands.meta.get_provider",
    kind=ToolKind.META,
    name="get_provider",
    description="Get details of a specific LLM provider by id.",
    input_schema=_PROVIDER_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

CREATE_PROVIDER_TOOL = Tool(
    id="allhands.meta.create_provider",
    kind=ToolKind.META,
    name="create_provider",
    description=(
        "Register a new LLM provider. Provide name, base_url, optional api_key, "
        "and kind (openai / anthropic / aliyun — defaults to openai). "
        "After creating the provider, register specific models under it with "
        "create_model, then call set_default_model on whichever model should be "
        "the workspace default."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "kind": {
                "type": "string",
                "enum": ["openai", "anthropic", "aliyun"],
                "default": "openai",
            },
            "base_url": {"type": "string"},
            "api_key": {"type": "string", "default": ""},
        },
        "required": ["name", "base_url"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_PROVIDER_TOOL = Tool(
    id="allhands.meta.update_provider",
    kind=ToolKind.META,
    name="update_provider",
    description="Update an LLM provider's fields by id. Pass only the fields you want to change.",
    input_schema={
        "type": "object",
        "properties": {
            "provider_id": {"type": "string"},
            "name": {"type": "string"},
            "kind": {
                "type": "string",
                "enum": ["openai", "anthropic", "aliyun"],
            },
            "base_url": {"type": "string"},
            "api_key": {"type": "string"},
            "enabled": {"type": "boolean"},
        },
        "required": ["provider_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

LIST_PROVIDER_PRESETS_TOOL = Tool(
    id="allhands.meta.list_provider_presets",
    kind=ToolKind.META,
    name="list_provider_presets",
    description=(
        "List the supported provider kinds (openai / anthropic / aliyun) with their "
        "canonical base_url + default_model presets. Use before calling create_provider "
        "to show the user a format choice and auto-fill base_url."
    ),
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

DELETE_PROVIDER_TOOL = Tool(
    id="allhands.meta.delete_provider",
    kind=ToolKind.META,
    name="delete_provider",
    description="Permanently delete an LLM provider and all models registered under it.",
    input_schema=_PROVIDER_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

TEST_PROVIDER_CONNECTION_TOOL = Tool(
    id="allhands.meta.test_provider_connection",
    kind=ToolKind.META,
    name="test_provider_connection",
    description=(
        "Probe a provider's /models endpoint to verify connectivity. "
        "Returns {ok, endpoint, status} on success or {ok: false, error} on failure."
    ),
    input_schema=_PROVIDER_ID_REQUIRED,
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ALL_PROVIDER_META_TOOLS: list[Tool] = [
    LIST_PROVIDERS_TOOL,
    GET_PROVIDER_TOOL,
    CREATE_PROVIDER_TOOL,
    UPDATE_PROVIDER_TOOL,
    DELETE_PROVIDER_TOOL,
    TEST_PROVIDER_CONNECTION_TOOL,
    LIST_PROVIDER_PRESETS_TOOL,
]
