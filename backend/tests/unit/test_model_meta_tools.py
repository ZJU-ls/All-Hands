"""Task 1 · Model Meta Tools — 对齐 REST 路由 models.py 的每个写入动词。

L01 扩展版(2026-04-18):models.py 的 POST / PATCH / DELETE / POST-test 都要有同名 Meta Tool。
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope


def test_all_model_meta_tools_exported() -> None:
    from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS

    ids = {t.id for t in ALL_MODEL_META_TOOLS}
    assert "allhands.meta.list_models" in ids
    assert "allhands.meta.get_model" in ids
    assert "allhands.meta.create_model" in ids
    assert "allhands.meta.update_model" in ids
    assert "allhands.meta.delete_model" in ids
    assert "allhands.meta.chat_test_model" in ids


def test_model_meta_tools_kind_is_meta() -> None:
    from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS

    for t in ALL_MODEL_META_TOOLS:
        assert t.kind == ToolKind.META


def test_write_scopes_require_confirmation() -> None:
    from allhands.execution.tools.meta.model_tools import ALL_MODEL_META_TOOLS

    for t in ALL_MODEL_META_TOOLS:
        if t.scope in {ToolScope.WRITE, ToolScope.IRREVERSIBLE}:
            assert t.requires_confirmation is True


def test_delete_is_irreversible() -> None:
    from allhands.execution.tools.meta.model_tools import DELETE_MODEL_TOOL

    assert DELETE_MODEL_TOOL.scope == ToolScope.IRREVERSIBLE


def test_chat_test_is_read() -> None:
    """chat_test 不改状态(只发一次 LLM 请求),算 READ。"""
    from allhands.execution.tools.meta.model_tools import CHAT_TEST_MODEL_TOOL

    assert CHAT_TEST_MODEL_TOOL.scope == ToolScope.READ
    assert CHAT_TEST_MODEL_TOOL.requires_confirmation is False


def test_create_schema_has_required_fields() -> None:
    from allhands.execution.tools.meta.model_tools import CREATE_MODEL_TOOL

    required = CREATE_MODEL_TOOL.input_schema.get("required", [])
    assert "provider_id" in required
    assert "name" in required


def test_registered_in_discover_builtin_tools() -> None:
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)

    registered_ids = {t.id for t in reg.list_all()}
    for tool_id in [
        "allhands.meta.list_models",
        "allhands.meta.create_model",
        "allhands.meta.delete_model",
        "allhands.meta.chat_test_model",
    ]:
        assert tool_id in registered_ids, (
            f"{tool_id} not registered — add to discover_builtin_tools()"
        )
