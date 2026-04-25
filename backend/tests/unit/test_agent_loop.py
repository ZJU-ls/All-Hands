"""ADR 0018 · AgentLoop tests.

The loop is the heart of the new architecture. Drives:
  - one or more LLM turns (while no tool_calls in committed message)
  - tool execution via tool_pipeline
  - emits internal events (terminal + preview) — AG-UI translation
    happens at api/ boundary, not here

Tests grow incrementally per plan task:
  Task 6 (this commit): text-only turn
  Task 7: while-true with tool execution
  Task 8: deferred (confirmation) flow
  Task 9: concurrency partition observable
  Task 10: phantom rejection regression
  Task 11: skill/dispatch/subagent wiring
  Task 12: max_iterations + abort exit reasons
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk

from allhands.core import Employee, Tool, ToolKind, ToolScope
from allhands.core.conversation import ToolUseBlock
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.deferred import (
    DeferredOutcome,
    DeferredRequest,
    DeferredSignal,
)
from allhands.execution.gate import AutoApproveGate
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    ConfirmationRequested,
    LoopExited,
    ToolMessageCommitted,
)
from allhands.execution.registry import ToolRegistry


def _employee(**overrides: Any) -> Employee:
    base: dict[str, Any] = {
        "id": "e1",
        "name": "t",
        "description": "t",
        "system_prompt": "You are helpful.",
        "model_ref": "openai/gpt-4o-mini",
        "tool_ids": [],
        "created_by": "u",
        "created_at": datetime.now(UTC),
    }
    base.update(overrides)
    return Employee(**base)


# --- Task 6: text-only turn -------------------------------------------------


@pytest.mark.asyncio
async def test_loop_streams_text_only_turn() -> None:
    """One LLM turn produces only text → loop emits partials, commits a
    text-only assistant message, exits with reason='completed'."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="hello world")]))
    with patch("allhands.execution.agent_loop._build_model", return_value=model):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [
            ev
            async for ev in loop.stream(
                messages=[{"role": "user", "content": "hi"}],
            )
        ]

    partials = [ev for ev in events if isinstance(ev, AssistantMessagePartial)]
    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert "".join(p.text_delta for p in partials) == "hello world"
    assert len(committed) == 1
    assert committed[0].message.role == "assistant"
    assert committed[0].message.content == "hello world"
    assert len(committed[0].message.content_blocks) == 1
    assert committed[0].message.content_blocks[0].type == "text"
    assert len(exits) == 1
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_emits_committed_after_partials_in_order() -> None:
    """The terminal commit MUST come AFTER all partials for that
    message_id. Frontends and persistence taps rely on this ordering
    to project the message correctly."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="abc")]))
    with patch("allhands.execution.agent_loop._build_model", return_value=model):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    # Find positions
    commit_idx = next(i for i, ev in enumerate(events) if isinstance(ev, AssistantMessageCommitted))
    last_partial_idx = max(
        i for i, ev in enumerate(events) if isinstance(ev, AssistantMessagePartial)
    )
    assert last_partial_idx < commit_idx


@pytest.mark.asyncio
async def test_loop_splits_reasoning_from_text() -> None:
    """Anthropic Extended Thinking + Qwen3 + DeepSeek-R1 emit content
    blocks with type='thinking' or 'reasoning'. The loop routes those
    to AssistantMessagePartial.reasoning_delta, never to text_delta."""

    class _ThinkingModel:
        async def astream(self, *_a: object, **_kw: object) -> Any:
            yield AIMessageChunk(
                content=[
                    {"type": "thinking", "thinking": "let me think"},
                    {"type": "text", "text": "the answer is 42"},
                ]
            )

        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

    with patch("allhands.execution.agent_loop._build_model", return_value=_ThinkingModel()):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    partials = [ev for ev in events if isinstance(ev, AssistantMessagePartial)]
    text = "".join(p.text_delta for p in partials)
    reasoning = "".join(p.reasoning_delta for p in partials)
    assert text == "the answer is 42"
    assert reasoning == "let me think"


@pytest.mark.asyncio
async def test_loop_empty_response_surfaces_distinct_reason() -> None:
    """A turn where the model emits no text AND no tool_calls (e.g. it
    tried to call a de-registered tool and the phantom got dropped) must
    NOT silently `completed` — emit `empty_response` so the UI can show
    something instead of going silent."""

    class _EmptyModel:
        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

        async def astream(self, *_a: object, **_kw: object) -> Any:
            # Mimics what happens when a model wants to call a tool that
            # isn't in lc_tools: it emits a phantom tool_call_chunk that
            # gets dropped, leaving the turn with no text + no tool_uses.
            yield AIMessageChunk(content="")

    with patch("allhands.execution.agent_loop._build_model", return_value=_EmptyModel()):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert len(exits) == 1
    assert exits[-1].reason == "empty_response", (
        f"got reason={exits[-1].reason!r} detail={exits[-1].detail!r}"
    )
    assert exits[-1].detail and "no text and no tool calls" in exits[-1].detail


@pytest.mark.asyncio
async def test_loop_yields_loop_exited_aborted_on_internal_exception() -> None:
    """An exception inside the loop body becomes a LoopExited(aborted)
    sentinel rather than an unhandled traceback. Stream callers can
    rely on a terminal LoopExited even on the error path."""

    class _BoomModel:
        async def astream(self, *_a: object, **_kw: object) -> Any:
            raise RuntimeError("upstream blew up")
            yield  # pragma: no cover  — make it an async generator

        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

    with patch("allhands.execution.agent_loop._build_model", return_value=_BoomModel()):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert len(exits) == 1
    assert exits[0].reason == "aborted"
    assert exits[0].detail and "blew up" in exits[0].detail


@pytest.mark.asyncio
async def test_loop_preserves_message_id_consistency_across_partials_and_commit() -> None:
    """All partials for one assistant turn carry the SAME message_id; the
    committed message has that same id. Persistence keys on this."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="test")]))
    with patch("allhands.execution.agent_loop._build_model", return_value=model):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    partials = [ev for ev in events if isinstance(ev, AssistantMessagePartial)]
    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    assert partials  # at least one
    partial_ids = {p.message_id for p in partials}
    assert len(partial_ids) == 1
    assert committed[0].message.id in partial_ids


