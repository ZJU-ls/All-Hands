"""Phase 1 placeholder — SkillRegistry lazy descriptor API.

Spec: docs/specs/agent-runtime-contract.md § 8.1 + § 8.4.
Issue: I-0022 Phase 1 acceptance criterion.

Target behavior (implemented in Phase 1, not this commit):

  - SkillRegistry.get_descriptor(skill_id) returns a lightweight
    {id, name, description} record (≤ 50 chars description) without
    expanding tool_ids — used for the static "available skills" list
    stamped into system prompt at turn 0.
  - SkillRegistry.get_full(skill_id) still returns the full Skill object
    with tool_ids + prompt_fragment (for resolve_skill to consume).
  - bootstrap_employee_runtime() uses get_descriptor, not get_full.

Reference: ref-src-claude/V05-skills-system.md § 2.1 getSkillDirCommands
memoize pattern; only descriptors are materialized until activation.
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Phase 1 target — SkillRegistry lazy API not yet implemented (I-0022)")
def test_get_descriptor_returns_lightweight_record() -> None:
    raise NotImplementedError("Phase 1")


@pytest.mark.skip(
    reason="Phase 1 target — bootstrap_employee_runtime replaces expand_skills_to_tools"
)
def test_bootstrap_employee_runtime_skips_eager_expansion() -> None:
    raise NotImplementedError("Phase 1")
