"""Built-in skills must set `Skill.path` so progressive-loading works uniformly.

ADR 0015 Phase 1: built-in skills are loaded from
`backend/skills/builtin/<id>/SKILL.yaml`, and the `path` field must be set
to the containing directory so `read_skill_file` can sandbox relative
reads to the same install root that installed skills use.

2026-04-28: anthropic-vendored skills (anthropic.<name>) carry SKILL.md
(Claude Code format) instead of SKILL.yaml — accept either manifest.
"""

from __future__ import annotations

from pathlib import Path

from allhands.execution.skills import SkillRegistry, seed_skills


def test_builtin_skills_have_absolute_path() -> None:
    registry = SkillRegistry()
    seed_skills(registry)

    builtin_descriptors = [
        d
        for d in registry.list_descriptors()
        if not d.id.startswith("sk_")  # legacy dev seeds registered eagerly w/o path
    ]
    assert builtin_descriptors, "expected at least one YAML-backed builtin skill"

    for descriptor in builtin_descriptors:
        full = registry.get_full(descriptor.id)
        assert full is not None, f"get_full returned None for {descriptor.id}"
        assert full.path is not None, f"skill {full.id} has no path"
        path = Path(full.path)
        assert path.is_dir(), f"path not a dir: {full.path}"
        # YAML manifest (our own builtins) OR markdown manifest (anthropic format)
        has_manifest = (path / "SKILL.yaml").is_file() or (path / "SKILL.md").is_file()
        assert has_manifest, f"SKILL.yaml or SKILL.md missing at: {full.path}"
