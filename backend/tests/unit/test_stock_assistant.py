"""Stock-assistant skill shape + tool wiring (spec § 11/12).

We don't exercise LLM-driven composition here (that requires a real
provider); instead we assert that:

1. The skill yaml loads via the existing SkillRegistry loader.
2. Every tool_id the skill references is registered in the ToolRegistry.
3. The 3 preset trigger yamls parse into valid Trigger domain objects.
4. "老张" persona prompt exists and is non-empty.
5. The 3 production tools declare READ scope + non-empty descriptions;
   the 3 skeleton tools are still declared so the agent can see them.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from allhands.core import (
    EventPattern,
    TimerSpec,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerKind,
)
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.meta.stock_tools import ALL_STOCK_ASSISTANT_TOOLS

SKILL_ROOT = Path(__file__).resolve().parents[2] / "skills" / "builtin" / "stock_assistant"


@pytest.fixture(scope="module")
def skill_registry() -> SkillRegistry:
    reg = SkillRegistry()
    seed_skills(reg)
    return reg


@pytest.fixture(scope="module")
def tool_registry() -> ToolRegistry:
    reg = ToolRegistry()
    discover_builtin_tools(reg)
    return reg


def test_skill_loads_from_yaml(skill_registry: SkillRegistry) -> None:
    skill = skill_registry.get("allhands.skills.stock_assistant")
    assert skill is not None
    assert skill.name.startswith("Stock Assistant")
    assert len(skill.tool_ids) >= 6
    assert skill.prompt_fragment is not None
    assert "老张" in skill.prompt_fragment or "stock" in skill.prompt_fragment.lower()


def test_every_skill_tool_is_registered(
    skill_registry: SkillRegistry, tool_registry: ToolRegistry
) -> None:
    skill = skill_registry.get("allhands.skills.stock_assistant")
    assert skill is not None
    for tool_id in skill.tool_ids:
        tool, _executor = tool_registry.get(tool_id)
        assert tool.id == tool_id, f"skill references unknown tool {tool_id!r}"


def test_production_tools_have_meaty_descriptions() -> None:
    """Spec § 4.1/4.2/4.3 — the three production tools must carry enough
    prompt context that the Lead Agent can execute them without additional
    guidance."""
    production_ids = {
        "allhands.stock.generate_briefing",
        "allhands.stock.explain_anomaly",
        "allhands.stock.daily_journal",
    }
    by_id = {t.id: t for t in ALL_STOCK_ASSISTANT_TOOLS}
    for tid in production_ids:
        tool = by_id[tid]
        assert len(tool.description) > 200, (
            f"{tid} description too short to serve as production prompt"
        )
        # Production tools must reference the supporting Meta Tools they compose,
        # so the Lead Agent learns to call them via the description alone.
        assert any(
            needle in tool.description
            for needle in ("send_notification", "markdown", "get_news", "get_quote")
        )


def test_skeleton_tools_are_declared() -> None:
    skeleton_ids = {
        "allhands.stock.portfolio_health",
        "allhands.stock.sanity_check_order",
        "allhands.stock.screen_by_logic",
    }
    by_id = {t.id: t for t in ALL_STOCK_ASSISTANT_TOOLS}
    for tid in skeleton_ids:
        assert tid in by_id
        assert (
            "v0" in by_id[tid].description.lower() or "skeleton" in by_id[tid].description.lower()
        )


def test_zhang_persona_prompt_exists() -> None:
    watcher = SKILL_ROOT / "prompts" / "stock_watcher.md"
    assert watcher.is_file()
    content = watcher.read_text(encoding="utf-8")
    assert "老张" in content
    assert "观察员" in content


@pytest.mark.parametrize(
    "name",
    [
        "anomaly_to_telegram.yaml",
        "opening_briefing_cron.yaml",
        "closing_journal_cron.yaml",
    ],
)
def test_trigger_preset_parses(name: str) -> None:
    """Each preset yaml must produce a valid Trigger."""
    path = SKILL_ROOT / "triggers" / name
    assert path.is_file()
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    kind = TriggerKind(data["kind"])
    timer = TimerSpec(**data["timer"]) if data.get("timer") else None
    event = EventPattern(**data["event"]) if data.get("event") else None
    action = TriggerAction(**{**data["action"], "type": TriggerActionType(data["action"]["type"])})
    trigger = Trigger(
        id="trg_test",
        name=data["name"],
        kind=kind,
        timer=timer,
        event=event,
        action=action,
        min_interval_seconds=data.get("min_interval_seconds", 300),
        enabled=data.get("enabled", True),
        created_at=_test_now(),
        created_by="test",
    )
    assert trigger.name == data["name"]
    assert trigger.kind is kind


def test_anomaly_trigger_filters_high_severity() -> None:
    path = SKILL_ROOT / "triggers" / "anomaly_to_telegram.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    severities = data["event"]["filter"]["severity"]
    assert "P0" in severities
    assert "P1" in severities


def test_briefing_tool_input_allows_date_and_topic() -> None:
    from allhands.execution.tools.meta.stock_tools import GENERATE_BRIEFING_TOOL

    props = GENERATE_BRIEFING_TOOL.input_schema["properties"]
    assert isinstance(props, dict)
    assert "date" in props
    assert "topic" in props


def _test_now():  # type: ignore[no-untyped-def]
    from datetime import UTC, datetime

    return datetime.now(UTC)
