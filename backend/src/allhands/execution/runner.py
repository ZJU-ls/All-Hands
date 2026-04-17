"""AgentRunner — wraps LangGraph create_react_agent.

Yields AgentEvent stream. LangGraph types never escape this module.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from allhands.config import get_settings
from allhands.core.provider import LLMProvider
from allhands.core.tool import ToolScope
from allhands.execution.events import (
    AgentEvent,
    DoneEvent,
    ErrorEvent,
    TokenEvent,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.core import Employee
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry


def _build_model(model_ref: str, provider: LLMProvider | None = None) -> Any:
    from langchain_openai import ChatOpenAI

    model_name = model_ref.split("/", 1)[-1]
    kwargs: dict[str, Any] = {"model": model_name}

    if provider is not None:
        if provider.api_key:
            kwargs["api_key"] = provider.api_key
        if provider.base_url:
            kwargs["base_url"] = provider.base_url
    else:
        # fallback to env config
        settings = get_settings()
        if settings.openai_api_key:
            kwargs["api_key"] = settings.openai_api_key
        if settings.openai_base_url:
            kwargs["base_url"] = settings.openai_base_url

    return ChatOpenAI(**kwargs)


class AgentRunner:
    def __init__(
        self,
        employee: Employee,
        tool_registry: ToolRegistry,
        gate: BaseGate,
        provider: LLMProvider | None = None,
    ) -> None:
        self._employee = employee
        self._tool_registry = tool_registry
        self._gate = gate
        self._provider = provider

    async def stream(
        self,
        messages: list[dict[str, Any]],
        thread_id: str,
    ) -> AsyncIterator[AgentEvent]:
        from langchain_core.messages import AIMessage, HumanMessage
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import create_react_agent

        message_id = str(uuid.uuid4())
        gate = self._gate

        lc_tools = []
        for tool_id in self._employee.tool_ids:
            try:
                tool, executor = self._tool_registry.get(tool_id)
            except KeyError:
                continue

            needs_gate = (
                tool.scope in (ToolScope.WRITE, ToolScope.IRREVERSIBLE, ToolScope.BOOTSTRAP)
                and tool.requires_confirmation
            )

            if needs_gate:
                _tool = tool
                _executor = executor

                def _make_gated(t: Any, e: Any) -> Any:
                    async def _gated(**kwargs: Any) -> Any:
                        tc_id = str(uuid.uuid4())
                        outcome = await gate.request(
                            tool=t,
                            args=dict(kwargs),
                            tool_call_id=tc_id,
                            rationale=f"Tool '{t.name}' requires confirmation.",
                            summary=f"Execute {t.name} with args: {kwargs}",
                        )
                        if outcome != "approved":
                            return {"error": f"Tool call {outcome} by user."}
                        return await e(**kwargs)

                    return _gated

                lc_tool = StructuredTool.from_function(
                    coroutine=_make_gated(_tool, _executor),
                    name=tool.name,
                    description=tool.description,
                )
            else:
                _executor2 = executor
                lc_tool = StructuredTool.from_function(
                    coroutine=_executor2,
                    name=tool.name,
                    description=tool.description,
                )
            lc_tools.append(lc_tool)

        model = _build_model(self._employee.model_ref, self._provider)
        lc_messages = [
            HumanMessage(content=m["content"]) if m["role"] == "user"
            else AIMessage(content=m["content"])
            for m in messages
            if m["role"] in ("user", "assistant")
        ]

        try:
            agent = create_react_agent(model, lc_tools)
            async for chunk in agent.astream(
                {"messages": lc_messages},
                config={"configurable": {"thread_id": thread_id}},
            ):
                msgs = chunk.get("messages", [])
                for msg in msgs:
                    if isinstance(msg, AIMessage) and msg.content:
                        yield TokenEvent(
                            message_id=message_id,
                            delta=str(msg.content),
                        )
            yield DoneEvent(message_id=message_id, reason="done")
        except Exception as exc:
            yield ErrorEvent(code="INTERNAL", message=str(exc))
            yield DoneEvent(message_id=message_id, reason="error")
