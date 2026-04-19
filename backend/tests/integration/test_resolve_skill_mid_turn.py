"""Phase 1 placeholder — dynamic skill injection via resolve_skill meta tool.

Spec: docs/specs/agent-runtime-contract.md § 5.1 + § 8.3.
Issue: I-0022 Phase 1 acceptance criterion.

Target behavior (implemented in Phase 1, not this commit):

  turn 0:
    - employee has skill_ids = ["sk_research"] (not yet resolved)
    - LangGraph agent sees only: base tools + resolve_skill + skill_descriptors
  turn 1:
    - model calls resolve_skill(skill_id="sk_research")
    - runner injects fetch_url into tools[], appends sk_research prompt fragment
  turn 2:
    - next create_react_agent build includes fetch_url
    - system prompt contains sk_research fragment
    - model can now call fetch_url successfully

This file is a skip-placeholder so Phase 1 commits land with a failing test to
flip green. See agent-runtime-contract.md § 14.
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Phase 1 target — resolve_skill meta tool not yet implemented (I-0022)")
def test_resolve_skill_extends_tools_mid_turn() -> None:
    raise NotImplementedError("Phase 1")