# --- Task 7: while-true with tool execution --------------------------------


def _tool(
    name: str,
    *,
    scope: ToolScope = ToolScope.READ,
    requires_confirmation: bool = False,
) -> Tool:
    return Tool(
        id=f"t.{name}",
        kind=ToolKind.BACKEND,
        name=name,
        description=f"{name} tool",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=scope,
        requires_confirmation=requires_confirmation,
    )


class _ScriptedModel:
    """Fake chat model that returns a scripted sequence of AIMessageChunks
    across successive astream() calls. bind_tools() is a no-op (returns
    self) — the script controls what tool_calls appear."""

    def __init__(self, scripts: list[list[AIMessageChunk]]) -> None:
        self._scripts = list(scripts)
        self._calls = 0

    def bind_tools(self, *_a: object, **_kw: object) -> Any:
        return self

    async def astream(self, *_a: object, **_kw: object) -> Any:
        if self._calls >= len(self._scripts):
            raise AssertionError(
                f"_ScriptedModel called {self._calls + 1} times but only {len(self._scripts)} scripts"
            )
        chunks = self._scripts[self._calls]
        self._calls += 1
        for chunk in chunks:
            yield chunk


@pytest.mark.asyncio
async def test_loop_executes_tool_and_continues_to_next_turn() -> None:
    """Iter 1: model emits a tool_call → loop runs the tool → emits
    ToolMessageCommitted → appends both to history → iter 2: model
    emits text → loop exits completed."""
    add = _tool("add")

    async def _add(**kw: Any) -> dict[str, int]:
        return {"sum": kw["a"] + kw["b"]}

    reg = ToolRegistry()
    reg.register(add, _add)

    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[{"id": "tu1", "name": "add", "args": {"a": 2, "b": 3}}],
            )
        ],
        [AIMessageChunk(content="sum is 5")],
    ]
    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [
            ev async for ev in loop.stream(messages=[{"role": "user", "content": "add 2 and 3"}])
        ]

    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert len(committed) == 2
    iter1_blocks = committed[0].message.content_blocks
    tool_uses = [b for b in iter1_blocks if isinstance(b, ToolUseBlock)]
    assert len(tool_uses) == 1
    assert tool_uses[0].name == "add"
    assert tool_uses[0].input == {"a": 2, "b": 3}

    assert len(tool_committed) == 1
    assert tool_committed[0].message.tool_call_id == "tu1"
    assert tool_committed[0].message.content == {"sum": 5}

    assert committed[1].message.content == "sum is 5"
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_event_order_assistant_before_tool_before_next_assistant() -> None:
    """The transcript order is critical for replay correctness:
    AssistantMessageCommitted (with tool_use) → ToolMessageCommitted →
    AssistantMessageCommitted (next turn). No interleaving."""
    add = _tool("add")

    async def _add(**kw: Any) -> dict[str, int]:
        return {"x": 1}

    reg = ToolRegistry()
    reg.register(add, _add)
    scripts = [
        [AIMessageChunk(content="", tool_calls=[{"id": "tu1", "name": "add", "args": {}}])],
        [AIMessageChunk(content="ok")],
    ]
    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "go"}])]

    # Filter to only the three terminal events of interest
    terminal_kinds = []
    for ev in events:
        if isinstance(ev, AssistantMessageCommitted):
            terminal_kinds.append("assistant")
        elif isinstance(ev, ToolMessageCommitted):
            terminal_kinds.append("tool")
        elif isinstance(ev, LoopExited):
            terminal_kinds.append("exit")

    assert terminal_kinds == ["assistant", "tool", "assistant", "exit"]


