"""ADR 0018 · AgentLoop · Claude-Code-style query loop.

Pure async generator. Each call to ``stream(messages)`` runs one chat
turn; the loop body iterates LLM round-trips while the most recent
assistant message contains tool_use blocks. Each iteration:

  1. astream the model · accumulate AIMessageChunk · emit
     AssistantMessagePartial as text/reasoning chunks arrive
  2. when the stream completes, build a terminal AssistantMessage
     (including any committed tool_use blocks) · emit
     AssistantMessageCommitted
  3. if no tool_uses → emit LoopExited(completed) and return
  4. else: partition tool_uses · execute via tool_pipeline · emit
     ToolMessageCommitted per result · append both assistant +
     tool_results to messages · loop

NO LangGraph. State = messages list + repos. Suspension = deferred
tools awaiting their signal.

Task 6: text-only turn.
Task 7 (this commit): while-true with tool execution + phantom defense.
Task 8: deferred (confirmation) flow.
Tasks 9-12: concurrency observable, max_iterations, skill/dispatch wiring.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
)
from langchain_core.messages import (
    ToolMessage as LCToolMessage,
)

from allhands.core import Tool, ToolScope
from allhands.core.conversation import (
    Message,
    ReasoningBlock,
    TextBlock,
    ToolUseBlock,
)
from allhands.execution.deferred import DeferredSignal
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    InternalEvent,
    LLMCallFinished,
    LoopExited,
    ToolMessageCommitted,
)
from allhands.execution.tool_pipeline import (
    Allow,
    Defer,
    Deny,
    PermissionDecision,
    ToolBinding,
    execute_tool_use_concurrent,
    execute_tool_use_iter,
    partition_tool_uses,
)

# Special-case meta-tool ids (mirrors runner.py constants — kept here so
# B5 cleanup can fully delete runner.py without breaking imports).
RESOLVE_SKILL_TOOL_ID = "allhands.meta.resolve_skill"
READ_SKILL_FILE_TOOL_ID = "allhands.meta.read_skill_file"
DISPATCH_TOOL_ID = "allhands.meta.dispatch_employee"
SPAWN_SUBAGENT_TOOL_ID = "allhands.meta.spawn_subagent"

if TYPE_CHECKING:
    from allhands.core import Employee
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry


# --- Module-level helpers ---------------------------------------------------


def _build_model(
    model_ref: str,
    provider: Any = None,
    overrides: Any = None,
    *,
    max_output_tokens: int | None = None,
) -> Any:
    """Bridge to the existing model factory in runner.py.

    B5 cleanup will move the helpers into a dedicated `model_factory`
    module and drop this re-export. Tests patch THIS symbol.
    """
    from allhands.execution.runner import _build_model as _impl

    return _impl(model_ref, provider, overrides, max_output_tokens=max_output_tokens)


def _split_content_blocks(content: Any) -> tuple[str, str]:
    """Normalize AIMessageChunk.content into (text_delta, reasoning_delta).

    LangChain adapters return content in two shapes:
      * str — OpenAI-style plain text
      * list[block] — provider-structured content with type-tagged blocks
        ("text" / "thinking" / "reasoning")

    Stringifying a list-of-blocks would leak the Python repr into the
    chat transcript. We route ``text`` to user-visible stream and
    ``thinking`` / ``reasoning`` to the dedicated reasoning channel.
    Unknown / tool_use / image_url blocks are ignored — those surface
    via accumulated.tool_calls or aren't user-facing chat.
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
            val = block.get(btype) or block.get("text")
            if isinstance(val, str):
                thinking_parts.append(val)
    return "".join(text_parts), "".join(thinking_parts)


def _now() -> datetime:
    return datetime.now(UTC)


def _serialize_for_lc_tool_message(content: Any) -> str:
    """LangChain ToolMessage requires content as str. Structured payloads
    (success dict, error envelope) JSON-encode here for the wire."""
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(content)


_ARTIFACT_HALLUC_PATTERNS = (
    "这是一个为你",
    "这是一个我",
    "这是一个交互式",
    "这是为你定制",
    "我已经为你",
    "我已为你",
    "我已经创建",
    "我为你创建",
    "i've created",
    "i have created",
    "here's the html",
    "here is the html",
    "以下是",
)


