"""Unit tests · viz-skill render tools.

Each tool:
- has id `allhands.render.*`
- kind RENDER, scope READ, requires_confirmation False
- returns {component, props, interactions} shape
- Tool definitions are frozen pydantic (per core/tool.py)

Also covers the builtin skill loader: `allhands.render` expands to the 10 tools
and carries the guidance.md as prompt_fragment.
"""

from __future__ import annotations

from allhands.core import Employee, ToolKind, ToolScope
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, expand_skills_to_tools, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.render.bar_chart import TOOL as BAR_CHART_TOOL
from allhands.execution.tools.render.bar_chart import execute as bar_chart_exec
from allhands.execution.tools.render.callout import TOOL as CALLOUT_TOOL
from allhands.execution.tools.render.callout import execute as callout_exec
from allhands.execution.tools.render.cards import TOOL as CARDS_TOOL
from allhands.execution.tools.render.cards import execute as cards_exec
from allhands.execution.tools.render.code import TOOL as CODE_TOOL
from allhands.execution.tools.render.code import execute as code_exec
from allhands.execution.tools.render.diff import TOOL as DIFF_TOOL
from allhands.execution.tools.render.diff import execute as diff_exec
from allhands.execution.tools.render.kv import TOOL as KV_TOOL
from allhands.execution.tools.render.kv import execute as kv_exec
from allhands.execution.tools.render.line_chart import TOOL as LINE_CHART_TOOL
from allhands.execution.tools.render.line_chart import execute as line_chart_exec
from allhands.execution.tools.render.link_card import TOOL as LINK_CARD_TOOL
from allhands.execution.tools.render.link_card import execute as link_card_exec
from allhands.execution.tools.render.pie_chart import TOOL as PIE_CHART_TOOL
from allhands.execution.tools.render.pie_chart import execute as pie_chart_exec
from allhands.execution.tools.render.stat import TOOL as STAT_TOOL
from allhands.execution.tools.render.stat import execute as stat_exec
from allhands.execution.tools.render.steps import TOOL as STEPS_TOOL
from allhands.execution.tools.render.steps import execute as steps_exec
from allhands.execution.tools.render.table import TOOL as TABLE_TOOL
from allhands.execution.tools.render.table import execute as table_exec
from allhands.execution.tools.render.timeline import TOOL as TIMELINE_TOOL
from allhands.execution.tools.render.timeline import execute as timeline_exec

ALL_NEW_RENDER_TOOLS = [
    TABLE_TOOL,
    KV_TOOL,
    CARDS_TOOL,
    TIMELINE_TOOL,
    STEPS_TOOL,
    CODE_TOOL,
    DIFF_TOOL,
    CALLOUT_TOOL,
    LINK_CARD_TOOL,
    STAT_TOOL,
    LINE_CHART_TOOL,
    BAR_CHART_TOOL,
    PIE_CHART_TOOL,
]


def test_all_new_render_tools_have_correct_scope_and_kind() -> None:
    for tool in ALL_NEW_RENDER_TOOLS:
        assert tool.id.startswith("allhands.render.")
        assert tool.kind == ToolKind.RENDER
        assert tool.scope == ToolScope.READ
        assert tool.requires_confirmation is False


def test_tool_description_teaches_when_to_use() -> None:
    """Per spec § 10.5: tool description must include 'when/when not to use'."""
    for tool in ALL_NEW_RENDER_TOOLS:
        assert len(tool.description) > 60, f"{tool.id} description too short"
        # Weak but useful heuristic: descriptions advise "Use when" or similar
        lower = tool.description.lower()
        assert "use " in lower, f"{tool.id} description should include usage guidance"


async def test_table_returns_viz_table_payload() -> None:
    out = await table_exec(
        columns=[{"key": "name", "label": "Name"}],
        rows=[{"name": "Alice"}, {"name": "Bob"}],
        caption="Team",
    )
    assert out["component"] == "Viz.Table"
    assert out["props"]["columns"][0]["key"] == "name"
    assert len(out["props"]["rows"]) == 2
    assert out["props"]["caption"] == "Team"


async def test_kv_returns_viz_kv_payload() -> None:
    out = await kv_exec(items=[{"label": "Name", "value": "Alice"}], title="Profile")
    assert out["component"] == "Viz.KV"
    assert out["props"]["title"] == "Profile"


async def test_cards_default_columns_is_3() -> None:
    out = await cards_exec(cards=[{"title": "A", "description": "desc"}])
    assert out["component"] == "Viz.Cards"
    assert out["props"]["columns"] == 3


async def test_timeline_default_layout_is_vertical() -> None:
    out = await timeline_exec(items=[{"title": "Ship", "status": "done"}])
    assert out["component"] == "Viz.Timeline"
    assert out["props"]["layout"] == "vertical"


async def test_steps_accepts_current() -> None:
    out = await steps_exec(
        steps=[
            {"title": "Plan", "status": "done"},
            {"title": "Build", "status": "in_progress"},
        ],
        current=1,
    )
    assert out["component"] == "Viz.Steps"
    assert out["props"]["current"] == 1


async def test_code_returns_copy_interaction() -> None:
    out = await code_exec(code="print(1)", language="python", filename="a.py")
    assert out["component"] == "Viz.Code"
    assert out["props"]["language"] == "python"
    assert out["props"]["filename"] == "a.py"
    # Code block always exposes a Copy affordance
    assert any(i["action"] == "copy_to_clipboard" for i in out["interactions"])