@pytest.mark.asyncio
async def test_loop_records_tool_executor_error_and_continues() -> None:
    """An exception in the tool executor records as a synthetic
    {"error": ...} envelope on the ToolMessage. The loop continues —
    the model gets the error in the next turn and can adjust."""
    bad = _tool("bad")

    async def _explode(**_: Any) -> dict[str, Any]:
        raise ValueError("nope")

    reg = ToolRegistry()
    reg.register(bad, _explode)
    scripts = [
        [AIMessageChunk(content="", tool_calls=[{"id": "tu1", "name": "bad", "args": {}}])],
        [AIMessageChunk(content="oh well")],
    ]
    emp = _employee(tool_ids=["t.bad"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "go"}])]

    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert len(tool_committed) == 1
    assert isinstance(tool_committed[0].message.content, dict)
    assert "nope" in str(tool_committed[0].message.content.get("error", ""))
    assert exits[-1].reason == "completed"


# --- P2 (2026-04-25): per-iteration tool rebind for progressive loading ---


@pytest.mark.asyncio
async def test_loop_rebinds_tools_per_iteration_for_progressive_loading() -> None:
    """Regression for the progressive-loading bug: when ``resolve_skill``
    runs in iteration N and mutates ``runtime.resolved_skills``, the new
    tools must be visible to the LLM on iteration N+1.

    Previously AgentLoop bound tools once before the while loop, so
    mid-turn skill activation didn't surface new tools (artifact_create
    error). The fix moves binding into the loop body; we assert this by
    counting bind_tools() calls — once per iteration.
    """

    class _RebindCountingModel:
        def __init__(self, scripts: list[list[AIMessageChunk]]) -> None:
            self._scripts = list(scripts)
            self._calls = 0
            self.bind_count = 0

        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            self.bind_count += 1
            return self

        async def astream(self, *_a: object, **_kw: object) -> Any:
            chunks = self._scripts[self._calls]
            self._calls += 1
            for chunk in chunks:
                yield chunk

    add = _tool("add")

    async def _add(**kw: Any) -> dict[str, int]:
        return {"sum": kw["a"] + kw["b"]}

    reg = ToolRegistry()
    reg.register(add, _add)

    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[{"id": "tu1", "name": "add", "args": {"a": 1, "b": 2}}],
            )
        ],
        [AIMessageChunk(content="3")],
    ]
    fake = _RebindCountingModel(scripts)
    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=fake):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "1+2"}])]

    # Two LLM iterations → bind_tools called twice (was 1 before P2).
    assert fake.bind_count == 2, (
        f"Expected bind_tools to be called once per iteration (2x), got {fake.bind_count}. "
        "Tools must be rebuilt per iteration so resolve_skill can unlock new tools mid-turn."
    )
    # Sanity: loop completed normally.
    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert exits[-1].reason == "completed"


