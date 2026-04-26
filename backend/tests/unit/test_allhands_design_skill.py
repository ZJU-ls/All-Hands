"""Smoke for the allhands.design skill (2026-04-27 round-22).

Pins the structure / contents the LLM is going to load via
`read_skill_file('allhands.design', '<path>')` so future refactors don't
silently break the skill's reference templates.
"""

from __future__ import annotations

from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).resolve().parents[2] / "skills" / "builtin" / "allhands-design"


def test_skill_yaml_loads_with_expected_tools() -> None:
    import yaml

    data = yaml.safe_load((SKILL_ROOT / "SKILL.yaml").read_text(encoding="utf-8"))
    assert data["id"] == "allhands.design"
    # version > 0 + builtin true
    assert data["version"] == "1.0.0"
    assert data["builtin"] is True
    expected_tools = {
        "allhands.artifacts.create",
        "allhands.artifacts.render_drawio",
        "allhands.artifacts.create_pptx",
        "allhands.artifacts.create_pdf",
        "allhands.meta.read_skill_file",
    }
    assert expected_tools == set(data["tool_ids"])


@pytest.mark.parametrize(
    "rel_path",
    [
        "references/html-base.html",
        "references/landing.html",
        "references/dashboard.html",
        "references/poster.html",
        "references/pptx-deck.md",
        "references/components.md",
        "references/tokens.md",
        "templates/drawio/brand-flow.xml",
    ],
)
def test_reference_file_exists_and_nonempty(rel_path: str) -> None:
    p = SKILL_ROOT / rel_path
    assert p.is_file(), f"missing reference file {rel_path}"
    body = p.read_text(encoding="utf-8")
    # All templates / references should be non-trivial (≥ 200 bytes).
    assert len(body) > 200, f"{rel_path} suspiciously short ({len(body)} bytes)"


def test_html_templates_carry_brand_signature_tokens() -> None:
    """Every HTML template must use:
    - prefers-color-scheme: dark (auto-adaptive)
    - var(--primary) / var(--text) (tokenised colors, no hardcoded hex everywhere)
    - linear-gradient(...primary...) (gradient signature)
    """
    for rel in (
        "references/html-base.html",
        "references/landing.html",
        "references/dashboard.html",
    ):
        body = (SKILL_ROOT / rel).read_text(encoding="utf-8")
        assert "prefers-color-scheme: dark" in body, f"{rel}: missing dark mode block"
        assert "var(--primary)" in body, f"{rel}: missing var(--primary) usage"
        assert "linear-gradient" in body, f"{rel}: missing gradient signature"


def test_drawio_template_carries_brand_palette_and_shadow() -> None:
    body = (SKILL_ROOT / "templates" / "drawio" / "brand-flow.xml").read_text(encoding="utf-8")
    # primary blue (#0A5BFF) for entry node, shadow=1 on every cell.
    assert "#0A5BFF" in body
    assert "shadow=1" in body
    # Both rounded=1 (vertex) and at least one rhombus (decision).
    assert "rounded=1" in body
    assert "rhombus" in body


def test_skill_loads_via_discover_path() -> None:
    """End-to-end: the skill discovery code path picks it up + body fragment
    is non-empty so resolve_skill will inject something meaningful."""
    from allhands.execution.skills import _load_builtin_skill_manifest

    desc, factory = _load_builtin_skill_manifest(SKILL_ROOT)
    assert desc.id == "allhands.design"
    skill = factory()
    assert skill.prompt_fragment is not None
    assert len(skill.prompt_fragment) > 1000, "guidance.md unexpectedly short"
    assert "Brand Blue" in skill.prompt_fragment


def test_design_skill_mounted_on_lead_default() -> None:
    """Lead Agent's default skills must include allhands.design.

    Without this, the user saying 「画个高大上的落地页」 wouldn't even see
    the skill descriptor at turn 0 → can't resolve_skill, falls back to
    default ChatGPT-grey HTML.
    """
    from allhands.services.employee_service import LEAD_SKILL_IDS

    assert "allhands.design" in LEAD_SKILL_IDS


def test_design_skill_supersedes_drawio_creator_in_lead() -> None:
    """Stale guard · the deleted allhands.drawio-creator skill MUST NOT
    appear in Lead's mount list (it would log a startup warning every
    boot since the skill files are physically gone)."""
    from allhands.services.employee_service import LEAD_SKILL_IDS

    assert "allhands.drawio-creator" not in LEAD_SKILL_IDS
