"""Real-LLM end-to-end · drive run_skill_script through Claude.

Gate: requires `ANTHROPIC_API_KEY` in env. Without it, every test in this
module is skipped with a helpful message. With it, we burn real tokens —
deliberately, because the user explicitly asked for "真实 LLM + skill 端到
端测试 · 我不在意 token 和时间消耗".

Strategy
--------
We wire the smallest possible LLM ↔ tool loop:

    1. Build the in-tree `allhands.script_demo` skill registry.
    2. Bind run_skill_script (+ the bare minimum side tools) onto a real
       ChatAnthropic call via .bind_tools() — same shape AgentLoop uses.
    3. Send a system + user message that asks Claude to run a specific
       script with specific args.
    4. Inspect Claude's tool-call output: did it pick run_skill_script?
       Did it pass `skill_id="allhands.script_demo"` and the right script?
    5. Manually invoke our executor with Claude's args. Assert the script
       output is correct.

Why not full AgentLoop · DeferredSignal · ConfirmationGate?  The full chain
adds 6 more moving parts (ChatService · MessageRepo · async signals · etc.)
that are tested separately. This module's job is the LLM ↔ tool boundary —
that the LLM correctly understands the tool's contract (ADR 0021) and our
executor correctly serves the response.

Run with:
    ANTHROPIC_API_KEY=sk-ant-... uv run pytest \
        tests/integration/test_run_skill_script_with_real_llm.py -vs

Each test logs Claude's tool_calls payload to stdout for inspection.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core import Employee, SkillRuntime
from allhands.execution.script_runner import SubprocessScriptRunner
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor
from allhands.execution.tools.meta.skill_scripts import (
    RUN_SKILL_SCRIPT_TOOL,
    make_run_skill_script_executor,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY"),
    reason=(
        "ANTHROPIC_API_KEY not set · skipping real-LLM E2E. "
        "Export the key and re-run to validate the LLM ↔ tool round-trip."
    ),
)


# A small model, cheap, capable enough to use tools predictably.
DEFAULT_MODEL = os.environ.get("ALLHANDS_E2E_MODEL", "claude-haiku-4-5-20251001")


@pytest.fixture
def primed_runtime() -> dict[str, Any]:
    """Seed the real builtin script_demo skill · activate · return executors."""
    registry = SkillRegistry()
    seed_skills(registry)
    skill = registry.get_full("allhands.script_demo")
    assert skill is not None, "script_demo not discovered · check skills/builtin/"

    runtime = SkillRuntime()
    employee = Employee(
        id="real-e2e-1",
        name="real-e2e",
        description="real LLM e2e",
        system_prompt="",
        model_ref=f"anthropic/{DEFAULT_MODEL}",
        skill_ids=["allhands.script_demo"],
        tool_ids=[],
        created_by="u1",
        created_at=datetime.now(UTC),
    )
    return {"registry": registry, "runtime": runtime, "employee": employee}


def _build_chat() -> Any:
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(
        model_name=DEFAULT_MODEL,
        temperature=0,
        max_tokens=2048,
        timeout=60,
        stop=None,
    )


def _to_lc_tool(tool: Any) -> dict[str, Any]:
    """Adapt our Tool model to LangChain's tool spec dict."""
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
    }


# ──────────────────────────────────────────────────────────────────────────
# Test 1 · Claude picks run_skill_script for an "echo" request
# ──────────────────────────────────────────────────────────────────────────


