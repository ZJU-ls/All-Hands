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
from allhands.core.run_overrides import RunOverrides
from allhands.core.tool import ToolScope
from allhands.execution.events import (
    AgentEvent,
    DoneEvent,
    ErrorEvent,
    ReasoningEvent,
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


def _build_model(
    model_ref: str,
    provider: LLMProvider | None = None,
    overrides: RunOverrides | None = None,
) -> Any:
    if provider is not None:
        from allhands.execution.llm_factory import build_llm

        model = build_llm(provider, model_ref)
        return _apply_overrides(model, overrides)

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
    return _apply_overrides(ChatOpenAI(**kwargs), overrides)


def _split_content_blocks(content: Any) -> tuple[str, str]:
    """Normalize ``AIMessageChunk.content`` into ``(text_delta, thinking_delta)``.

    LangChain adapters return content in one of two shapes:

    * ``str`` — OpenAI-style plain text. Entirely user-facing.
    * ``list[block]`` — provider-structured content. Blocks have a ``type``
      key; common values are ``"text"`` (user-facing) and ``"thinking"`` /
      ``"reasoning"`` (model's internal chain-of-thought from Anthropic
      Extended Thinking, Qwen3 ``enable_thinking``, DeepSeek-R1, etc.).

    Stringifying a list-of-blocks leaks the Python repr into the chat
    transcript — the exact ``[{'thinking': ..., 'type': 'thinking'}]`` UI
    bug this normalizer fixes. We route ``text`` to the user-visible
    stream and ``thinking`` to a separate reasoning stream so the chat UI
    can render them distinctly (inline transcript vs collapsible block).
    Unknown block types are dropped rather than leaked as repr.
    """
    if isinstance(content, str):
        return content, ""
    if not isinstance(content, list):
        return str(content), ""

    text_parts: list[str] = []
    thinking_parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            text_parts.append(block)
            continue
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text":
            val = block.get("text")
            if isinstance(val, str):
                text_parts.append(val)
        elif btype in ("thinking", "reasoning"):
            # Anthropic uses "thinking"; some OpenAI-compat providers use
            # "reasoning". The text lives under whichever key the block
            # type names ("thinking" → block["thinking"], etc.); fall
            # back to a "text" field for adapters that normalize it there.
            val = block.get(btype) or block.get("text")
            if isinstance(val, str):
                thinking_parts.append(val)
        # ignore tool_use / image_url / etc. — those surface through the
        # tool-call events path, not chat text.
    return "".join(text_parts), "".join(thinking_parts)


def _apply_overrides(model: Any, overrides: RunOverrides | None) -> Any:
    """Fold per-turn knobs onto a freshly-built chat model.

    LangChain chat models expose ``.bind(**kwargs)`` which returns a
    runnable with the kwargs merged into every downstream call. We use it
    instead of rebuilding the model with different constructor args because
    some knobs (``extra_body``, ``thinking``) aren't constructor parameters
    on every adapter — bind passes them through as call-time kwargs where
    the adapter will forward them into its HTTP request body. Providers
    that don't understand a key silently ignore it, which matches the
    "inherit default on None" contract on :class:`RunOverrides`.
    """
    if overrides is None:
        return model

    bind_kwargs: dict[str, Any] = {}
    if overrides.temperature is not None:
        bind_kwargs["temperature"] = overrides.temperature
    if overrides.top_p is not None:
        bind_kwargs["top_p"] = overrides.top_p
    if overrides.max_tokens is not None:
        bind_kwargs["max_tokens"] = overrides.max_tokens
    if overrides.thinking is not None:
        # DashScope / Qwen3-style reasoning toggle rides in extra_body;
        # OpenAI-compat adapters treat extra_body as pass-through.
        bind_kwargs["extra_body"] = {"enable_thinking": overrides.thinking}

    if not bind_kwargs:
        return model
    try:
        return model.bind(**bind_kwargs)
    except Exception:
        # Adapter doesn't support .bind(...) — fall back to returning the
        # naked model rather than crashing. The user sees default-param
        # behavior; worse than expected, but not a hang.
        return model


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
        model_ref_override: str | None = None,
    ) -> None:
        self._employee = employee
        self._tool_registry = tool_registry
        self._gate = gate
        self._provider = provider
        self._dispatch_service = dispatch_service
        self._skill_registry = skill_registry
        self._spawn_subagent_service = spawn_subagent_service
        # Resolution chain (Track ζ): conversation override > employee default.
        # Kept as a separate field so tests can assert what the runner will
        # actually hit without reading employee state.
        self._model_ref_override = model_ref_override
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
        overrides: RunOverrides | None = None,
    ) -> AsyncIterator[AgentEvent]:
        from langchain_core.messages import (
            AIMessage,
            AIMessageChunk,
            HumanMessage,
            SystemMessage,
        )
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

        effective_model_ref = self._model_ref_override or self._employee.model_ref
        model = _build_model(effective_model_ref, self._provider, overrides)

        # Per-turn system override (overrides.system_override) is a prepend,
        # not a replace — the employee's skill descriptors + resolved
        # fragments must still be in scope for tool use. The override lands
        # first so the user's framing is the most salient instruction.
        system_parts: list[str] = []
        if overrides and overrides.system_override:
            override_text = overrides.system_override.strip()
            if override_text:
                system_parts.append(override_text)
        base_prompt = self._compose_system_prompt()
        if base_prompt:
            system_parts.append(base_prompt)
        system_prompt = "\n\n".join(system_parts).strip()

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
            # `stream_mode="messages"` is the only mode that gives per-token
            # deltas from the LLM (each chunk is an `AIMessageChunk`). The
            # alternatives — `updates` / `values` — emit completed messages
            # only, which means the UI would see "nothing, nothing, entire
            # paragraph at once". Token-level streaming is the whole point
            # of the chat surface.
            #
            # Each chunk is `(message, metadata)`. `metadata["langgraph_node"]`
            # tells us which graph node produced it — we only forward the
            # `agent` node's assistant output; `tools` node output is the
            # raw tool result, which is surfaced separately via the gate
            # pipeline (not as chat text).
            async for chunk in agent.astream(
                {"messages": lc_messages},
                config={"configurable": {"thread_id": thread_id}},
                stream_mode="messages",
            ):
                if not isinstance(chunk, tuple) or len(chunk) != 2:
                    continue
                msg, meta = chunk
                if not isinstance(meta, dict) or meta.get("langgraph_node") != "agent":
                    continue
                if not isinstance(msg, AIMessage | AIMessageChunk):
                    continue
                if not msg.content:
                    continue
                text_delta, thinking_delta = _split_content_blocks(msg.content)
                if thinking_delta:
                    yield ReasoningEvent(
                        message_id=message_id,
                        delta=thinking_delta,
                    )
                if text_delta:
                    yield TokenEvent(
                        message_id=message_id,
                        delta=text_delta,
                    )
            yield DoneEvent(message_id=message_id, reason="done")
        except Exception as exc:
            yield ErrorEvent(code="INTERNAL", message=str(exc))
            yield DoneEvent(message_id=message_id, reason="error")