def _looks_like_artifact_hallucination(text: str) -> bool:
    """Heuristic: does this assistant text describe a 制品 as if just made?

    Used for the hallucination self-correction nudge in agent_loop.stream.
    Conservative on purpose · false positives cost one extra LLM iteration ·
    false negatives let the user see an empty artifact panel(我们见过一次)。
    """
    if not text:
        return False
    lower = text.lower()
    return any(p.lower() in lower for p in _ARTIFACT_HALLUC_PATTERNS)


def _is_valid_tool_call(tc: dict[str, Any], known_names: set[str]) -> bool:
    """A tool_call entry from accumulated.tool_calls is valid iff:

    1. id is non-empty (LangChain assigns ids per tool_call_chunk; a
       missing id signals an incomplete merge).
    2. name is non-empty AND present in ``known_names`` (i.e. exists in
       the active tool bindings for this turn).

    Phantom defense (multi-layer):
      * Test scenario `name="x"` not registered → dropped here.
      * gpt-4o-mini emits tool_call_chunks for a tool the model later
        abandons → accumulated.tool_calls may surface an entry with a
        real name but stale args → still passes; tool_pipeline's
        executor then receives the stale args, returns its own error
        envelope (no permanent pending — phantom becomes a recorded
        FAILED tool_message instead).
      * Hallucinated tool names → dropped here. The assistant turn
        commits without that tool_use; the LLM sees its own message in
        next-turn replay (no tool_use, no orphan).

    The ToolUseBlock in the committed AssistantMessage is the SOLE
    place a tool_use exists in our system — nothing committed = nothing
    to phantom-pending in the UI.
    """
    tid = tc.get("id")
    tname = tc.get("name")
    return bool(tid) and bool(tname) and tname in known_names


# --- AgentLoop --------------------------------------------------------------


_log = logging.getLogger(__name__)


def _make_tool_message_synthetic(*, tool_use_id: str, error: str) -> Message:
    """Build a synthetic tool_message used when the AgentLoop must surface
    a tool_use as failed without going through tool_pipeline (e.g. outer
    loop crashed mid-execution). The error envelope shape matches what
    tool_pipeline produces for caught executor exceptions, so downstream
    projection / persistence treat it identically.
    """
    from allhands.core.conversation import Message as _Msg

    base = _Msg(
        id=str(uuid.uuid4()),
        conversation_id="",
        role="tool",
        content="",
        tool_call_id=tool_use_id,
        created_at=_now(),
    )
    # tool_pipeline routes structured payloads via model_copy(update=...) too
    # — Message.content is declared str in the schema but downstream
    # projection / persistence accept dict envelopes by inspection. Mirror
    # that pattern instead of re-typing the field.
    return base.model_copy(update={"content": {"error": error}})


