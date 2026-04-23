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

import json
import uuid
from typing import TYPE_CHECKING, Any

from allhands.config import get_settings
from allhands.core.conversation import RenderPayload, ToolCall, ToolCallStatus
from allhands.core.provider import LLMProvider
from allhands.core.run_overrides import RunOverrides
from allhands.core.tool import ToolScope
from allhands.execution.events import (
    AgentEvent,
    DoneEvent,
    ErrorEvent,
    InterruptEvent,
    ReasoningEvent,
    RenderEvent,
    TokenEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from allhands.execution.skills import (
    SkillRegistry,
    SkillRuntime,
    render_skill_descriptors,
)
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor
from allhands.execution.tools.meta.skill_files import make_read_skill_file_executor
from allhands.execution.tools.meta.spawn_subagent import make_spawn_subagent_executor

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from langgraph.checkpoint.base import BaseCheckpointSaver

    from allhands.core import Employee
    from allhands.execution.dispatch import DispatchService
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools.meta.spawn_subagent import SpawnSubagentService


DISPATCH_TOOL_ID = "allhands.meta.dispatch_employee"
READ_SKILL_FILE_TOOL_ID = "allhands.meta.read_skill_file"
RESOLVE_SKILL_TOOL_ID = "allhands.meta.resolve_skill"
SPAWN_SUBAGENT_TOOL_ID = "allhands.meta.spawn_subagent"


def _coerce_stringified_json(kwargs: dict[str, Any]) -> dict[str, Any]:
    """Recover nested object/array args that the LLM serialized as JSON strings.

    Some providers (and some models on fuzzy tool-use training) flatten nested
    object / array arguments to a single JSON-encoded string instead of sending
    a structured value. Pydantic v2 in lax mode does NOT auto-parse `str → dict`
    or `str → list`, so the tool call blows up with `ToolInvocationError` at
    `_parse_input`. This walker rescues any `str` value that parses to a `dict`
    or `list`, leaves everything else untouched.

    Real-world trigger: `render_stat` called with `delta='{"value": 2, ...}'`
    instead of `delta={"value": 2, ...}`; `render_bar_chart` with `bars='[...]'`.
    Regression: `test_runner_coerce_stringified_json.py`.
    """
    out: dict[str, Any] = {}
    for k, v in kwargs.items():
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith(("{", "[")):
                try:
                    parsed = json.loads(stripped)
                except (ValueError, TypeError):
                    parsed = None
                if isinstance(parsed, (dict, list)):
                    out[k] = parsed
                    continue
        out[k] = v
    return out


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
    # ``thinking`` must be baked at ctor time for anthropic kind (bind
    # doesn't propagate — see llm_factory.build_llm docstring / E18). For
    # openai kind it's applied later via extra_body in _apply_overrides.
    thinking_for_ctor: bool | None = None
    if provider is not None and provider.kind == "anthropic" and overrides is not None:
        thinking_for_ctor = overrides.thinking

    if provider is not None:
        from allhands.execution.llm_factory import build_llm

        model = build_llm(provider, model_ref, thinking=thinking_for_ctor)
        return _apply_overrides(model, overrides, provider_kind=provider.kind)

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
    return _apply_overrides(ChatOpenAI(**kwargs), overrides, provider_kind="openai")


def _parse_tool_message_content(content: Any) -> Any:
    """Decode a ToolMessage.content payload.

    LangGraph's ToolNode stringifies non-str tool results to JSON before
    stashing them on ``ToolMessage.content``. We reverse that so render
    envelopes survive the round trip; fall back to the raw value when it
    isn't JSON (dict / list already-parsed, or a plain string result).
    """
    if isinstance(content, (dict, list)):
        return content
    if isinstance(content, str):
        stripped = content.strip()
        if stripped.startswith(("{", "[")):
            try:
                return json.loads(stripped)
            except (ValueError, TypeError):
                return content
        return content
    return content


def _as_render_envelope(result: Any) -> dict[str, Any] | None:
    """Return the {component, props, interactions} envelope or None.

    Render tools (ToolKind.RENDER) emit this shape. The runner forwards it
    to the SSE layer as a RenderEvent so the frontend's component registry
    can dispatch the payload into its React component. Detection is
    duck-typed on the result shape — the render-tool contract is "return
    an envelope" regardless of which tool produced it, so a BACKEND tool
    that happens to return the same shape (e.g. create_employee) also
    renders, which matches the current intent.
    """
    if not isinstance(result, dict):
        return None
    component = result.get("component")
    if not isinstance(component, str) or not component:
        return None
    props = result.get("props", {})
    if not isinstance(props, dict):
        return None
    interactions = result.get("interactions", [])
    if not isinstance(interactions, list):
        interactions = []
    return {"component": component, "props": props, "interactions": interactions}


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


def _bind_thinking(bind_kwargs: dict[str, Any], thinking: bool, provider_kind: str) -> None:
    """Add the per-turn thinking toggle to bind_kwargs for OpenAI-compat adapters.

    Provider-kind dispatch (verified end-to-end via curl — E18):

    - ``anthropic`` kind (Anthropic Messages API + DashScope
      ``/apps/anthropic`` compat proxy for Qwen3): the ``thinking`` field
      is a Pydantic ctor param on ``ChatAnthropic`` read at payload-build
      time; ``.bind(thinking=...)`` does NOT propagate. It's already baked
      in at ``_build_model`` via ``build_llm(thinking=...)``. Nothing to
      do here — **skip**.
    - ``openai`` / ``aliyun`` / fallback (OpenAI-compatible wire):
      ``extra_body={"enable_thinking": bool}`` rides along the OpenAI
      request body as a pass-through. DashScope's OpenAI-compat endpoint
      and Qwen3 native mode both honour it; providers that don't
      understand it silently drop it (matches "inherit default on None"
      semantics on :class:`RunOverrides`).

    Earlier bug (E17 · 2026-04-21 first attempt): we only dispatched the
    OpenAI-compat shape for all kinds, so ``thinking=False`` on an
    anthropic-kind provider did **nothing** and the user still saw reasoning
    chunks. Second attempt used ``.bind(thinking=...)`` on ChatAnthropic
    expecting kwargs to merge into the payload — but ChatAnthropic reads
    ``self.thinking`` directly, so bind was dropped. Confirmed by curl trace
    showing 146 reasoning chunks with ``thinking: false``. Final fix: bake
    into ctor in ``build_llm``; this function handles only OpenAI-compat.
    """
    if provider_kind == "anthropic":
        # Already baked in at ctor (see _build_model + build_llm). If we
        # tried to also bind it here it'd land on a RunnableBinding's
        # kwargs but never reach ChatAnthropic._get_request_payload.
        return
    # openai / aliyun / unknown → OpenAI-compat body
    bind_kwargs["extra_body"] = {"enable_thinking": thinking}


def _apply_overrides(
    model: Any,
    overrides: RunOverrides | None,
    *,
    provider_kind: str = "openai",
) -> Any:
    """Fold per-turn knobs onto a freshly-built chat model.

    LangChain chat models expose ``.bind(**kwargs)`` which returns a
    runnable with the kwargs merged into every downstream call. We use it
    instead of rebuilding the model with different constructor args because
    some knobs aren't constructor parameters on every adapter — bind passes
    them through as call-time kwargs where the adapter will forward them
    into its HTTP request body. Providers that don't understand a key
    silently ignore it, which matches the "inherit default on None"
    contract on :class:`RunOverrides`.

    ``provider_kind`` is plumbed from ``_build_model`` so thinking can pick
    the right wire shape per provider — see :func:`_bind_thinking`.
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
        _bind_thinking(bind_kwargs, overrides.thinking, provider_kind)

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
        checkpointer: BaseCheckpointSaver[Any] | None = None,
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
        # ADR 0014 · graph-internal state persistence. None = keep v0 pure-function
        # behavior (chat history is the sole SoT via MessageRepo). When provided,
        # LangGraph persists per-turn graph state keyed on thread_id so interrupt /
        # tool-pending / subagent intermediate state can resume across uvicorn
        # restarts. MessageRepo remains the user-visible ledger (ADR 0014 R2);
        # this is **only** for graph-internal state.
        self._checkpointer = checkpointer

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
        resume: dict[str, Any] | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """Drive one turn (or a resume) of the agent.

        ``resume`` is the ADR 0014 Phase 3 lever: when set, the runner
        invokes the graph with ``Command(resume=resume["value"])`` under
        ``thread_id`` and the checkpointer picks up from wherever the prior
        invocation paused (a ``interrupt()`` call in a tool / node).
        ``messages`` is ignored in that case — the graph state already has
        its messages from the pre-pause checkpoint. ``resume`` requires a
        ``checkpointer`` on the runner; without one the Command has nothing
        to resume.
        """
        from langchain_core.messages import (
            AIMessage,
            AIMessageChunk,
            HumanMessage,
        )
        from langchain_core.tools import StructuredTool
        from langgraph.prebuilt import create_react_agent
        from langgraph.types import Command

        class _CoercingStructuredTool(StructuredTool):
            """Override `_parse_input` so we coerce stringified-JSON nested
            args back to structured values before Pydantic validates. See
            `_coerce_stringified_json` for the failure mode this rescues.
            """

            def _parse_input(self, tool_input: Any, tool_call_id: str | None) -> Any:
                if isinstance(tool_input, dict):
                    tool_input = _coerce_stringified_json(tool_input)
                return super()._parse_input(tool_input, tool_call_id)

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
                    _CoercingStructuredTool.from_function(
                        coroutine=executor,
                        name=tool.name,
                        description=tool.description,
                    )
                )
                continue

            if tool_id == READ_SKILL_FILE_TOOL_ID and self._skill_registry is not None:
                executor = make_read_skill_file_executor(
                    runtime=self._runtime,
                    skill_registry=self._skill_registry,
                )
                lc_tools.append(
                    _CoercingStructuredTool.from_function(
                        coroutine=executor,
                        name=tool.name,
                        description=tool.description,
                    )
                )
                continue

            if tool_id == DISPATCH_TOOL_ID and self._dispatch_service is not None:
                lc_tools.append(
                    _CoercingStructuredTool.from_function(
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

                lc_tool = _CoercingStructuredTool.from_function(
                    coroutine=_make_gated(_tool, _executor),
                    name=tool.name,
                    description=tool.description,
                )
            else:
                _executor2 = executor
                lc_tool = _CoercingStructuredTool.from_function(
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

        # The system prompt goes through `create_react_agent(prompt=...)` below
        # so LangGraph prepends it at model-call time rather than storing it as
        # a message in graph state. With `checkpointer=` enabled (ADR 0014
        # default-on) and `add_messages` as the reducer, putting `SystemMessage`
        # in the input `messages` channel caused it to accumulate across turns
        # at non-consecutive positions (one per turn) — providers validating
        # message order (e.g. Qwen/OpenAI-compatible) reject with
        # "Received multiple non-consecutive system messages" (see E26).
        lc_messages: list[Any] = [
            HumanMessage(content=m["content"])
            if m["role"] == "user"
            else AIMessage(content=m["content"])
            for m in messages
            if m["role"] in ("user", "assistant")
        ]

        from langchain_core.messages import ToolMessage

        # Per-turn bookkeeping so tool_call lifecycle events stay in sync
        # with LangGraph's node stream:
        # - agent-node chunks may expose `tool_calls` as the LLM decides;
        #   we emit ToolCallStartEvent the first time each id appears so
        #   the UI can stamp a pending ToolCallCard.
        # - tools-node chunks emit ToolMessage on completion; we close the
        #   pair with ToolCallEndEvent and, when the result is a render
        #   envelope, also yield a RenderEvent so the frontend's
        #   component registry renders the Viz.* component inline.
        seen_tool_call_ids: set[str] = set()
        tool_call_by_id: dict[str, dict[str, Any]] = {}
        try:
            # ADR 0014 · checkpointer is None in v0-compat mode (MessageRepo is
            # the sole SoT). With a checkpointer, LangGraph snapshots the graph
            # state per node transition under thread_id — enabling Phase 3/4
            # interrupt() + resume. The runner never reads back from the
            # checkpointer directly; that's LangGraph's responsibility when the
            # same thread_id is re-invoked.
            # `prompt=` is the LangGraph-idiomatic way to inject the system
            # message: it's prepended at model-call time and never persisted
            # into the message channel, so the checkpointer can't accumulate
            # duplicates across turns (E26). `_compose_system_prompt()` is
            # evaluated fresh every `runner.stream()` call (principle 3.3
            # Pure-Function Query Loop), so skill activations that happened
            # on earlier turns are reflected in later turns' prompts.
            agent = create_react_agent(
                model,
                lc_tools,
                checkpointer=self._checkpointer,
                prompt=system_prompt or None,
            )
            # ADR 0014 · Phase 3 — multi-mode streaming.
            # - "messages" gives per-token deltas (AIMessageChunk tuples) —
            #   the only mode that supports token-level streaming for the
            #   chat UX. Alternatives emit completed messages only.
            # - "updates" surfaces ``{"__interrupt__": (Interrupt(...),)}``
            #   when a node calls ``interrupt()``. Without subscribing to
            #   updates, the graph pauses silently and the UI has no way to
            #   know a human decision is needed. Plain state updates from
            #   nodes also come through this channel — we filter those out.
            #
            # Each chunk is ``(mode, payload)``. We dispatch by mode to the
            # existing message-parsing logic or the new interrupt-emission
            # path.
            #
            # Phase 3 · resume: when the caller passes ``resume=...`` we
            # hand ``Command(resume=resume["value"])`` to astream instead
            # of a new messages dict. LangGraph uses the checkpointer to
            # recover where ``interrupt()`` was paused.
            agent_input: Any
            if resume is not None:
                agent_input = Command(resume=resume.get("value"))
            else:
                agent_input = {"messages": lc_messages}
            async for stream_chunk in agent.astream(
                agent_input,
                config={"configurable": {"thread_id": thread_id}},
                stream_mode=["messages", "updates"],
            ):
                if not (isinstance(stream_chunk, tuple) and len(stream_chunk) == 2):
                    continue
                mode, payload = stream_chunk

                if mode == "updates":
                    # Interrupt marker is the only signal in "updates" we
                    # care about — regular node state transitions are
                    # redundant with the per-token stream. Each interrupt
                    # carries an id that stays stable across the pause so
                    # the frontend can match a later resume to the right
                    # suspension (§ ADR 0014 Phase 3 R4).
                    if not isinstance(payload, dict):
                        continue
                    interrupts = payload.get("__interrupt__")
                    if interrupts:
                        for itr in interrupts:
                            itr_id = getattr(itr, "id", "") or ""
                            raw_value = getattr(itr, "value", None)
                            value_dict: dict[str, object]
                            if isinstance(raw_value, dict):
                                value_dict = dict(raw_value)
                            else:
                                value_dict = {"value": raw_value}
                            yield InterruptEvent(
                                interrupt_id=itr_id,
                                value=value_dict,
                            )
                    continue

                # Everything below is mode == "messages".
                if not (isinstance(payload, tuple) and len(payload) == 2):
                    continue
                msg, meta = payload
                node = meta.get("langgraph_node") if isinstance(meta, dict) else None

                if node == "agent":
                    if not isinstance(msg, AIMessage | AIMessageChunk):
                        continue
                    if msg.content:
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
                    # LLM may stream tool_calls across several chunks; the
                    # final chunk carries the consolidated list. Emit
                    # ToolCallStart the first time we see each id so the
                    # UI can paint a pending card before the tool runs.
                    raw_tcs = getattr(msg, "tool_calls", None) or []
                    for tc in raw_tcs:
                        tc_id = tc.get("id") if isinstance(tc, dict) else None
                        if not tc_id or tc_id in seen_tool_call_ids:
                            continue
                        seen_tool_call_ids.add(tc_id)
                        name = tc.get("name") or ""
                        args = tc.get("args") or {}
                        tool_call_by_id[tc_id] = {"name": name, "args": args}
                        yield ToolCallStartEvent(
                            tool_call=ToolCall(
                                id=tc_id,
                                tool_id=name,
                                args=args,
                                status=ToolCallStatus.RUNNING,
                            )
                        )
                    continue

                if node == "tools" and isinstance(msg, ToolMessage):
                    tc_id = getattr(msg, "tool_call_id", None) or ""
                    result = _parse_tool_message_content(msg.content)
                    meta_tc = tool_call_by_id.get(tc_id, {})
                    tool_name = meta_tc.get("name") or getattr(msg, "name", "") or ""
                    tool_args = meta_tc.get("args") or {}
                    yield ToolCallEndEvent(
                        tool_call=ToolCall(
                            id=tc_id,
                            tool_id=tool_name,
                            args=tool_args,
                            status=ToolCallStatus.SUCCEEDED,
                            result=result,
                        )
                    )
                    envelope = _as_render_envelope(result)
                    if envelope is not None:
                        yield RenderEvent(
                            message_id=message_id,
                            payload=RenderPayload(**envelope),
                        )
                    continue
            yield DoneEvent(message_id=message_id, reason="done")
        except Exception as exc:
            yield ErrorEvent(code="INTERNAL", message=str(exc))
            yield DoneEvent(message_id=message_id, reason="error")