async def test_diff_default_mode_is_unified() -> None:
    out = await diff_exec(before="x", after="y")
    assert out["component"] == "Viz.Diff"
    assert out["props"]["mode"] == "unified"


async def test_callout_kind_passes_through() -> None:
    out = await callout_exec(kind="warn", content="Careful!", title="Heads up")
    assert out["component"] == "Viz.Callout"
    assert out["props"]["kind"] == "warn"
    assert out["props"]["title"] == "Heads up"


async def test_link_card_emits_navigate_interaction() -> None:
    out = await link_card_exec(url="https://example.com", title="Example")
    assert out["component"] == "Viz.LinkCard"
    actions = [i["action"] for i in out["interactions"]]
    assert "navigate" in actions


async def test_stat_returns_viz_stat_payload() -> None:
    out = await stat_exec(
        label="Active runs",
        value=42,
        unit="runs",
        delta={"value": 8, "direction": "up", "tone": "positive"},
        spark=[1.0, 2.0, 3.0, 2.5, 4.0],
        caption="last 24h",
    )
    assert out["component"] == "Viz.Stat"
    assert out["props"]["label"] == "Active runs"
    assert out["props"]["value"] == 42
    assert out["props"]["unit"] == "runs"
    assert out["props"]["delta"]["direction"] == "up"
    assert out["props"]["spark"] == [1.0, 2.0, 3.0, 2.5, 4.0]


async def test_stat_accepts_stringified_delta_and_trend_alias() -> None:
    out = await stat_exec(
        label="今日 Token 消耗",
        value="128450",
        unit="tokens",
        delta='{"value": 12, "trend": "up"}',
    )
    assert out["component"] == "Viz.Stat"
    assert out["props"]["delta"] == {
        "value": 12,
        "direction": "up",
        "tone": "neutral",
    }


async def test_line_chart_passes_series_through() -> None:
    out = await line_chart_exec(
        x=["Mon", "Tue", "Wed"],
        series=[
            {"label": "p50", "values": [120, 140, 130]},
            {"label": "p95", "values": [300, 420, 360]},
        ],
        y_label="ms",
    )
    assert out["component"] == "Viz.LineChart"
    assert out["props"]["x"] == ["Mon", "Tue", "Wed"]
    assert len(out["props"]["series"]) == 2
    assert out["props"]["y_label"] == "ms"


async def test_bar_chart_defaults_to_vertical() -> None:
    out = await bar_chart_exec(
        bars=[{"label": "A", "value": 3}, {"label": "B", "value": 7}],
    )
    assert out["component"] == "Viz.BarChart"
    assert out["props"]["orientation"] == "vertical"


async def test_pie_chart_defaults_to_donut() -> None:
    out = await pie_chart_exec(
        slices=[
            {"label": "OpenAI", "value": 60},
            {"label": "Anthropic", "value": 40},
        ],
    )
    assert out["component"] == "Viz.PieChart"
    assert out["props"]["variant"] == "donut"
    assert len(out["props"]["slices"]) == 2


def test_discover_builtin_tools_registers_all_render_tools() -> None:
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    ids = {t.id for t in registry.list_all()}
    for tool in ALL_NEW_RENDER_TOOLS:
        assert tool.id in ids
    assert "allhands.render.markdown_card" in ids


def test_builtin_render_skill_loads_from_manifest() -> None:
    """seed_skills() reads backend/skills/builtin/render/SKILL.yaml and
    produces a Skill with all viz tool_ids and a non-empty prompt_fragment.
    """
    sr = SkillRegistry()
    seed_skills(sr)
    skill = sr.get("allhands.render")
    assert skill is not None
    assert skill.name
    assert skill.version  # version bumped when tools added; not pinned here
    # Baseline structural tools + 4 chart/stat additions = 14 total
    assert len(skill.tool_ids) == 14
    assert "allhands.render.table" in skill.tool_ids
    assert "allhands.render.line_chart" in skill.tool_ids
    assert "allhands.render.bar_chart" in skill.tool_ids
    assert "allhands.render.pie_chart" in skill.tool_ids
    assert "allhands.render.stat" in skill.tool_ids
    assert skill.prompt_fragment is not None
    assert "allhands.render.table" in skill.prompt_fragment  # guidance mentions tools


def test_expand_skills_merges_render_tools_and_prompt() -> None:
    """Employee with skill_ids=['allhands.render'] gets all render tools +
    the guidance fragment composed into prompt_fragment output."""
    from datetime import UTC, datetime

    tool_registry = ToolRegistry()
    discover_builtin_tools(tool_registry)
    skill_registry = SkillRegistry()
    seed_skills(skill_registry)

    emp = Employee(
        id="e1",
        name="viz-tester",
        description="test",
        system_prompt="base",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[],
        skill_ids=["allhands.render"],
        max_iterations=5,
        created_by="test",
        created_at=datetime.now(UTC),
    )
    tools, fragment = expand_skills_to_tools(emp, skill_registry, tool_registry)
    tool_ids = {t.id for t in tools}
    # All render tools present — baseline + new charts/stat
    for expected in (
        "allhands.render.markdown_card",
        "allhands.render.table",
        "allhands.render.diff",
        "allhands.render.stat",
        "allhands.render.line_chart",
        "allhands.render.bar_chart",
        "allhands.render.pie_chart",
    ):
        assert expected in tool_ids
    # Fragment came from guidance.md
    assert "allhands.render.table" in fragment
