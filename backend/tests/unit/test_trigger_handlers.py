"""Unit tests · execution/triggers/handlers.py.

Contract (spec § 5.4):
- notify_user publishes trigger.notify via EventBus
- invoke_tool rejects WRITE/IRREVERSIBLE/requires_confirmation tools
- invoke_tool forwards args_template to the tool executor
- dispatch_employee stub returns a run_id
- build_default_handlers wires the 4 keys
"""

from __future__ import annotations

from typing import Any

import pytest

from allhands.core import (
    CostHint,
    Tool,
    ToolKind,
    ToolScope,
    TriggerAction,
    TriggerActionType,
)
from allhands.execution.event_bus import EventBus
from allhands.execution.registry import ToolRegistry
from allhands.execution.triggers.handlers import (
    build_default_handlers,
    invoke_tool_handler,
    notify_user_handler,
)


def _read_tool() -> Tool:
    return Tool(
        id="tool.echo",
        kind=ToolKind.BACKEND,
        name="echo",
        description="echo args",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.READ,
        requires_confirmation=False,
        cost_hint=CostHint(relative="low"),
    )


def _write_tool() -> Tool:
    return Tool(
        id="tool.write",
        kind=ToolKind.BACKEND,
        name="writer",
        description="writes something",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.WRITE,
        requires_confirmation=True,
    )


async def _noop(**_kwargs: Any) -> None:
    return None


@pytest.mark.asyncio
async def test_notify_user_publishes_event() -> None:
    import asyncio

    from allhands.core import EventEnvelope, EventPattern

    bus = EventBus()
    seen: list[EventEnvelope] = []

    async def _collect(env: EventEnvelope) -> None:
        seen.append(env)

    bus.subscribe(EventPattern(type="trigger.notify"), _collect)
    handler = notify_user_handler(bus)
    await handler(
        TriggerAction(type=TriggerActionType.NOTIFY_USER, channel="cockpit", message="m"),
        "hello there",
        "trg_1",
    )
    # let fan-out tasks run
    for _ in range(3):
        await asyncio.sleep(0)
    assert seen and seen[0].payload.get("message") == "hello there"
    assert seen[0].trigger_id == "trg_1"


@pytest.mark.asyncio
async def test_invoke_tool_rejects_write_scope() -> None:
    reg = ToolRegistry()
    reg.register(_write_tool(), _noop)
    handler = invoke_tool_handler(reg)
    with pytest.raises(PermissionError):
        await handler(
            TriggerAction(type=TriggerActionType.INVOKE_TOOL, tool_id="tool.write"),
            "",
            "trg",
        )


@pytest.mark.asyncio
async def test_invoke_tool_forwards_args() -> None:
    reg = ToolRegistry()
    received: dict[str, Any] = {}

    async def _exec(**kwargs: Any) -> None:
        received.update(kwargs)

    reg.register(_read_tool(), _exec)
    handler = invoke_tool_handler(reg)
    await handler(
        TriggerAction(
            type=TriggerActionType.INVOKE_TOOL,
            tool_id="tool.echo",
            args_template={"a": 1, "b": "x"},
        ),
        "",
        "trg",
    )
    assert received == {"a": 1, "b": "x"}


@pytest.mark.asyncio
async def test_dispatch_stub_returns_run_id() -> None:
    handlers = build_default_handlers(EventBus(), ToolRegistry())
    handler = handlers[TriggerActionType.DISPATCH_EMPLOYEE]
    run_id = await handler(
        TriggerAction(
            type=TriggerActionType.DISPATCH_EMPLOYEE,
            employee_id="emp_1",
            task_template="t",
        ),
        "rendered task",
        "trg_1",
    )
    assert run_id and run_id.startswith("run_")


@pytest.mark.asyncio
async def test_dispatch_real_callback_used_when_provided() -> None:
    async def fake_dispatch(employee_id: str, task: str, trigger_id: str) -> str:
        assert employee_id == "emp_x"
        assert task == "render"
        return "real_run_1"

    handlers = build_default_handlers(EventBus(), ToolRegistry(), dispatch_fn=fake_dispatch)
    run_id = await handlers[TriggerActionType.DISPATCH_EMPLOYEE](
        TriggerAction(
            type=TriggerActionType.DISPATCH_EMPLOYEE,
            employee_id="emp_x",
            task_template="t",
        ),
        "render",
        "trg_1",
    )
    assert run_id == "real_run_1"


@pytest.mark.asyncio
async def test_build_default_handlers_has_all_four() -> None:
    handlers = build_default_handlers(EventBus(), ToolRegistry())
    assert set(handlers.keys()) == {
        TriggerActionType.NOTIFY_USER,
        TriggerActionType.INVOKE_TOOL,
        TriggerActionType.DISPATCH_EMPLOYEE,
        TriggerActionType.CONTINUE_CONVERSATION,
    }
