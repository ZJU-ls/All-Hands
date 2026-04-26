"""Regression tests: allhands.drawio-creator was physically removed (P3).

The skill was merged into allhands.artifacts. These tests ensure:
1. The directory is gone from skills/builtin/
2. discover loop doesn't surface a descriptor with that id
3. The new artifacts skill carries the merged tool_ids + drawio templates
4. The migration's recursive replace function handles every shape we see
   in real DB rows (list[str], nested dict, plain string) without losing
   data, including de-dup when the new id would now appear twice.
"""

from __future__ import annotations

from pathlib import Path

import pytest

SKILLS_ROOT = Path(__file__).resolve().parents[2] / "skills" / "builtin"


def test_drawio_creator_dir_removed() -> None:
    assert not (SKILLS_ROOT / "drawio-creator").exists(), (
        "drawio-creator skill must be physically removed (P3) — merged into "
        "allhands.artifacts. If you need its content, look at "
        "skills/builtin/artifacts/kinds/drawio.md or templates/drawio/."
    )


def test_artifacts_skill_owns_drawio_templates() -> None:
    tdir = SKILLS_ROOT / "artifacts" / "templates" / "drawio"
    assert tdir.exists()
    expected = {
        "flowchart.drawio.xml",
        "sequence.drawio.xml",
        "er.drawio.xml",
        "architecture.drawio.xml",
        "mindmap.drawio.xml",
    }
    actual = {p.name for p in tdir.iterdir() if p.is_file()}
    assert expected <= actual, f"missing templates: {expected - actual}"


def test_artifacts_skill_carries_render_drawio_tool() -> None:
    import yaml

    yaml_path = SKILLS_ROOT / "artifacts" / "SKILL.yaml"
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    assert "allhands.artifacts.render_drawio" in data["tool_ids"]


def test_discover_excludes_drawio_creator() -> None:
    from allhands.execution.skills import _load_builtin_skill_manifest

    # discover loops the dir; just verify the file isn't there + loading
    # the dir would raise. Equivalent regression for the registry path.
    drawio_dir = SKILLS_ROOT / "drawio-creator"
    assert not drawio_dir.exists()

    artifacts_dir = SKILLS_ROOT / "artifacts"
    desc, _factory = _load_builtin_skill_manifest(artifacts_dir)
    assert desc.id == "allhands.artifacts"


@pytest.mark.parametrize(
    "input_value, expected",
    [
        # bare string
        ("allhands.drawio-creator", "allhands.artifacts"),
        # already-new no-op
        ("allhands.artifacts", "allhands.artifacts"),
        # list with old id
        (
            ["allhands.foo", "allhands.drawio-creator", "allhands.bar"],
            ["allhands.foo", "allhands.artifacts", "allhands.bar"],
        ),
        # list where replace would create dup
        (
            ["allhands.artifacts", "allhands.drawio-creator"],
            ["allhands.artifacts"],
        ),
        # nested dict
        (
            {"active_skills": ["allhands.drawio-creator"], "tools": []},
            {"active_skills": ["allhands.artifacts"], "tools": []},
        ),
    ],
)
def test_migration_replace_function(input_value: object, expected: object) -> None:
    """Mirror the migration's recursive replace logic (sanity for the script).

    Tests the function shape directly so a refactor of the migration body
    doesn't silently break id rewriting.
    """
    # Re-import the migration module's helper. The migration filename has a
    # leading digit so we load via importlib.
    import importlib.util

    mig_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "0029_replace_drawio_creator_skill_id.py"
    )
    spec = importlib.util.spec_from_file_location("mig0029", mig_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    out, _changed = module._replace_in_value(input_value)
    assert out == expected
