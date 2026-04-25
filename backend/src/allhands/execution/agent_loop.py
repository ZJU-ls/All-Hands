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

Task 6 (this commit): text-only turns only. Task 7 will add the
tool execution branch.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage

from allhands.core.conversation import Message, ReasoningBlock, TextBlock
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    InternalEvent,
    LoopExited,
)

if TYPE_CHECKING:
    from allhands.core import Employee
    from allhands.execution.gate import BaseGate
    from allhands.execution.registry import ToolRegistry


# --- Module-level helpers ---------------------------------------------------


def _build_model(
    model_ref: str,
    provider: Any = None,
    overrides: Any = None,
) -> Any:
    """Bridge to the existing model factory in runner.py.

    B5 cleanup will move the helpers into a dedicated `model_factory`
    module and drop this re-export. Tests patch THIS symbol.
    """
    from allhands.execution.runner import _build_model as _impl

    return _impl(model_ref, provider, overrides)


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
    via accumulated.tool_calls (Task 7) or aren't user-facing chat.
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


# --- AgentLoop --------------------------------------------------------------


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

    async def stream(
        self,
        messages: list[dict[str, Any]],
        *,
        max_iterations: int = 10,
        overrides: Any = None,
    ) -> AsyncIterator[InternalEvent]:
        """Run one chat turn. Yields preview + terminal events; the
        last event is always a LoopExited.

        Task 6 scope: text-only turns. Task 7 extends this method
        with the while-true tool execution branch.
        """
        try:
            effective_model_ref = self._model_ref_override or self._employee.model_ref
            model = _build_model(effective_model_ref, self._provider, overrides)
            lc_messages = self._build_lc_messages(messages)

            message_id = str(uuid.uuid4())
            accumulated: AIMessageChunk | None = None

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

            # Build terminal AssistantMessage. Task 6 only handles text +
            # reasoning blocks; Task 7 adds tool_use blocks from
            # accumulated.tool_calls.
            text_full, reasoning_full = (
                _split_content_blocks(accumulated.content) if accumulated else ("", "")
            )
            blocks: list[Any] = []
            if reasoning_full:
                blocks.append(ReasoningBlock(text=reasoning_full))
            if text_full:
                blocks.append(TextBlock(text=text_full))

            msg = Message(
                id=message_id,
                conversation_id="",  # filled by chat_service tap on persistence
                role="assistant",
                content=text_full,
                content_blocks=blocks,
                created_at=_now(),
            )
            yield AssistantMessageCommitted(message=msg)
            yield LoopExited(reason="completed")
        except GeneratorExit:
            raise
        except Exception as exc:
            yield LoopExited(
                reason="aborted",
                detail=f"{type(exc).__name__}: {exc}",
            )

    def _build_lc_messages(self, messages: list[dict[str, Any]]) -> list[Any]:
        """Project chat history dicts (user / assistant / tool / system
        roles) into LangChain message instances. Task 7 adds AIMessage
        + ToolMessage handling for multi-turn replay; Task 6 handles
        only system + user."""
        lc_messages: list[Any] = []
        if self._employee.system_prompt:
            lc_messages.append(SystemMessage(content=self._employee.system_prompt))
        for m in messages:
            role = m.get("role")
            content = m.get("content", "")
            if role == "user":
                lc_messages.append(HumanMessage(content=content))
            # assistant / tool branches added in Task 7
        return lc_messages


__all__ = ["AgentLoop"]