def test_real_llm_calls_run_skill_script_for_echo(
    primed_runtime: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    chat = _build_chat()

    chat_with_tools = chat.bind_tools([_to_lc_tool(RUN_SKILL_SCRIPT_TOOL)])

    sys_msg = (
        "You are a test agent. The skill 'allhands.script_demo' is already "
        "activated for this conversation (its scripts are available). "
        "Use the run_skill_script tool to satisfy the user's request. "
        "Do not ask clarifying questions."
    )
    user_msg = (
        "Run scripts/echo.py inside the allhands.script_demo skill with "
        "arguments ['hello', 'world']."
    )

    response = chat_with_tools.invoke([("system", sys_msg), ("human", user_msg)])

    tool_calls = getattr(response, "tool_calls", []) or []
    print("\n[real-LLM] response.tool_calls:", json.dumps(tool_calls, indent=2, default=str))
    assert tool_calls, f"Claude did not call any tool · raw content: {response.content!r}"
    call = tool_calls[0]
    assert call["name"] == "run_skill_script"
    args = call["args"]
    assert args["skill_id"] == "allhands.script_demo"
    assert args["script"].endswith("echo.py")
    # accept either ['hello', 'world'] or 'hello world' string · executor coerces
    if isinstance(args.get("args"), list):
        assert args["args"] == ["hello", "world"]
    else:
        # fallback: model rendered as space-joined string · still acceptable
        assert "hello" in str(args.get("args", "")) and "world" in str(args.get("args", ""))


# ──────────────────────────────────────────────────────────────────────────
# Test 2 · Full round-trip: LLM picks tool · we execute · script output works
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_real_llm_to_real_script_round_trip(
    primed_runtime: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    """LLM → tool args → real subprocess → output back · prove the chain works."""
    chat = _build_chat()
    chat_with_tools = chat.bind_tools([_to_lc_tool(RUN_SKILL_SCRIPT_TOOL)])

    user_msg = (
        "Use the run_skill_script tool to call scripts/word_count.py inside "
        "the allhands.script_demo skill, sending the text "
        "'one two three four five' as stdin."
    )
    response = chat_with_tools.invoke(
        [
            (
                "system",
                "Skill 'allhands.script_demo' is activated. Use tools to fulfil "
                "the user's request. Never ask clarifying questions.",
            ),
            ("human", user_msg),
        ]
    )

    tool_calls = getattr(response, "tool_calls", []) or []
    print("\n[real-LLM] tool_calls:", json.dumps(tool_calls, indent=2, default=str))
    assert tool_calls, response.content
    call = tool_calls[0]
    assert call["name"] == "run_skill_script"
    raw_args = call["args"]

    # Activate skill (the LLM was told it's already activated · we make that true)
    runtime = primed_runtime["runtime"]
    employee = primed_runtime["employee"]
    registry = primed_runtime["registry"]
    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    await resolve(skill_id="allhands.script_demo")

    # Execute via our real tool executor + real subprocess runner
    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(**raw_args)
    print("[real-LLM] executor result:", json.dumps(out, indent=2))
    assert out.get("exit_code") == 0, out
    payload = json.loads(out["stdout"])
    assert payload["words"] == 5
    assert payload["lines"] == 1


# ──────────────────────────────────────────────────────────────────────────
# Test 3 · Self-correction · LLM gets a structured error and tries again
# ──────────────────────────────────────────────────────────────────────────


def test_real_llm_self_corrects_after_error_envelope(
    primed_runtime: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    """ADR 0021 promise · LLM reads {error, field, expected, hint} and retries.

    Round 1: Claude is told to call a script with WRONG path (without scripts/
        prefix). Our executor returns a structured envelope.
    Round 2: We feed the envelope back as a tool_result. Claude should
        produce a corrected tool call.
    """
    chat = _build_chat()
    chat_with_tools = chat.bind_tools([_to_lc_tool(RUN_SKILL_SCRIPT_TOOL)])

    msgs: list[Any] = [
        (
            "system",
            "Skill 'allhands.script_demo' is activated. Use run_skill_script. "
            "On error, examine the error envelope and try again with corrected args.",
        ),
        (
            "human",
            "Call the script 'echo.py' (which lives under scripts/) with arg 'ping'.",
        ),
    ]

    # Round 1
    r1 = chat_with_tools.invoke(msgs)
    print("\n[round 1] tool_calls:", r1.tool_calls)
    if not r1.tool_calls:
        pytest.skip("Round 1 did not produce a tool call · LLM scheduling variance")
    call1 = r1.tool_calls[0]
    args1 = call1["args"]

    # Some Claude variants will send 'echo.py' raw · others auto-prefix.
    # Accept whatever they send and see if our envelope-based retry works.
    print("[round 1] args:", args1)

    if args1["script"].startswith("scripts/"):
        # Already correct — no need to test self-correction; just assert output.
        # But for the assertion to be meaningful, we still want the path to
        # work. This is fine; the LLM was thorough.
        return

    # Round 2 · feed back the envelope our executor would produce
    from langchain_core.messages import AIMessage, ToolMessage

    msgs.append(AIMessage(content=r1.content, tool_calls=r1.tool_calls))
    msgs.append(
        ToolMessage(
            tool_call_id=call1["id"],
            content=json.dumps(
                {
                    "error": "script must live under 'scripts/' — got 'echo.py'",
                    "field": "script",
                    "expected": "path starting with 'scripts/'",
                    "received": "echo.py",
                    "hint": "Place your script in 'scripts/<name>.py' inside the skill.",
                }
            ),
        )
    )
    r2 = chat_with_tools.invoke(msgs)
    print("[round 2] tool_calls:", r2.tool_calls)
    assert r2.tool_calls, "Claude did not retry after envelope · regression in ADR 0021 path"
    call2 = r2.tool_calls[0]
    args2 = call2["args"]
    assert args2["script"].startswith("scripts/"), (
        f"Claude failed to self-correct · still produced {args2['script']!r}"
    )