# --- Task 10 (folded in here for B1 closure): phantom regression -----------


@pytest.mark.asyncio
async def test_loop_phantom_tool_call_in_chunks_does_not_become_tool_use_block() -> None:
    """Mid-stream tool_call_chunks the model later abandons MUST NOT
    produce a ToolUseBlock in the committed AssistantMessage. The
    protocol-level defense against phantom tool_calls.

    This regresses the gpt-4o-mini bug where a chunk with name+id but
    abandoned args was treated as a real tool call by the legacy
    LangGraph runner."""

    class _PhantomModel:
        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

        async def astream(self, *_a: object, **_kw: object) -> Any:
            # Phantom: model starts a tool_call_chunk but never commits it
            yield AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "index": 0,
                        "id": "phantom",
                        "name": "x",
                        "args": "",
                        "type": "tool_call_chunk",
                    }
                ],
            )
            # Then commits to plain text — final accumulated.tool_calls
            # should have no validly-shaped entries (empty args)
            yield AIMessageChunk(content="never mind, just text.")

    emp = _employee(tool_ids=[])
    with patch("allhands.execution.agent_loop._build_model", return_value=_PhantomModel()):
        loop = AgentLoop(employee=emp, tool_registry=ToolRegistry(), gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    # Phantom MUST NOT have produced a ToolUseBlock
    assert len(committed) == 1
    blocks = committed[0].message.content_blocks
    tool_uses = [b for b in blocks if isinstance(b, ToolUseBlock)]
    assert tool_uses == [], f"phantom tool_call leaked into content_blocks: {tool_uses}"
    # No tool messages committed (no tool_use → nothing to execute)
    assert tool_committed == []
    # Loop exits cleanly
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_replays_tool_history_into_lc_messages() -> None:
    """Multi-turn correctness: when the user passes a history that
    includes a prior assistant message with tool_calls + a tool result,
    the loop reconstructs LangChain AIMessage + ToolMessage in the
    correct order so the next LLM call sees a valid Anthropic-style
    transcript (no orphaned tool_use)."""
    add = _tool("add")

    async def _add(**_: Any) -> dict[str, int]:
        return {"sum": 0}

    reg = ToolRegistry()
    reg.register(add, _add)

    captured: list[Any] = []

    class _Inspector:
        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

        async def astream(self, msgs: list[Any], **_kw: object) -> Any:
            captured.append(list(msgs))
            yield AIMessageChunk(content="ok")

    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_Inspector()):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        history = [
            {"role": "user", "content": "first"},
            {
                "role": "assistant",
                "content": "calling tool",
                "tool_calls": [{"id": "tu_old", "name": "add", "args": {"a": 1}}],
            },
            {"role": "tool", "content": '{"sum": 1}', "tool_call_id": "tu_old"},
            {"role": "user", "content": "second"},
        ]
        _ = [ev async for ev in loop.stream(messages=history)]

    # Inspector saw the lc_messages list passed to astream
    assert captured, "model never called"
    msgs = captured[0]
    # Check the role pattern in order
    from langchain_core.messages import AIMessage as LCAI
    from langchain_core.messages import SystemMessage as LCSys

    types = [type(m).__name__ for m in msgs]
    assert "SystemMessage" in types
    assert types.count("HumanMessage") == 2
    assert types.count("AIMessage") == 1
    assert types.count("ToolMessage") == 1
    # Order: System, Human(first), AI(with tool_calls), Tool(result), Human(second)
    non_sys = [type(m).__name__ for m in msgs if not isinstance(m, LCSys)]
    assert non_sys == ["HumanMessage", "AIMessage", "ToolMessage", "HumanMessage"]
    # AIMessage carried the tool_calls
    ai_msg = next(m for m in msgs if isinstance(m, LCAI))
    assert ai_msg.tool_calls and ai_msg.tool_calls[0]["id"] == "tu_old"


