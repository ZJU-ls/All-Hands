"""Phase 2 placeholder — spawn_subagent meta tool with isolated memory + nested trace.

Spec: docs/specs/agent-runtime-contract.md § 5.2 + § 9.2.
Issue: I-0022 Phase 2 acceptance criterion.

Target behavior (implemented in Phase 2, not this commit):

  - parent AgentRunner calls spawn_subagent(profile="execute", task="...")
  - ConfirmationGate fires; auto-approve policy in tests
  - child AgentRunner starts with fresh memory scope (no parent history)
  - child trace_id is nested under parent trace (Langfuse parent_span_id)
  - parent receives {result, trace_id, iterations_used, status}
  - v0 nesting cap: child calling spawn_subagent again must error

Reference: ref-src-claude/V10-multi-agent.md § 2.2 in-process isolation.
"""

from __future__ import annotations

import pytest


@pytest.mark.skip(reason="Phase 2 target — spawn_subagent meta tool not yet implemented (I-0022)")
def test_spawn_subagent_isolated_memory_and_returns_result() -> None:
    raise NotImplementedError("Phase 2")


@pytest.mark.skip(reason="Phase 2 target — nested trace id tracking (I-0022)")
def test_spawn_subagent_records_nested_trace_id() -> None:
    raise NotImplementedError("Phase 2")


@pytest.mark.skip(reason="Phase 2 target — v0 no grand-children")
def test_subagent_cannot_spawn_another_subagent() -> None:
    raise NotImplementedError("Phase 2")
