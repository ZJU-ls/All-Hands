"""Unit tests for `read_skill_body` — pure function, no tool deps.

ADR 0015 Phase 2: SKILL.md body (after YAML frontmatter) is injected into
`SkillRuntime.resolved_fragments` at activation time.
"""

from __future__ import annotations

from pathlib import Path

from allhands.execution.skills_body import read_skill_body


def test_reads_body_after_frontmatter(tmp_path: Path) -> None:
    (tmp_path / "SKILL.md").write_text(
        "---\nname: t\ndescription: d\n---\n\n# Hello\n\nBody content.\n",
        encoding="utf-8",
    )
    body = read_skill_body(tmp_path)
    assert body.startswith("# Hello")
    assert "Body content." in body


def test_returns_empty_if_no_skill_md(tmp_path: Path) -> None:
    # built-in case: no SKILL.md, just SKILL.yaml
    (tmp_path / "SKILL.yaml").write_text("name: t\n", encoding="utf-8")
    assert read_skill_body(tmp_path) == ""


def test_returns_empty_if_no_frontmatter(tmp_path: Path) -> None:
    (tmp_path / "SKILL.md").write_text("# No frontmatter here", encoding="utf-8")
    # contract choice: without frontmatter, treat whole file as body
    body = read_skill_body(tmp_path)
    assert "No frontmatter here" in body


def test_handles_windows_line_endings(tmp_path: Path) -> None:
    (tmp_path / "SKILL.md").write_text(
        "---\r\nname: t\r\n---\r\n\r\nBody.\r\n",
        encoding="utf-8",
    )
    assert "Body." in read_skill_body(tmp_path)