# --- Task 8: deferred (confirmation) flow ----------------------------------


class _ScriptedSignal(DeferredSignal):
    """Test fake DeferredSignal · external code calls .approve()/.reject()
    to flip the wait() result. Use to simulate UI dialog responses."""

    def __init__(self) -> None:
        self._evt = asyncio.Event()
        self._outcome: str = "approved"
        self.last_publish_kwargs: dict[str, Any] | None = None

    def approve(self) -> None:
        self._outcome = "approved"
        self._evt.set()

    def reject(self) -> None:
        self._outcome = "rejected"
        self._evt.set()

    async def publish(self, **kwargs: Any) -> DeferredRequest:
        self.last_publish_kwargs = dict(kwargs)
        return DeferredRequest(request_id="r1", confirmation_id="c1")

    async def wait(self, _req: DeferredRequest) -> DeferredOutcome:
        await self._evt.wait()
        return DeferredOutcome(kind=self._outcome)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_loop_defers_write_tool_emits_confirmation_then_executes_on_approve() -> None:
    """A WRITE-scope, requires_confirmation tool routes through the
    deferred signal: loop emits ConfirmationRequested, awaits, then on
    approve runs the executor and emits the success ToolMessage."""
    write_tool = _tool("danger", scope=ToolScope.WRITE, requires_confirmation=True)

    async def _ex(**_: Any) -> dict[str, str]:
        return {"executed": "yes"}

    reg = ToolRegistry()
    reg.register(write_tool, _ex)
    sig = _ScriptedSignal()

    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[{"id": "tu1", "name": "danger", "args": {"k": "v"}}],
            )
        ],
        [AIMessageChunk(content="done")],
    ]
    emp = _employee(tool_ids=["t.danger"])

    async def _drive() -> list[Any]:
        with patch(
            "allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)
        ):
            loop = AgentLoop(
                employee=emp,
                tool_registry=reg,
                gate=AutoApproveGate(),
                confirmation_signal=sig,
            )
            evs = []
            async for ev in loop.stream(messages=[{"role": "user", "content": "go"}]):
                evs.append(ev)
                if isinstance(ev, ConfirmationRequested):
                    sig.approve()  # simulate UI flipping APPROVED on dialog
            return evs

    events = await _drive()

    confirm = [ev for ev in events if isinstance(ev, ConfirmationRequested)]
    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert len(confirm) == 1
    assert confirm[0].tool_use_id == "tu1"
    assert confirm[0].summary  # non-empty summary built from tool meta
    assert sig.last_publish_kwargs is not None
    assert sig.last_publish_kwargs["tool_use_id"] == "tu1"

    assert len(tool_committed) == 1
    assert tool_committed[0].message.content == {"executed": "yes"}
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_defers_write_tool_records_rejection_message_on_reject() -> None:
    """When user rejects, the executor MUST NOT run; the tool_message
    records a rejection envelope. The model sees the rejection in
    next-turn replay and can adjust."""
    write_tool = _tool("danger", scope=ToolScope.WRITE, requires_confirmation=True)
    executor_called = False

    async def _ex(**_: Any) -> dict[str, str]:
        nonlocal executor_called
        executor_called = True
        return {"executed": "yes"}

    reg = ToolRegistry()
    reg.register(write_tool, _ex)
    sig = _ScriptedSignal()
    sig.reject()  # immediate rejection on wait()

    scripts = [
        [AIMessageChunk(content="", tool_calls=[{"id": "tu1", "name": "danger", "args": {}}])],
        [AIMessageChunk(content="ok then")],
    ]
    emp = _employee(tool_ids=["t.danger"])

    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(
            employee=emp,
            tool_registry=reg,
            gate=AutoApproveGate(),
            confirmation_signal=sig,
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "go"}])]

    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert not executor_called, "executor must not run after reject"
    assert len(tool_committed) == 1
    assert isinstance(tool_committed[0].message.content, dict)
    assert "rejected" in str(tool_committed[0].message.content.get("error", ""))
    assert exits[-1].reason == "completed"


