"""AgentRunner — ADR 0018 facade over AgentLoop.

Yields legacy AgentEvent stream for backward compatibility with the
existing chat_service tap and AG-UI encoder. Under the hood, all real
work happens in `agent_loop.AgentLoop`; this module:

  * AgentRunner (class) — public API + ctor matching current callers.
    `stream()` delegates to `_facade_stream` which iterates AgentLoop
    and projects InternalEvent → AgentEvent through `_LegacyProjector`.
  * Module-level helpers retained for reuse (mostly by AgentLoop):
    `_build_model`, `_apply_overrides`, `_bind_thinking`,
    `_split_content_blocks`, `_as_render_envelope`. B5 cleanup will
    move these into `agent_loop.py` / `model_factory.py` and delete
    runner.py outright.
  * `checkpointer` ctor kwarg accepted but no longer drives behavior —
    state lives in MessageRepo + ConfirmationRepo; ConfirmationDeferred
    handles suspend/resume via polling. B5 also removes this kwarg.

The legacy LangGraph implementation that previously lived here (~280
lines using `create_react_agent` + `AsyncSqliteSaver` + `interrupt()`)
was deleted in B3. ADR 0018 has the full migration story.
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING, Any

from allhands.config import get_settings
from allhands.core.conversation import RenderPayload, ToolCall, ToolCallStatus
from allhands.core.provider import LLMProvider
from allhands.core.run_overrides import RunOverrides
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
    UserInputRequiredEvent,
)
from allhands.execution.skills import (
    SkillRegistry,
    SkillRuntime,
    render_skill_descriptors,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

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


# --- ADR 0018 facade ---------------------------------------------------------
# AgentRunner.stream now delegates to AgentLoop and projects InternalEvent
# into the legacy AgentEvent stream the existing chat_service tap and AG-UI
# encoder consume. Single per-turn message_id so event correlation stays
# stable across tool-execution iterations within one stream call.


def _facade_stream(
    *,
    employee: Employee,
    tool_registry: ToolRegistry,
    gate: BaseGate,
    provider: LLMProvider | None,
    dispatch_service: DispatchService | None,
    skill_registry: SkillRegistry | None,
    runtime: SkillRuntime,
    spawn_subagent_service: SpawnSubagentService | None,
    model_ref_override: str | None,
    messages: list[dict[str, Any]],
    overrides: RunOverrides | None,
    plan_repo: Any = None,
    conversation_id: str = "",
    user_input_signal: Any = None,
    run_id: str | None = None,
) -> AsyncIterator[AgentEvent]:
    """Run the new AgentLoop, translate its InternalEvent stream into the
    legacy AgentEvent surface, yield. Async generator factory.
    """
    from allhands.execution.agent_loop import AgentLoop

    # ADR 0018: if the gate doubles as a DeferredSignal (PersistentConfirmationGate
    # does · BaseGate does NOT) hand it to AgentLoop as the confirmation_signal.
    # Falls back to None for AutoApproveGate / AutoRejectGate (test paths) — those
    # don't need to defer; AgentLoop's _permission_check returns Allow when no
    # signal is wired.
    # cast to DeferredSignal when the gate implements its protocol (duck-typed)
    from allhands.execution.deferred import DeferredSignal as _DefSig

    confirmation_signal: _DefSig | None = (
        gate  # type: ignore[assignment]
        if hasattr(gate, "publish") and hasattr(gate, "wait")
        else None
    )

    loop = AgentLoop(
        employee=employee,
        tool_registry=tool_registry,
        gate=gate,
        provider=provider,
        dispatch_service=dispatch_service,
        skill_registry=skill_registry,
        runtime=runtime,
        spawn_subagent_service=spawn_subagent_service,
        model_ref_override=model_ref_override,
        confirmation_signal=confirmation_signal,
        user_input_signal=user_input_signal,
        plan_repo=plan_repo,
        conversation_id=conversation_id,
        run_id=run_id,
    )

    async def _gen() -> AsyncIterator[AgentEvent]:
        projector = _LegacyProjector()
        # Forward the employee's stored max_iterations · AgentLoop's stream()
        # has its own default=10, which silently overrode whatever the user
        # configured. Reproducer: bump Lead Agent's max_iterations to 100 in
        # /employees/{id} → next turn still hits MAX_ITERATIONS at iter 11.
        async for ev in loop.stream(
            messages=messages,
            max_iterations=employee.max_iterations,
            overrides=overrides,
        ):
            for legacy in projector.project(ev):
                yield legacy

    return _gen()


class _LegacyProjector:
    """One projector per AgentRunner.stream call. Holds:
    * stable run_message_id for all TokenEvent / ReasoningEvent /
      DoneEvent so the chat_service tap can group them as one
      assistant message (matching the legacy single-message-per-turn
      contract).
    * tool_use metadata (name + args) keyed by id so ToolCallEndEvent
      can carry them when only the tool_use_id is on the wire.
    """

    def __init__(self) -> None:
        self.run_message_id: str = str(uuid.uuid4())
        self.tool_meta: dict[str, tuple[str, dict[str, Any]]] = {}

    def project(self, ev: Any) -> list[AgentEvent]:
        from allhands.core.conversation import ToolUseBlock
        from allhands.execution.internal_events import (
            AssistantMessageCommitted,
            AssistantMessagePartial,
            ConfirmationRequested,
            LoopExited,
            ToolMessageCommitted,
            UserInputRequested,
        )

        out: list[AgentEvent] = []
        if isinstance(ev, AssistantMessagePartial):
            if ev.text_delta:
                out.append(TokenEvent(message_id=self.run_message_id, delta=ev.text_delta))
            if ev.reasoning_delta:
                out.append(ReasoningEvent(message_id=self.run_message_id, delta=ev.reasoning_delta))
            return out
        if isinstance(ev, AssistantMessageCommitted):
            for block in ev.message.content_blocks:
                if isinstance(block, ToolUseBlock):
                    self.tool_meta[block.id] = (block.name, dict(block.input))
                    out.append(
                        ToolCallStartEvent(
                            tool_call=ToolCall(
                                id=block.id,
                                tool_id=block.name,
                                args=dict(block.input),
                                status=ToolCallStatus.RUNNING,
                            )
                        )
                    )
            return out
        if isinstance(ev, ToolMessageCommitted):
            tc_id = ev.message.tool_call_id or ""
            tool_name, tool_args = self.tool_meta.get(tc_id, ("", {}))
            # Message.content is declared str on the legacy schema, but the
            # tool_pipeline pushes structured payloads through model_copy
            # (success dict, error envelope). Treat as Any here for the
            # mypy narrowing that follows.
            content: Any = ev.message.content
            failed = isinstance(content, dict) and "error" in content
            error_text: str | None = None
            if failed and isinstance(content, dict):
                error_text = str(content.get("error"))
            out.append(
                ToolCallEndEvent(
                    tool_call=ToolCall(
                        id=tc_id,
                        tool_id=tool_name,
                        args=tool_args,
                        status=ToolCallStatus.FAILED if failed else ToolCallStatus.SUCCEEDED,
                        result=content,
                        error=error_text,
                    )
                )
            )
            envelope = _as_render_envelope(content) if isinstance(content, dict) else None
            if envelope is not None:
                out.append(
                    RenderEvent(
                        message_id=self.run_message_id,
                        payload=RenderPayload(**envelope),
                    )
                )
            return out
        if isinstance(ev, UserInputRequested):
            out.append(
                UserInputRequiredEvent(
                    user_input_id=ev.user_input_id,
                    tool_call_id=ev.tool_use_id,
                    questions=ev.questions,
                )
            )
            return out
        if isinstance(ev, ConfirmationRequested):
            out.append(
                InterruptEvent(
                    interrupt_id=ev.confirmation_id,
                    value={
                        "kind": "confirm_required",
                        "tool_call_id": ev.tool_use_id,
                        "summary": ev.summary,
                        "rationale": ev.rationale,
                        "diff": ev.diff,
                    },
                )
            )
            return out
        if isinstance(ev, LoopExited):
            if ev.reason != "completed":
                out.append(
                    ErrorEvent(
                        code=ev.reason.upper(),
                        message=ev.detail or ev.reason,
                    )
                )
                out.append(DoneEvent(message_id=self.run_message_id, reason="error"))
            else:
                out.append(DoneEvent(message_id=self.run_message_id, reason="done"))
            return out
        return out


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
        checkpointer: Any | None = None,  # accepted for back-compat; unused
        plan_repo: Any = None,
        conversation_id: str = "",
        user_input_signal: Any = None,
        run_id: str | None = None,
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
        # ADR 0019 C1 · plan tools · per-conversation AgentPlanRepo binding
        self._plan_repo = plan_repo
        self._conversation_id = conversation_id
        # ADR 0019 C3 · clarification signal forwarded to AgentLoop. None
        # = ask_user_question tool falls through Allow (no defer).
        self._user_input_signal = user_input_signal
        # 2026-04-25 v2 · per-turn run_id for artifact provenance binding.
        # ChatService mints it once per send_message and threads it down so
        # AgentLoop can stamp Artifact / ArtifactVersion rows.
        self._run_id = run_id

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
        """ADR 0018 facade · delegates to AgentLoop, projects internal
        events to the legacy AgentEvent stream existing chat_service /
        chat router consume.

        ``checkpointer``, ``thread_id``, and ``resume`` kwargs are
        accepted for backward compatibility but no longer drive
        behavior — state lives in MessageRepo + ConfirmationRepo and
        the polling ConfirmationDeferred handles suspend/resume. B5
        cleanup deletes these params entirely.
        """
        async for legacy_event in _facade_stream(
            employee=self._employee,
            tool_registry=self._tool_registry,
            gate=self._gate,
            provider=self._provider,
            dispatch_service=self._dispatch_service,
            skill_registry=self._skill_registry,
            runtime=self._runtime,
            spawn_subagent_service=self._spawn_subagent_service,
            model_ref_override=self._model_ref_override,
            messages=messages,
            overrides=overrides,
            plan_repo=self._plan_repo,
            conversation_id=self._conversation_id,
            user_input_signal=self._user_input_signal,
            run_id=self._run_id,
        ):
            yield legacy_event
        return