class AgentLoop:
    """Drives one or more LLM turns through a single conversation."""

    def __init__(
        self,
        employee: Employee,
        tool_registry: ToolRegistry,
        gate: BaseGate,
        # Future-proofing kwargs absorb everything AgentRunner passes
        # today so the B3 facade swap is mechanical. Implementations
        # land in subsequent tasks.
        provider: Any = None,
        dispatch_service: Any = None,
        skill_registry: Any = None,
        runtime: Any = None,
        spawn_subagent_service: Any = None,
        model_ref_override: str | None = None,
        confirmation_signal: DeferredSignal | None = None,
        user_input_signal: DeferredSignal | None = None,
        plan_repo: Any = None,
        conversation_id: str = "",
        run_id: str | None = None,
        max_output_tokens: int | None = None,
        **_unused: Any,
    ) -> None:
        self._employee = employee
        self._tool_registry = tool_registry
        self._gate = gate
        self._provider = provider
        self._dispatch_service = dispatch_service
        self._skill_registry = skill_registry
        self._runtime = runtime
        self._spawn_subagent_service = spawn_subagent_service
        self._model_ref_override = model_ref_override
        # ADR 0019 C1 · plan tools · plan_repo and conversation_id passed
        # in by ChatService when constructing the runner; None during
        # legacy unit-test paths means plan tools fall back to their
        # registry stubs (return empty / ignore).
        self._plan_repo = plan_repo
        self._conversation_id = conversation_id
        # 2026-04-25 · run_id is the per-turn identifier minted by chat_service.
        # Tools that produce persistent artefacts (artifact_create / update /
        # rollback) need it for provenance ("which run made this version") so
        # the audit trail and /artifacts page filters can answer "what came
        # out of run X".
        self._run_id = run_id
        # 2026-04-25 · per-model output cap. None = "use model default" (no
        # max_tokens forwarded). When ChatService resolves a per-model cap,
        # it threads it here and we bake it into the LLM ctor below so it
        # rides on every request payload (Anthropic ChatAnthropic.max_tokens
        # is also ctor-time only — bind() doesn't propagate, mirroring the
        # `thinking` field handling).
        self._max_output_tokens = max_output_tokens
        # Deferred suspend primitive used by _permission_check to gate
        # WRITE+ / requires_confirmation tool execution. None = legacy
        # auto-approve behaviour (matches old AutoApproveGate path);
        # production wiring (B3) injects a ConfirmationDeferred backed
        # by ConfirmationRepo.
        self._confirmation_signal = confirmation_signal
        # ADR 0019 C3 · clarification signal. None = ask_user_question
        # tools fall through to a straight Allow (the executor receives
        # an empty `answers` dict and echoes back).
        self._user_input_signal = user_input_signal

    # --- public stream ----------------------------------------------------

    async def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        max_iterations: int = 10,
        overrides: Any = None,
    ) -> AsyncIterator[InternalEvent]:
        """Run one chat turn. Yields preview + terminal events; the
        last event is always a LoopExited."""
        try:
            effective_model_ref = self._model_ref_override or self._employee.model_ref
            base_model = _build_model(
                effective_model_ref,
                self._provider,
                overrides,
                max_output_tokens=self._max_output_tokens,
            )
            lc_messages = self._build_lc_messages(messages, overrides)

            iteration = 0
            while True:
                iteration += 1
                if iteration > max_iterations:
                    yield LoopExited(reason="max_iterations")
                    return

                # 2026-04-25 (P2): rebuild bindings + tool list every
                # iteration. SkillRuntime can mutate during a turn (a
                # successful `resolve_skill` adds tool_ids to
                # ``runtime.resolved_skills``); the next iteration's
                # ``model.astream`` then sees the freshly-unlocked tools.
                # This is the Claude Code while-true contract — tool list
                # is a function of current state, not a build-time
                # constant. Cost: ~6ms per iteration (binding map + LangChain
                # bind_tools), invisible next to the LLM round-trip.
                bindings = self._build_bindings()
                lc_tools = self._build_lc_tools(bindings)
                model = (
                    base_model.bind_tools(lc_tools)
                    if lc_tools and hasattr(base_model, "bind_tools")
                    else base_model
                )

                message_id = str(uuid.uuid4())
                accumulated: AIMessageChunk | None = None
                llm_call_started_at = _now()

                async for chunk in model.astream(lc_messages):
                    if not isinstance(chunk, AIMessageChunk):
                        continue
                    accumulated = chunk if accumulated is None else accumulated + chunk
                    text_delta, reasoning_delta = _split_content_blocks(chunk.content)
                    if text_delta or reasoning_delta:
                        yield AssistantMessagePartial(
                            message_id=message_id,
                            text_delta=text_delta,
                            reasoning_delta=reasoning_delta,
                        )

                # Per-turn LLM telemetry. ``usage_metadata`` is populated by
                # LangChain when the provider returns it (OpenAI / Anthropic
                # / DashScope all do); we surface zeros for any provider that
                # doesn't, which the consumer treats as "unknown" rather than
                # a literal zero.
                _llm_duration_s = (_now() - llm_call_started_at).total_seconds()
                _usage = getattr(accumulated, "usage_metadata", None) or {}
                _input_tok = int(_usage.get("input_tokens", 0) or 0)
                _output_tok = int(_usage.get("output_tokens", 0) or 0)
                _total_tok = int(_usage.get("total_tokens", 0) or 0) or (_input_tok + _output_tok)
                yield LLMCallFinished(
                    message_id=message_id,
                    model_ref=effective_model_ref,
                    duration_s=_llm_duration_s,
                    input_tokens=_input_tok,
                    output_tokens=_output_tok,
                    total_tokens=_total_tok,
                )

                # Build terminal AssistantMessage from accumulated. This
                # is the protocol-level phantom defense: only valid
                # tool_calls (with id + name) become ToolUseBlocks.
                text_full, reasoning_full = (
                    _split_content_blocks(accumulated.content) if accumulated else ("", "")
                )
                # accumulated.tool_calls is list[ToolCall TypedDict]; coerce
                # to plain dicts so our filter signature stays stable across
                # LangChain version bumps.
                raw_tool_calls: list[dict[str, Any]] = (
                    [dict(tc) for tc in accumulated.tool_calls] if accumulated else []
                )
                known_names = set(bindings.keys())
                valid_tool_calls = [
                    tc for tc in raw_tool_calls if _is_valid_tool_call(tc, known_names)
                ]

                blocks: list[Any] = []
                if reasoning_full:
                    blocks.append(ReasoningBlock(text=reasoning_full))
                if text_full:
                    blocks.append(TextBlock(text=text_full))
                for tc in valid_tool_calls:
                    blocks.append(
                        ToolUseBlock(
                            id=str(tc["id"]),
                            name=str(tc["name"]),
                            input=dict(tc.get("args") or {}),
                        )
                    )

                assistant_msg = Message(
                    id=message_id,
                    conversation_id="",  # filled by chat_service tap
                    role="assistant",
                    content=text_full,
                    content_blocks=blocks,
                    created_at=_now(),
                )
                yield AssistantMessageCommitted(message=assistant_msg)

                tool_use_blocks = [b for b in blocks if isinstance(b, ToolUseBlock)]
                if not tool_use_blocks:
                    # Distinguish "model finished cleanly with a reply" from
                    # "model emitted nothing at all". The latter usually means
                    # the model tried to call a tool that doesn't exist (e.g.
                    # a stale skill referencing a de-registered tool id) and
                    # had its phantom tool_call dropped — leaving it with no
                    # text and no valid tool. Surfacing it as `empty_response`
                    # lets the UI show an error instead of going silent.
                    if not text_full.strip():
                        yield LoopExited(
                            reason="empty_response",
                            detail=(
                                "model produced no text and no tool calls — "
                                "this typically means a tool referenced by a "
                                "skill / prompt is not registered for this "
                                "employee, or the model ran out of ideas mid-turn"
                            ),
                        )
                    else:
                        # 2026-04-26 · 检测「制品幻觉」 — 模型在回复里描述
                        # 「这是一个 X / 我已经为你 X」 但本轮没调 artifact_create
                        # · 用户看不到任何东西。这一轮已经委身在 lc_messages
                        # 里 · 注入一句 system 反馈让模型下一轮纠正,而不是
                        # 直接 return completed。
                        if _looks_like_artifact_hallucination(text_full):
                            _log.warning(
                                "agent_loop.artifact_hallucination_detected",
                                extra={"sample": text_full[:200]},
                            )
                            lc_messages.append(self._to_lc_assistant_message(assistant_msg))
                            lc_messages.append(
                                SystemMessage(
                                    content=(
                                        "用户看不到任何制品 · 你的上一条回复描述了一个 "
                                        "HTML / 图表 / 文档,但你这一轮没有调用 "
                                        "artifact_create 工具。请立即调 "
                                        "artifact_create({kind, name, content}) 真正产出 · "
                                        "再调 artifact_render(id) 嵌入预览 · 然后用一两句话告诉用户。"
                                        "不要再次只说「这是一个...」 而不调工具。"
                                    )
                                )
                            )
                            continue  # next LLM iteration with the nudge
                        yield LoopExited(reason="completed")
                    return

                # Append assistant message (with tool_uses) to lc history
                # so the next LLM turn sees its own previous turn.
                lc_messages.append(self._to_lc_assistant_message(assistant_msg))

                # Execute tool_uses through the pipeline. Partition into
                # batches; each batch is either concurrent (read-only)
                # or serial (write/deferred). Within concurrent batches
                # we asyncio.gather; serial batches yield events during
                # execution (deferred path emits ConfirmationRequested).
                #
                # Track which tool_use ids have completed (received TMC)
                # so the outer except / finally can synthesize a TMC for
                # any tool that started but didn't finish — otherwise the
                # frontend stamps it `tool_call_dropped` at finalize time
                # and the user sees a confusing red "failed" envelope on
                # what was really an outer-loop crash.
                committed_tool_use_ids: set[str] = set()
                batches = partition_tool_uses(tool_use_blocks, bindings)
                try:
                    for batch in batches:
                        if batch.is_concurrent_safe and len(batch.blocks) > 1:
                            results = await asyncio.gather(
                                *[execute_tool_use_concurrent(b, bindings) for b in batch.blocks]
                            )
                            for tool_msg in results:
                                yield ToolMessageCommitted(message=tool_msg)
                                committed_tool_use_ids.add(tool_msg.tool_call_id or "")
                                lc_messages.append(self._to_lc_tool_message(tool_msg))
                        else:
                            for block in batch.blocks:
                                async for ev in execute_tool_use_iter(
                                    block, bindings, self._permission_check
                                ):
                                    yield ev
                                    if isinstance(ev, ToolMessageCommitted):
                                        committed_tool_use_ids.add(ev.message.tool_call_id or "")
                                        lc_messages.append(self._to_lc_tool_message(ev.message))
                except BaseException as inner_exc:
                    # Catches Exception AND CancelledError (BaseException).
                    # Synthesize a failure TMC for every tool_use the model
                    # asked for that didn't reach a TMC — without this the
                    # parent loop's outer `except` would swallow the failure
                    # AND the UI would never see tool_call_end for them.
                    for blk in tool_use_blocks:
                        if blk.id in committed_tool_use_ids:
                            continue
                        synthetic = _make_tool_message_synthetic(
                            tool_use_id=blk.id,
                            error=(
                                f"{type(inner_exc).__name__}: {inner_exc}"
                                if not isinstance(inner_exc, asyncio.CancelledError)
                                else "tool execution cancelled by upstream "
                                "(SSE drop / parent abort / inner sub-agent failure)"
                            ),
                        )
                        yield ToolMessageCommitted(message=synthetic)
                    # Re-raise so the outer try/except still records the
                    # LoopExited(aborted) sentinel (or unwinds asyncio
                    # cancellation if that's what we hit).
                    raise

                # Loop back to next LLM turn
        except GeneratorExit:
            raise
        except asyncio.CancelledError:
            # Surface cancellation as an aborted exit so the chat tap can
            # finalize repos, then re-raise so asyncio's cancel chain stays
            # intact.
            yield LoopExited(reason="aborted", detail="cancelled")
            raise
        except Exception as exc:
            yield LoopExited(
                reason="aborted",
                detail=f"{type(exc).__name__}: {exc}",
            )

    # --- helpers ----------------------------------------------------------

    def _active_tool_ids(self) -> list[str]:
        """Active tool ids for THIS turn. Mirrors runner.py:367-376.
        Task 11 will overlay skill-resolved tool ids; for Task 7 we
        use just the employee's base list."""
        active: list[str] = list(self._employee.tool_ids)
        if self._runtime is not None:
            for tids in getattr(self._runtime, "resolved_skills", {}).values():
                for tid in tids:
                    if tid not in active:
                        active.append(tid)
        return active

    def _build_bindings(self) -> dict[str, ToolBinding]:
        """Build name → ToolBinding map for tool_pipeline.

        Looks up each active tool_id in the registry; tools that
        aren't registered are silently dropped (the registry is the
        SoT for what executors exist).

        Special-case meta tools have stub executors in the registry
        (intentionally — they need per-turn services not available at
        registration time). Substitute the real executor here:

          * resolve_skill / read_skill_file → bound to skill_registry
            + per-conversation runtime
          * dispatch_employee → bound to dispatch_service
          * spawn_subagent → bound to spawn_subagent_service

        Mirrors runner.py:442-485. Tests for the executors themselves
        live in their own modules; here we only verify the binding
        substitution lands the right callable.
        """
        out: dict[str, ToolBinding] = {}
        for tool_id in self._active_tool_ids():
            try:
                tool, executor = self._tool_registry.get(tool_id)
            except KeyError:
                # A skill / employee config referenced a tool that is no
                # longer registered (e.g. deprecated render_plan). Log so
                # the operator can spot the stale reference instead of
                # debugging "agent goes silent" at the model layer.
                _log.warning(
                    "active tool_id %r is not registered; skipping. "
                    "If this came from a builtin skill, update its "
                    "tool_ids list.",
                    tool_id,
                )
                continue
            executor = self._maybe_substitute_executor(tool_id, executor)
            out[tool.name] = ToolBinding(tool=tool, executor=executor)
        return out

    def _maybe_substitute_executor(self, tool_id: str, default: Any) -> Any:
        """Replace the registry's stub for special meta tools with one
        bound to this turn's services. Returns the default executor
        unchanged if no substitution applies."""
        if tool_id == RESOLVE_SKILL_TOOL_ID and self._skill_registry is not None:
            from allhands.execution.tools.meta.resolve_skill import (
                make_resolve_skill_executor,
            )

            return make_resolve_skill_executor(
                employee=self._employee,
                runtime=self._runtime,
                skill_registry=self._skill_registry,
            )
        if tool_id == READ_SKILL_FILE_TOOL_ID and self._skill_registry is not None:
            from allhands.execution.tools.meta.skill_files import (
                make_read_skill_file_executor,
            )

            return make_read_skill_file_executor(
                runtime=self._runtime,
                skill_registry=self._skill_registry,
            )
        if tool_id == DISPATCH_TOOL_ID and self._dispatch_service is not None:
            return self._build_dispatch_executor()
        if tool_id == SPAWN_SUBAGENT_TOOL_ID and self._spawn_subagent_service is not None:
            from allhands.execution.tools.meta.spawn_subagent import (
                make_spawn_subagent_executor,
            )

            return make_spawn_subagent_executor(self._spawn_subagent_service)

        # ADR 0019 C1 (Round 1 redesign) · plan tools · single-tool atomic
        # replace, bound to per-conversation AgentPlanRepo.
        if self._plan_repo is not None and self._conversation_id:
            from allhands.execution.tools.meta.plan_executors import (
                UPDATE_PLAN_TOOL_ID,
                VIEW_PLAN_TOOL_ID,
                make_update_plan_executor,
                make_view_plan_executor,
            )

            if tool_id == UPDATE_PLAN_TOOL_ID:
                return make_update_plan_executor(
                    repo=self._plan_repo,
                    conversation_id=self._conversation_id,
                    employee_id=self._employee.id,
                )
            if tool_id == VIEW_PLAN_TOOL_ID:
                return make_view_plan_executor(
                    repo=self._plan_repo,
                    conversation_id=self._conversation_id,
                )

        # 2026-04-25 v2 · artifact provenance binding. Artifact create/update/
        # rollback executors carry conversation_id / employee_id / run_id so
        # the produced artifact / version row points back at the chat turn
        # that produced it. The /artifacts page filters on these. Without
        # substitution they fall back to the registry's bare-bones executor
        # (workspace-scoped, no provenance) — still works, just orphaned.
        if tool_id in (
            "allhands.artifacts.create",
            "allhands.artifacts.create_pdf",
            "allhands.artifacts.create_xlsx",
            "allhands.artifacts.create_csv",
            "allhands.artifacts.create_docx",
            "allhands.artifacts.create_pptx",
            "allhands.artifacts.render_drawio",
            "allhands.artifacts.update",
            "allhands.artifacts.rollback",
        ):
            from allhands.execution.tools.meta.executors import (
                make_artifact_create_csv_executor,
                make_artifact_create_docx_executor,
                make_artifact_create_executor,
                make_artifact_create_pdf_executor,
                make_artifact_create_pptx_executor,
                make_artifact_create_xlsx_executor,
                make_artifact_rollback_executor,
                make_artifact_update_executor,
                make_render_drawio_executor,
            )
            from allhands.persistence.db import get_sessionmaker

            maker = get_sessionmaker()
            kwargs = {
                "conversation_id": self._conversation_id or None,
                "employee_id": self._employee.id,
                "run_id": self._run_id,
            }
            office_factories = {
                "allhands.artifacts.create": make_artifact_create_executor,
                "allhands.artifacts.create_pdf": make_artifact_create_pdf_executor,
                "allhands.artifacts.create_xlsx": make_artifact_create_xlsx_executor,
                "allhands.artifacts.create_csv": make_artifact_create_csv_executor,
                "allhands.artifacts.create_docx": make_artifact_create_docx_executor,
                "allhands.artifacts.create_pptx": make_artifact_create_pptx_executor,
                "allhands.artifacts.render_drawio": make_render_drawio_executor,
                "allhands.artifacts.update": make_artifact_update_executor,
                "allhands.artifacts.rollback": make_artifact_rollback_executor,
            }
            factory = office_factories.get(tool_id)
            if factory is not None:
                return factory(maker, **kwargs)

        return default

    def _build_dispatch_executor(self) -> Any:
        """The dispatch executor closes over self._dispatch_service.
        Defined as a method so the closure has a clean reference; the
        same shape as runner.py:_make_dispatch_executor."""
        dispatch_service = self._dispatch_service

        async def _dispatch(
            employee_id: str,
            task: str,
            context_refs: list[str] | None = None,
            timeout_seconds: int = 300,
        ) -> dict[str, Any]:
            assert dispatch_service is not None  # _maybe_substitute guard
            result = await dispatch_service.dispatch(
                employee_id=employee_id,
                task=task,
                context_refs=context_refs,
                timeout_seconds=timeout_seconds,
            )
            dumped = result.model_dump()
            return dict(dumped) if isinstance(dumped, dict) else {"result": dumped}

        return _dispatch

    def _build_lc_tools(self, bindings: dict[str, ToolBinding]) -> list[Any]:
        """Build LangChain StructuredTool wrappers for `model.bind_tools`.

        These wrappers carry the schema the LLM sees · execution still
        flows through tool_pipeline (binding.executor), NOT through
        LangChain's tool node. Tests with fake models can pass empty
        because their bind_tools() is a no-op.

        Skill / dispatch / subagent specials land in Task 11 — for now
        the wrappers are direct executor passthroughs.
        """
        try:
            from langchain_core.tools import StructuredTool
        except ImportError:
            return []

        out: list[Any] = []
        for binding in bindings.values():
            try:
                lc = StructuredTool.from_function(
                    coroutine=binding.executor,
                    name=binding.tool.name,
                    description=binding.tool.description,
                )
            except Exception:
                # Schema derivation can fail for executors with `**kwargs`
                # signatures; skip — the bindings dict still has the
                # entry so the pipeline can execute, just not via LLM
                # auto-call.
                continue
            out.append(lc)
        return out

    def _compose_system_prompt(self, overrides: Any = None) -> str:
        """Build the per-turn system prompt: employee base + skill
        descriptors + resolved skill fragments + optional override.

        Mirrors runner.py:_compose_system_prompt but accepts overrides
        directly so the loop body doesn't need to peek at AgentLoop
        internals. Override prepends; descriptors are pure-function
        rebuilt every turn (ADR 0011 principle 3).
        """
        parts: list[str] = []
        # Per-turn override prepends — it's the most salient framing
        if overrides is not None:
            override_text = (getattr(overrides, "system_override", None) or "").strip()
            if override_text:
                parts.append(override_text)
        base = (self._employee.system_prompt or "").strip()
        if base:
            parts.append(base)
        if self._runtime is not None:
            descriptors = getattr(self._runtime, "skill_descriptors", None)
            if descriptors:
                from allhands.execution.skills import render_skill_descriptors

                parts.append(render_skill_descriptors(descriptors))
            fragments = getattr(self._runtime, "resolved_fragments", None)
            if fragments:
                parts.append("\n\n".join(fragments))
        return "\n\n".join(parts).strip()

    def _build_lc_messages(
        self,
        messages: list[dict[str, Any]],
        overrides: Any = None,
    ) -> list[Any]:
        """Project chat history dicts into LangChain message instances.

        Faithful reconstruction matters for multi-turn tool replay:
        Anthropic rejects a transcript with `assistant(tool_use)` not
        followed by `tool_result`. We rebuild AIMessage(tool_calls=[...])
        when the history dict has tool_calls, and ToolMessage when the
        role is 'tool'.
        """
        lc_messages: list[Any] = []
        system_prompt = self._compose_system_prompt(overrides)
        if system_prompt:
            lc_messages.append(SystemMessage(content=system_prompt))
        for m in messages:
            role = m.get("role")
            content = m.get("content", "")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                tool_calls = m.get("tool_calls") or []
                # Pass through structured tool_calls if present
                if tool_calls:
                    lc_messages.append(AIMessage(content=content, tool_calls=tool_calls))
                else:
                    lc_messages.append(AIMessage(content=content))
            elif role == "tool":
                tc_id = m.get("tool_call_id") or ""
                lc_messages.append(LCToolMessage(content=str(content), tool_call_id=str(tc_id)))
            # 'system' role from history is rare — system prompt comes
            # from employee.system_prompt at the top of the list
        return lc_messages

    def _to_lc_assistant_message(self, msg: Message) -> AIMessage:
        """Project our AssistantMessage onto LangChain AIMessage for the
        next-turn replay. tool_use blocks become tool_calls dicts."""
        tool_calls = []
        for block in msg.content_blocks:
            if isinstance(block, ToolUseBlock):
                tool_calls.append({"id": block.id, "name": block.name, "args": block.input})
        return AIMessage(content=msg.content, tool_calls=tool_calls)

    def _to_lc_tool_message(self, msg: Message) -> LCToolMessage:
        return LCToolMessage(
            content=_serialize_for_lc_tool_message(msg.content),
            tool_call_id=msg.tool_call_id or "",
        )

    def _permission_check(
        self,
        block: ToolUseBlock,
        tool: Tool,
    ) -> PermissionDecision:
        """Permission decision for one tool_use.

        Currently:
          * WRITE / IRREVERSIBLE / BOOTSTRAP scope ∧ requires_confirmation
            ∧ confirmation_signal wired → Defer (suspend, ask user)
          * everything else → Allow

        Future extensions plug in here:
          * plan mode → Deny when conversation_mode == 'plan' and tool is
            mutator
          * clarification → Defer with UserInputDeferred when tool is
            an ask_user_question
          * sub-agent → executor itself does the recursion; the pipeline
            doesn't need to defer at this layer
        """
        # ADR 0019 C3 · clarification path runs BEFORE the confirmation
        # check. ask_user_question is ToolScope.READ + requires_user_input,
        # so it would otherwise fall through to Allow.
        if getattr(tool, "requires_user_input", False) and self._user_input_signal is not None:
            raw_questions = block.input.get("questions") or []
            questions_list: list[Any] = (
                list(raw_questions) if isinstance(raw_questions, list) else []
            )
            return Defer(
                signal=self._user_input_signal,
                publish_kwargs={
                    "tool_use_id": block.id,
                    "questions": questions_list,
                },
            )

        needs_confirm = (
            tool.scope
            in (
                ToolScope.WRITE,
                ToolScope.IRREVERSIBLE,
                ToolScope.BOOTSTRAP,
            )
            and tool.requires_confirmation
        )
        if needs_confirm and self._confirmation_signal is not None:
            return Defer(
                signal=self._confirmation_signal,
                publish_kwargs={
                    "tool_use_id": block.id,
                    "summary": f"Execute {tool.name} with args: {block.input}",
                    "rationale": f"Tool {tool.name!r} requires confirmation.",
                },
            )
        # No signal wired (test path / read-only) → straight allow.
        # Deny is only used by future plan-mode hooks.
        _ = Deny  # keep import live for future extension
        return Allow()


__all__ = ["AgentLoop"]
