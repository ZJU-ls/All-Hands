"""Lock the 6 new builtin skill packs (2026-04-25 spec)
docs/specs/2026-04-25-progressive-skill-packs.md

What we pin:
- 6 dirs exist with SKILL.yaml + prompts/guidance.md
- yaml has required fields (id / name / description / tool_ids /
  prompt_fragment_file)
- every tool_id in every yaml is registered in the default ToolRegistry
- description ≤ 80 chars (LLM-friendly descriptor budget)
- each prompt fragment is non-empty
- every pack is included in LEAD_EXTRA_SKILL_IDS so Lead picks them up

This is a "structural" test · we don't run the agent · just verify on-disk
shape so silent regressions(yaml typo / ref to dropped tool / forgotten
to wire on Lead) get caught at lint time.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.services.employee_service import LEAD_EXTRA_SKILL_IDS

NEW_PACKS = (
    "triggers_management",
    "channels_management",
    "task_management",
    "market_data",
    "observatory",
    "review_gates",
)

SKILLS_ROOT = Path(__file__).resolve().parents[2] / "skills" / "builtin"


@pytest.fixture(scope="module")
def registered_tool_ids() -> set[str]:
    reg = ToolRegistry()
    discover_builtin_tools(reg)
    return {t.id for t in reg.list_all()}


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_pack_dir_layout(pack: str) -> None:
    pack_dir = SKILLS_ROOT / pack
    assert pack_dir.is_dir(), f"{pack}: directory missing"
    assert (pack_dir / "SKILL.yaml").is_file(), f"{pack}: SKILL.yaml missing"
    assert (pack_dir / "prompts" / "guidance.md").is_file(), f"{pack}: prompts/guidance.md missing"


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_pack_yaml_required_fields(pack: str) -> None:
    data = yaml.safe_load((SKILLS_ROOT / pack / "SKILL.yaml").read_text())
    for field in ("id", "name", "description", "tool_ids", "prompt_fragment_file"):
        assert field in data, f"{pack}: {field} missing in yaml"
    assert isinstance(data["tool_ids"], list)
    assert len(data["tool_ids"]) > 0, f"{pack}: tool_ids empty"


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_pack_description_within_budget(pack: str) -> None:
    """≤ 80 chars · this descriptor goes into every Lead turn's system prompt."""
    data = yaml.safe_load((SKILLS_ROOT / pack / "SKILL.yaml").read_text())
    desc = str(data["description"])
    assert len(desc) <= 80, (
        f"{pack}: description {len(desc)} chars > 80 budget — tighten it. Got: {desc!r}"
    )


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_pack_tool_ids_all_registered(pack: str, registered_tool_ids: set[str]) -> None:
    """Every tool_id in the yaml must point at an actually registered tool —
    catches the bootstrap_now bug (was in yaml, no tool ever registered)."""
    data = yaml.safe_load((SKILLS_ROOT / pack / "SKILL.yaml").read_text())
    missing = [t for t in data["tool_ids"] if t not in registered_tool_ids]
    assert not missing, (
        f"{pack}: yaml references non-registered tool_ids {missing}. "
        f"Either register the tool or drop it from the yaml."
    )


@pytest.mark.parametrize("pack", NEW_PACKS)
def test_pack_prompt_non_empty(pack: str) -> None:
    text = (SKILLS_ROOT / pack / "prompts" / "guidance.md").read_text()
    assert len(text.strip()) > 100, f"{pack}: guidance.md feels stub-empty"


def test_all_new_packs_wired_on_lead() -> None:
    """Each pack must be in LEAD_EXTRA_SKILL_IDS so Lead picks it up at boot."""
    for pack in NEW_PACKS:
        sid = f"allhands.{pack}"
        assert sid in LEAD_EXTRA_SKILL_IDS, (
            f"{sid} declared on disk but not wired into LEAD_EXTRA_SKILL_IDS. "
            f"Add it to allhands/services/employee_service.py."
        )
