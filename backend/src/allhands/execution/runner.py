"""AgentRunner — wraps LangGraph create_react_agent.

Yields AgentEvent stream. LangGraph types never escape this module.

Contract § 8.1-8.4: holds a `SkillRuntime` across send_message calls
(persisted by ChatService per conversation) and rebuilds `lc_tools` +
`system_prompt` at the start of each stream() call from:

    base_tool_ids = runtime.base_tool_ids
    resolved_tool_ids = flatten(runtime.resolved_skills.values())
    system_prompt = employee.system_prompt + descriptors + resolved_fragments

Ref: ref-src-claude/V02-execution-kernel.md § 2.1 · query() while(true) main
loop · rebuild context every turn.
Ref: ref-src-claude/V04-tool-call-mechanism.md § 2.1 · Tool scope →
partitioned gate pipeline.
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
from allhands.execution.skills import (
    SkillRegistry,
    SkillRuntime,
    render_skill_descriptors,
)
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor
from allhands.execution.tools.meta.spawn_subagent import make_spawn_subagent_executor

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.core import Employee
    from allhands.execution.dispatch import DispatchService
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools.meta.spawn_subagent import SpawnSubagentService


DISPATCH_TOOL_ID = "allhands.meta.dispatch_employee"
RESOLVE_SKILL_TOOL_ID = "allhands.meta.resolve_skill"
SPAWN_SUBAGENT_TOOL_ID = "allhands.meta.spawn_subagent"


def _make_dispatch_executor(dispatch_service: DispatchService) -> Any:
    """Build the StructuredTool coroutine for dispatch_employee.

    Keeps the closure out of the per-tool for-loop (avoids B023 loop-variable
    capture). The runner wires this in place of the registry's no-op executor.
    """

    async def _dispatch_executor(
        employee_id: str,
        task: str,
        context_refs: list[str] | None = None,
        timeout_seconds: int = 300,
    ) -> dict[str, Any]:
        result = await dispatch_service.dispatch(
            employee_id=employee_id,
            task=task,
            context_refs=context_refs,
            timeout_seconds=timeout_seconds,
        )
        return result.model_dump()

    return _dispatch_executor


def _build_model(model_ref: str, provider: LLMProvider | None = None) -> Any:
    if provider is not None:
        from allhands.execution.llm_factory import build_llm

        return build_llm(provider, model_ref)

    # fallback path — no provider bound (dev / test), treat as OpenAI-compat
    # and read creds from env config.
    from langchain_openai import ChatOpenAI

    model_name = model_ref.split("/", 1)[-1]
    kwargs: dict[str, Any] = {"model": model_name}
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
        dispatch_service: DispatchService | None = None,
        skill_registry: SkillRegistry | None = None,
        runtime: SkillRuntime | None = None,
        spawn_subagent_service: SpawnSubagentService | None = None,
    ) -> None:
        self._employee = employee
        self._tool_registry = tool_registry
        self._gate = gate
        self._provider = provider
        self._dispatch_service = dispatch_service
        self._skill_registry = skill_registry
        self._spawn_subagent_service = spawn_subagent_service
        # Runtime is normally created and owned by ChatService (per-conversation
        # persistence across send_message calls). If the caller didn't supply
        # one, fall back to a throwaway runtime derived from employee.tool_ids
        # so legacy callers keep working.
        self._runtime = runtime or SkillRuntime(base_tool_ids=list(employee.tool_ids))

    def _active_tool_ids(self) -> list[str]:
        """Contract § 8.2 · base + flatten(resolved_skills.values())."""
        active: list[str] = list(self._runtime.base_tool_ids)
        seen: set[str] = set(active)
        for tids in self._runtime.resolved_skills.values():
            for tid in tids:
                if tid not in seen:
                    active.append(tid)
                    seen.add(tid)
        return active

    def _compose_system_prompt(self) -> str:
        """Contract § 8.2 · employee.system_prompt + descriptors + resolved fragments.

        The descriptor list is stamped at turn 0 (cheap · ≤ 600 tokens for 10
        skills); resolved_fragments grow as the model activates skills.
        """
        parts: list[str] = []
        base = (self._employee.system_prompt or "").strip()
        if base:
            parts.append(base)
        if self._runtime.skill_descriptors:
            parts.append(render_skill_descriptors(self._runtime.skill_descriptors))
        if self._runtime.resolved_fragments:
            parts.append("\n\n".join(self._runtime.resolved_fragments))
        return "\n\n".join(parts).strip()

    async def stream(
        self,
        messages: list[dict[str, Any]],
        thread_id: str,
    ) -> AsyncIterator[AgentEvent]:
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import create_react_agent

        message_id = str(uuid.uuid4())
        gate = self._gate

        lc_tools: list[Any] = []
        for tool_id in self._active_tool_ids():
            try:
                tool, executor = self._tool_registry.get(tool_id)
            except KeyError:
                continue

            if tool_id == RESOLVE_SKILL_TOOL_ID and self._skill_registry is not None:
                executor = make_resolve_skill_executor(
                    employee=self._employee,
                    runtime=self._runtime,
                    skill_registry=self._skill_registry,
                )
                lc_tools.append(
                    StructuredTool.from_function(
                        coroutine=executor,
                        name=tool.name,
                        description=tool.description,
                    )
                )
                continue

            if tool_id == DISPATCH_TOOL_ID and self._dispatch_service is not None:
                lc_tools.append(
                    StructuredTool.from_function(
                        coroutine=_make_dispatch_executor(self._dispatch_service),
                        name=tool.name,
                        description=tool.description,
                    )
                )
                continue

            if tool_id == SPAWN_SUBAGENT_TOOL_ID and self._spawn_subagent_service is not None:
                # Rebind the registry's no-op stub to the real service. We then
                # fall through to the gate-wrap logic below so the user is
                # prompted (spawn_subagent declares scope=WRITE + requires_confirmation=True).
                executor = make_spawn_subagent_executor(self._spawn_subagent_service)

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

        system_prompt = self._compose_system_prompt()
        lc_messages: list[Any] = []
        if system_prompt:
            lc_messages.append(SystemMessage(content=system_prompt))
        lc_messages.extend(
            HumanMessage(content=m["content"])
            if m["role"] == "user"
            else AIMessage(content=m["content"])
            for m in messages
            if m["role"] in ("user", "assistant")
        )

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
