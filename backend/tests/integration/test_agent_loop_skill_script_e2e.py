"""Full AgentLoop E2E · scripted LLM drives resolve_skill → run_skill_script.

Proves the AgentLoop binding I added (agent_loop._maybe_substitute_executor
RUN_SKILL_SCRIPT_TOOL_ID branch) actually works through the real loop, with:

- real ToolRegistry containing both meta tools
- real SkillRegistry seeded from disk (script_demo + anthropic skills)
- real SubprocessScriptRunner running real .py
- AutoApproveGate skipping confirmation (real DeferredSignal flow has its own
  test in test_deferred.py)

The LLM is faked via _ScriptedModel — a deterministic chunk emitter — so the
test runs in CI without API keys and without paying tokens. The point of THIS
test is the wiring (loop ↔ executor binding ↔ runner ↔ result-shape), not the
LLM's reasoning.

Real-LLM proof lives in test_run_skill_script_with_real_llm.py (gated on
ANTHROPIC_API_KEY).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessageChunk

from allhands.core import Employee
from allhands.core.skill_runtime import SkillRuntime
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.gate import AutoApproveGate
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    LoopExited,
    ToolMessageCommitted,
)
from allhands.execution.registry import ToolRegistry
from allhands.execution.script_runner import SubprocessScriptRunner
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools.meta.resolve_skill import RESOLVE_SKILL_TOOL
from allhands.execution.tools.meta.skill_files import READ_SKILL_FILE_TOOL
from allhands.execution.tools.meta.skill_scripts import RUN_SKILL_SCRIPT_TOOL


class _ScriptedModel:
    """Fake LLM · deterministic chunk sequence per astream() call."""

    def __init__(self, scripts: list[list[AIMessageChunk]]) -> None:
        self._scripts = list(scripts)
        self._calls = 0

    def bind_tools(self, *_a: object, **_kw: object) -> Any:
        return self

    async def astream(self, *_a: object, **_kw: object) -> Any:
        if self._calls >= len(self._scripts):
            raise AssertionError(
                f"_ScriptedModel exhausted: {self._calls + 1} > {len(self._scripts)}"
            )
        chunks = self._scripts[self._calls]
        self._calls += 1
        for chunk in chunks:
            yield chunk


def _employee(skill_ids: list[str]) -> Employee:
    return Employee(
        id="e2e",
        name="e2e",
        description="end to end",
        system_prompt="You are a helpful tester.",
        model_ref="openai/gpt-4o-mini",
        skill_ids=skill_ids,
        # Meta tools are always available · the agent must invoke them to
        # progress (resolve_skill first → run_skill_script after).
        tool_ids=[
            "allhands.meta.resolve_skill",
            "allhands.meta.read_skill_file",
            "allhands.meta.run_skill_script",
        ],
        created_by="u1",
        created_at=datetime.now(UTC),
    )


@pytest.fixture
def primed() -> dict[str, Any]:
    skill_reg = SkillRegistry()
    seed_skills(skill_reg)
    runtime = SkillRuntime(
        base_tool_ids=[
            "allhands.meta.resolve_skill",
            "allhands.meta.read_skill_file",
            "allhands.meta.run_skill_script",
        ],
        skill_descriptors=[skill_reg.get_descriptor("allhands.script_demo")],  # type: ignore[list-item]
    )
    tool_reg = ToolRegistry()
    tool_reg.register(RESOLVE_SKILL_TOOL, lambda **_: None)
    tool_reg.register(READ_SKILL_FILE_TOOL, lambda **_: None)
    tool_reg.register(RUN_SKILL_SCRIPT_TOOL, lambda **_: None)
    return {"skill_reg": skill_reg, "tool_reg": tool_reg, "runtime": runtime}


# ──────────────────────────────────────────────────────────────────────────
# Full chain: LLM → resolve_skill → LLM → run_skill_script → LLM final text
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_loop_resolve_then_run_echo(primed: dict[str, Any]) -> None:
    """Three-turn dialogue: activate skill, run script, summarize."""
    skill_reg: SkillRegistry = primed["skill_reg"]
    tool_reg: ToolRegistry = primed["tool_reg"]
    runtime: SkillRuntime = primed["runtime"]
    emp = _employee(skill_ids=["allhands.script_demo"])

    # Three scripted LLM turns:
    #   T1: emit resolve_skill tool_call
    #   T2: emit run_skill_script tool_call (echo "hello AgentLoop")
    #   T3: emit final text summarizing
    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "t1",
                        "name": "resolve_skill",
                        "args": {"skill_id": "allhands.script_demo"},
                    }
                ],
            )
        ],
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "t2",
                        "name": "run_skill_script",
                        "args": {
                            "skill_id": "allhands.script_demo",
                            "script": "scripts/echo.py",
                            "args": ["hello", "AgentLoop"],
                        },
                    }
                ],
            )
        ],
        [AIMessageChunk(content="Done · script printed: hello AgentLoop")],
    ]

    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(
            employee=emp,
            tool_registry=tool_reg,
            gate=AutoApproveGate(),
            skill_registry=skill_reg,
            runtime=runtime,
            script_runner=SubprocessScriptRunner(),
        )
        events = [
            ev
            async for ev in loop.stream(
                messages=[{"role": "user", "content": "echo hello AgentLoop"}],
            )
        ]

    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    tools = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    # Three assistant turns: 2 with tool_use, 1 final text
    assert len(committed) == 3, f"expected 3 turns, got {len(committed)}"
    # Two tool messages: resolve_skill result + run_skill_script result
    assert len(tools) == 2

    # Tool 1 was resolve_skill (ok=True · synthesized · check the next tool ran)
    # Tool 2 was run_skill_script · payload should have stdout from echo.py
    run_msg = tools[1]
    assert run_msg.message.tool_call_id == "t2"
    payload = run_msg.message.content
    assert isinstance(payload, dict), payload
    assert payload.get("exit_code") == 0
    assert "hello AgentLoop" in payload.get("stdout", "")
    assert payload.get("interpreter_used") == "python"

    assert exits[-1].reason == "completed"


# ──────────────────────────────────────────────────────────────────────────
# Loop surfaces our envelope when the LLM passes a bogus path
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_loop_returns_envelope_for_bad_script_path(
    primed: dict[str, Any],
) -> None:
    """ADR 0021 · LLM gets {error, field, expected, hint} not a stack trace."""
    skill_reg: SkillRegistry = primed["skill_reg"]
    tool_reg: ToolRegistry = primed["tool_reg"]
    runtime: SkillRuntime = primed["runtime"]
    emp = _employee(skill_ids=["allhands.script_demo"])

    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "t1",
                        "name": "resolve_skill",
                        "args": {"skill_id": "allhands.script_demo"},
                    }
                ],
            )
        ],
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "t2",
                        "name": "run_skill_script",
                        "args": {
                            "skill_id": "allhands.script_demo",
                            # Wrong: path missing scripts/ prefix
                            "script": "echo.py",
                        },
                    }
                ],
            )
        ],
        [AIMessageChunk(content="I see — I need to prefix with scripts/.")],
    ]

    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(
            employee=emp,
            tool_registry=tool_reg,
            gate=AutoApproveGate(),
            skill_registry=skill_reg,
            runtime=runtime,
            script_runner=SubprocessScriptRunner(),
        )
        events = [
            ev
            async for ev in loop.stream(
                messages=[{"role": "user", "content": "echo via wrong path"}],
            )
        ]

    tools = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    bad = next(t for t in tools if t.message.tool_call_id == "t2")
    payload = bad.message.content
    # ADR 0021 envelope · LLM-friendly · structured · 不吐 traceback
    assert isinstance(payload, dict)
    assert payload.get("field") == "script", payload
    assert payload.get("error"), payload
    # The pydantic min-length check fires first · either error tells the LLM
    # the script path is wrong, which is what we want.


# ──────────────────────────────────────────────────────────────────────────
# Anthropic skill via the full loop (proves the import path works in production)
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_loop_with_anthropic_pdf_skill(primed: dict[str, Any], tmp_path: Any) -> None:
    """Using the imported anthropic.pdf skill end-to-end through AgentLoop."""
    skill_reg: SkillRegistry = primed["skill_reg"]
    if skill_reg.get_full("anthropic.pdf") is None:
        pytest.skip("anthropic.pdf not vendored")

    # Create a tiny PDF
    pdf = tmp_path / "tiny.pdf"
    pdf.write_bytes(
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 100 100]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f\n"
        b"0000000009 00000 n\n"
        b"0000000051 00000 n\n"
        b"0000000091 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n138\n%%EOF\n"
    )

    tool_reg: ToolRegistry = primed["tool_reg"]
    runtime: SkillRuntime = primed["runtime"]
    emp = _employee(skill_ids=["anthropic.pdf"])

    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "t1",
                        "name": "resolve_skill",
                        "args": {"skill_id": "anthropic.pdf"},
                    }
                ],
            )
        ],
        [
            AIMessageChunk(
                content="",
                tool_calls=[
                    {
                        "id": "t2",
                        "name": "run_skill_script",
                        "args": {
                            "skill_id": "anthropic.pdf",
                            "script": "scripts/check_fillable_fields.py",
                            "args": [str(pdf)],
                        },
                    }
                ],
            )
        ],
        [AIMessageChunk(content="The PDF has no fillable fields.")],
    ]

    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(
            employee=emp,
            tool_registry=tool_reg,
            gate=AutoApproveGate(),
            skill_registry=skill_reg,
            runtime=runtime,
            script_runner=SubprocessScriptRunner(),
        )
        events = [
            ev
            async for ev in loop.stream(
                messages=[{"role": "user", "content": "are there fillable fields?"}],
            )
        ]

    tools = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    pdf_result = next(t for t in tools if t.message.tool_call_id == "t2")
    payload = pdf_result.message.content
    if isinstance(payload, dict) and "ModuleNotFoundError" in payload.get("stderr", ""):
        pytest.skip("pypdf not installed in venv")
    assert isinstance(payload, dict)
    assert payload.get("exit_code") == 0
    assert "fillable form fields" in payload.get(
        "stdout", ""
    ) or "does not have fillable form fields" in payload.get("stdout", "")