# --- Task 12: max_iterations + abort exit reasons --------------------------


# --- Task 11: skill / dispatch / subagent special-case bindings -----------


def test_build_bindings_substitutes_dispatch_executor_when_service_present() -> None:
    """The registry's stub executor for dispatch_employee is replaced
    with a closure over the AgentLoop's dispatch_service."""
    from allhands.execution.agent_loop import DISPATCH_TOOL_ID
    from allhands.execution.registry import ToolExecutor

    async def _stub(**_: Any) -> dict[str, Any]:
        return {"error": "stub — dispatch_service not wired"}

    dispatch_tool = Tool(
        id=DISPATCH_TOOL_ID,
        kind=ToolKind.BACKEND,
        name="dispatch_employee",
        description="dispatch a task to another employee",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.WRITE,
        requires_confirmation=False,
    )
    reg = ToolRegistry()
    reg.register(dispatch_tool, _stub)

    class _FakeDispatchResult:
        def model_dump(self) -> dict[str, Any]:
            return {"dispatched": True}

    class _FakeDispatch:
        async def dispatch(self, **_: Any) -> Any:
            return _FakeDispatchResult()

    emp = _employee(tool_ids=[DISPATCH_TOOL_ID])
    loop = AgentLoop(
        employee=emp,
        tool_registry=reg,
        gate=AutoApproveGate(),
        dispatch_service=_FakeDispatch(),
    )
    bindings = loop._build_bindings()
    assert "dispatch_employee" in bindings
    real_executor: ToolExecutor = bindings["dispatch_employee"].executor
    assert real_executor is not _stub  # substitution happened


@pytest.mark.asyncio
async def test_dispatch_executor_routes_through_dispatch_service() -> None:
    """Verify the substituted executor actually calls dispatch_service."""
    from allhands.execution.agent_loop import DISPATCH_TOOL_ID

    captured_kwargs: dict[str, Any] = {}

    class _FakeResult:
        def model_dump(self) -> dict[str, Any]:
            return {"ok": True}

    class _FakeDispatch:
        async def dispatch(self, **kw: Any) -> Any:
            captured_kwargs.update(kw)
            return _FakeResult()

    dispatch_tool = Tool(
        id=DISPATCH_TOOL_ID,
        kind=ToolKind.BACKEND,
        name="dispatch_employee",
        description="x",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.WRITE,
        requires_confirmation=False,
    )
    reg = ToolRegistry()

    async def _stub(**_: Any) -> dict[str, Any]:
        return {}

    reg.register(dispatch_tool, _stub)

    emp = _employee(tool_ids=[DISPATCH_TOOL_ID])
    loop = AgentLoop(
        employee=emp,
        tool_registry=reg,
        gate=AutoApproveGate(),
        dispatch_service=_FakeDispatch(),
    )
    bindings = loop._build_bindings()
    result = await bindings["dispatch_employee"].executor(
        employee_id="e2", task="do thing", context_refs=None, timeout_seconds=60
    )
    assert result == {"ok": True}
    assert captured_kwargs["employee_id"] == "e2"
    assert captured_kwargs["task"] == "do thing"


