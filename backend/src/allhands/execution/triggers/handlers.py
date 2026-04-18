"""Action handler factories — spec § 5.4, one callable per TriggerActionType.

Each factory returns an `ActionHandler` (Protocol from executor.py) that the
TriggerExecutor dispatches to. Factories accept the runtime wiring they need
(EventBus for notify, tool registry for invoke_tool, service callables for
dispatch/continue) so the handler itself stays async def + three-arg.

invoke_tool enforces the § 5.4 rule: triggers may not directly invoke tools
whose scope is WRITE/IRREVERSIBLE or that require confirmation — those must
go through dispatch_employee so an agent owns the decision.

dispatch_employee / continue_conversation currently wrap callable stubs so
the scheduler can fire end-to-end without waiting on full run_service wiring
(spec § 13 explicitly allows this). Wave C replaces the stubs with real
service calls; the handler shape (three-arg async returning run_id) does not
change.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from allhands.core import ToolScope, TriggerActionType

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.core import TriggerAction
    from allhands.execution.event_bus import EventBus
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.triggers.executor import ActionHandler

    DispatchFn = Callable[[str, str, str], Awaitable[str]]
    """(employee_id, task, trigger_id) -> run_id"""

    ContinueFn = Callable[[str, str, str], Awaitable[str]]
    """(conversation_id, message, trigger_id) -> run_id"""


logger = logging.getLogger(__name__)


def notify_user_handler(bus: EventBus) -> ActionHandler:
    """Publish a `trigger.notify` event — cockpit activity feed subscribes."""

    async def _handler(action: TriggerAction, rendered_text: str, trigger_id: str) -> str | None:
        await bus.publish(
            kind="trigger.notify",
            payload={
                "channel": action.channel or "cockpit",
                "message": rendered_text,
            },
            trigger_id=trigger_id,
        )
        return None

    return _handler


def invoke_tool_handler(registry: ToolRegistry) -> ActionHandler:
    """Execute a READ-scope tool directly. Rejects WRITE/IRREVERSIBLE per § 5.4."""

    async def _handler(action: TriggerAction, rendered_text: str, trigger_id: str) -> str | None:
        if not action.tool_id:
            raise ValueError("invoke_tool requires tool_id")
        tool, executor = registry.get(action.tool_id)
        if tool.scope in (ToolScope.WRITE, ToolScope.IRREVERSIBLE) or tool.requires_confirmation:
            raise PermissionError(
                f"trigger cannot directly invoke {tool.scope.value} tool {tool.id!r}; "
                "use dispatch_employee so an agent owns the write decision"
            )
        args = action.args_template or {}
        await executor(**args)
        return None

    return _handler


def dispatch_employee_stub_handler() -> ActionHandler:
    """Stub — returns a synthetic run_id, logs intent. Real wiring in Wave C."""

    async def _handler(action: TriggerAction, rendered_text: str, trigger_id: str) -> str | None:
        run_id = f"run_{uuid.uuid4().hex[:16]}"
        logger.info(
            "trigger.dispatch_employee.stub",
            extra={
                "trigger_id": trigger_id,
                "employee_id": action.employee_id,
                "task_preview": rendered_text[:120],
                "run_id": run_id,
            },
        )
        return run_id

    return _handler


def continue_conversation_stub_handler() -> ActionHandler:
    """Stub — returns a synthetic run_id, logs intent. Real wiring in Wave C."""

    async def _handler(action: TriggerAction, rendered_text: str, trigger_id: str) -> str | None:
        run_id = f"run_{uuid.uuid4().hex[:16]}"
        logger.info(
            "trigger.continue_conversation.stub",
            extra={
                "trigger_id": trigger_id,
                "conversation_id": action.conversation_id,
                "message_preview": rendered_text[:120],
                "run_id": run_id,
            },
        )
        return run_id

    return _handler


def build_default_handlers(
    bus: EventBus,
    registry: ToolRegistry,
    *,
    dispatch_fn: DispatchFn | None = None,
    continue_fn: ContinueFn | None = None,
) -> dict[TriggerActionType, ActionHandler]:
    """Assemble the 4-handler dict the runtime hands to TriggerExecutor.

    When dispatch_fn/continue_fn are None (current state) we fall back to
    stubs; Wave C passes real run_service callables and gets full behavior
    with no change to the executor or service layer.
    """
    dispatch_handler: ActionHandler
    if dispatch_fn is not None:
        dispatch_cb = dispatch_fn

        async def dispatch_handler(
            action: TriggerAction, rendered_text: str, trigger_id: str
        ) -> str | None:
            if not action.employee_id:
                raise ValueError("dispatch_employee requires employee_id")
            return await dispatch_cb(action.employee_id, rendered_text, trigger_id)
    else:
        dispatch_handler = dispatch_employee_stub_handler()

    continue_handler: ActionHandler
    if continue_fn is not None:
        continue_cb = continue_fn

        async def continue_handler(
            action: TriggerAction, rendered_text: str, trigger_id: str
        ) -> str | None:
            if not action.conversation_id:
                raise ValueError("continue_conversation requires conversation_id")
            return await continue_cb(action.conversation_id, rendered_text, trigger_id)
    else:
        continue_handler = continue_conversation_stub_handler()

    return {
        TriggerActionType.NOTIFY_USER: notify_user_handler(bus),
        TriggerActionType.INVOKE_TOOL: invoke_tool_handler(registry),
        TriggerActionType.DISPATCH_EMPLOYEE: dispatch_handler,
        TriggerActionType.CONTINUE_CONVERSATION: continue_handler,
    }


__all__ = [
    "build_default_handlers",
    "continue_conversation_stub_handler",
    "dispatch_employee_stub_handler",
    "invoke_tool_handler",
    "notify_user_handler",
]
