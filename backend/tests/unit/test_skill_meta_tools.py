"""Task 2 · Skill Meta Tools — 对齐 REST 路由 skills.py 的每个写入动词。

L01 扩展版(2026-04-18):Agent-managed 资源的每个 UI 写操作必须有对应 Meta Tool。
skills.py 暴露:list/get/market/delete/patch/install(github|market|upload)。
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope


def test_all_skill_meta_tools_exported() -> None:
    from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS

    ids = {t.id for t in ALL_SKILL_META_TOOLS}
    assert "allhands.meta.list_skills" in ids
    assert "allhands.meta.get_skill_detail" in ids
    assert "allhands.meta.list_skill_market" in ids
    assert "allhands.meta.preview_skill_market" in ids
    assert "allhands.meta.install_skill_from_github" in ids
    assert "allhands.meta.install_skill_from_market" in ids
    assert "allhands.meta.update_skill" in ids
    assert "allhands.meta.delete_skill" in ids


def test_list_market_has_optional_query_param() -> None:
    from allhands.execution.tools.meta.skill_tools import LIST_SKILL_MARKET_TOOL

    props = LIST_SKILL_MARKET_TOOL.input_schema.get("properties", {})
    assert "query" in props, "list_skill_market must accept optional query filter"
    assert "query" not in LIST_SKILL_MARKET_TOOL.input_schema.get("required", [])


def test_preview_market_tool_requires_slug() -> None:
    from allhands.execution.tools.meta.skill_tools import PREVIEW_SKILL_MARKET_TOOL

    assert PREVIEW_SKILL_MARKET_TOOL.scope.value == "read"
    assert "slug" in PREVIEW_SKILL_MARKET_TOOL.input_schema.get("required", [])


def test_skill_meta_tools_kind_is_meta() -> None:
    from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS

    for t in ALL_SKILL_META_TOOLS:
        assert t.kind == ToolKind.META, f"{t.id} kind must be META"


def test_write_scopes_require_confirmation() -> None:
    from allhands.execution.tools.meta.skill_tools import ALL_SKILL_META_TOOLS

    for t in ALL_SKILL_META_TOOLS:
        if t.scope in {ToolScope.WRITE, ToolScope.IRREVERSIBLE}:
            assert t.requires_confirmation is True, (
                f"{t.id} scope {t.scope} must set requires_confirmation=True"
            )


def test_delete_tool_is_irreversible() -> None:
    from allhands.execution.tools.meta.skill_tools import DELETE_SKILL_TOOL

    assert DELETE_SKILL_TOOL.scope == ToolScope.IRREVERSIBLE


def test_install_tools_require_url_or_slug() -> None:
    from allhands.execution.tools.meta.skill_tools import (
        INSTALL_SKILL_FROM_GITHUB_TOOL,
        INSTALL_SKILL_FROM_MARKET_TOOL,
    )

    gh_required = INSTALL_SKILL_FROM_GITHUB_TOOL.input_schema.get("required", [])
    mk_required = INSTALL_SKILL_FROM_MARKET_TOOL.input_schema.get("required", [])
    assert "url" in gh_required
    assert "slug" in mk_required


def test_read_tools_no_confirmation() -> None:
    from allhands.execution.tools.meta.skill_tools import (
        GET_SKILL_DETAIL_TOOL,
        LIST_SKILL_MARKET_TOOL,
        LIST_SKILLS_TOOL,
    )

    for t in (LIST_SKILLS_TOOL, GET_SKILL_DETAIL_TOOL, LIST_SKILL_MARKET_TOOL):
        assert t.scope == ToolScope.READ
        assert t.requires_confirmation is False


def test_registered_in_discover_builtin_tools() -> None:
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)

    registered_ids = {t.id for t in reg.list_all()}
    for tool_id in [
        "allhands.meta.list_skills",
        "allhands.meta.install_skill_from_github",
        "allhands.meta.install_skill_from_market",
        "allhands.meta.delete_skill",
    ]:
        assert tool_id in registered_ids, (
            f"{tool_id} not registered — add to discover_builtin_tools()"
        )


def test_list_skills_tool_not_duplicated_in_employee_tools() -> None:
    """单一来源:LIST_SKILLS_TOOL 只能在 skill_tools.py 中定义,employee_tools 不能再导出。"""
    from allhands.execution.tools.meta import employee_tools

    assert not hasattr(employee_tools, "LIST_SKILLS_TOOL") or (
        employee_tools.LIST_SKILLS_TOOL  # type: ignore[attr-defined]
        not in employee_tools.ALL_META_TOOLS
    ), "LIST_SKILLS_TOOL 必须从 ALL_META_TOOLS 里移除,归入 ALL_SKILL_META_TOOLS"