def test_build_bindings_does_not_substitute_when_service_missing() -> None:
    """Without dispatch_service, the registry's stub executor stays —
    no AttributeError on closure init."""
    from allhands.execution.agent_loop import DISPATCH_TOOL_ID

    async def _stub(**_: Any) -> dict[str, Any]:
        return {"stub": True}

    dispatch_tool = Tool(
        id=DISPATCH_TOOL_ID,
        kind=ToolKind.BACKEND,
        name="dispatch_employee",
        description="x",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.WRITE,
        requires_confirmation=False,
    )
    reg = ToolRegistry()
    reg.register(dispatch_tool, _stub)

    emp = _employee(tool_ids=[DISPATCH_TOOL_ID])
    loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
    bindings = loop._build_bindings()
    assert bindings["dispatch_employee"].executor is _stub


@pytest.mark.asyncio
async def test_pipeline_coerces_stringified_json_args() -> None:
    """LLMs (especially gpt-4o-mini) sometimes serialize nested object
    args as a JSON string instead of structured value. The pipeline
    coerces before invoking the executor, so the executor sees the
    structured form regardless of model quirks. Regression for the
    render_stat / render_bar_chart bug."""
    from allhands.execution.tool_pipeline import _coerce_stringified_json

    out = _coerce_stringified_json(
        {
            "delta": '{"value": 2, "label": "x"}',  # stringified dict
            "items": '[{"a": 1}]',  # stringified list
            "name": "leave alone",  # plain string stays
            "count": 5,  # primitive stays
        }
    )
    assert out == {
        "delta": {"value": 2, "label": "x"},
        "items": [{"a": 1}],
        "name": "leave alone",
        "count": 5,
    }


@pytest.mark.asyncio
async def test_loop_yields_max_iterations_when_model_keeps_calling_tools() -> None:
    """If the model keeps emitting tool_calls forever, the loop bails
    with reason='max_iterations' rather than running indefinitely."""
    add = _tool("add")

    async def _ex(**_: Any) -> dict[str, int]:
        return {"x": 1}

    reg = ToolRegistry()
    reg.register(add, _ex)

    class _ForeverModel:
        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

        async def astream(self, *_a: object, **_kw: object) -> Any:
            # Always emit a tool_call → loop never reaches a clean text
            # turn → max_iterations cap fires.
            yield AIMessageChunk(
                content="",
                tool_calls=[{"id": "tu1", "name": "add", "args": {}}],
            )

    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ForeverModel()):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [
            ev
            async for ev in loop.stream(
                messages=[{"role": "user", "content": "go"}],
                max_iterations=3,
            )
        ]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert len(exits) == 1
    assert exits[0].reason == "max_iterations"


@pytest.mark.asyncio
async def test_loop_read_only_tool_with_signal_wired_does_not_defer() -> None:
    """The signal is only consulted for WRITE+ + requires_confirmation
    tools. Plain reads bypass it entirely (no ConfirmationRequested
    emitted)."""
    read_tool = _tool("list_things")

    async def _ex(**_: Any) -> list[str]:
        return ["a", "b"]

    reg = ToolRegistry()
    reg.register(read_tool, _ex)
    sig = _ScriptedSignal()

    scripts = [
        [AIMessageChunk(content="", tool_calls=[{"id": "tu1", "name": "list_things", "args": {}}])],
        [AIMessageChunk(content="found two")],
    ]
    emp = _employee(tool_ids=["t.list_things"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(
            employee=emp,
            tool_registry=reg,
            gate=AutoApproveGate(),
            confirmation_signal=sig,
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "go"}])]

    confirm = [ev for ev in events if isinstance(ev, ConfirmationRequested)]
    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    assert confirm == []
    assert tool_committed and tool_committed[0].message.content == ["a", "b"]
    assert sig.last_publish_kwargs is None  # signal never invoked
