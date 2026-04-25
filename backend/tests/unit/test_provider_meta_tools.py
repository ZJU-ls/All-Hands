"""Task 1 · Provider Meta Tools — 对齐 REST 路由 providers.py 的每个写入动词。

L01 扩展版(2026-04-18):Agent-managed 资源的每个 UI 写操作必须有对应 Meta Tool。
providers.py 当前有:POST / PATCH / DELETE / POST-set-default / POST-test。
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope


def test_all_provider_meta_tools_exported() -> None:
    from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS

    ids = {t.id for t in ALL_PROVIDER_META_TOOLS}
    assert "allhands.meta.list_providers" in ids
    assert "allhands.meta.get_provider" in ids
    assert "allhands.meta.create_provider" in ids
    assert "allhands.meta.update_provider" in ids
    assert "allhands.meta.delete_provider" in ids
    assert "allhands.meta.test_provider_connection" in ids
    # `set_default_provider` was retired with the 2026-04-25 default-pointer
    # refactor — the workspace default is now a model-level singleton, set
    # via `allhands.meta.set_default_model`. Regression-pin the absence so
    # the tool isn't accidentally re-added under the wrong layer.
    assert "allhands.meta.set_default_provider" not in ids


def test_provider_meta_tools_kind_is_meta() -> None:
    from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS

    for t in ALL_PROVIDER_META_TOOLS:
        assert t.kind == ToolKind.META, f"{t.id} kind must be META"


def test_write_scopes_require_confirmation() -> None:
    from allhands.execution.tools.meta.provider_tools import ALL_PROVIDER_META_TOOLS

    for t in ALL_PROVIDER_META_TOOLS:
        if t.scope in {ToolScope.WRITE, ToolScope.IRREVERSIBLE}:
            assert t.requires_confirmation is True, (
                f"{t.id} scope {t.scope} must set requires_confirmation=True"
            )


def test_delete_tool_is_irreversible() -> None:
    from allhands.execution.tools.meta.provider_tools import DELETE_PROVIDER_TOOL

    assert DELETE_PROVIDER_TOOL.scope == ToolScope.IRREVERSIBLE


def test_read_tools_have_no_required_confirmation() -> None:
    from allhands.execution.tools.meta.provider_tools import (
        LIST_PROVIDERS_TOOL,
        TEST_PROVIDER_CONNECTION_TOOL,
    )

    assert LIST_PROVIDERS_TOOL.scope == ToolScope.READ
    assert LIST_PROVIDERS_TOOL.requires_confirmation is False
    assert TEST_PROVIDER_CONNECTION_TOOL.scope == ToolScope.READ
    assert TEST_PROVIDER_CONNECTION_TOOL.requires_confirmation is False


def test_create_tool_schema_has_required_name() -> None:
    from allhands.execution.tools.meta.provider_tools import CREATE_PROVIDER_TOOL

    schema = CREATE_PROVIDER_TOOL.input_schema
    required = schema.get("required", [])
    assert "name" in required
    assert "base_url" in required


def test_registered_in_discover_builtin_tools() -> None:
    """注册进 ToolRegistry — Lead Agent 才能调用。"""
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)

    registered_ids = {t.id for t in reg.list_all()}
    for tool_id in [
        "allhands.meta.list_providers",
        "allhands.meta.create_provider",
        "allhands.meta.delete_provider",
        "allhands.meta.test_provider_connection",
    ]:
        assert tool_id in registered_ids, (
            f"{tool_id} not registered — add to discover_builtin_tools()"
        )
