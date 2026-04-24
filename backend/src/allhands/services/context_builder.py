"""ADR 0017 · build_llm_context · pure projection from event log to LLM input.

This is the Claude Code ``normalizeMessagesForAPI`` equivalent
(ref-src-claude/V02 § 2.4). Takes the conversation's event log + runtime
state and returns what the LLM should see for THIS turn:

    build_llm_context(conversation_id, employee, runtime, event_repo, ...)
        -> (system_prompt: str, messages: list[dict])

Pure function: same inputs → same outputs, no writes, no I/O besides the
event repo read.

The projection logic handles:

- USER event          → ``{"role": "user", "content": ..., "id": ...}``
- ASSISTANT (plain)   → ``{"role": "assistant", "content": ..., "id": ...}``
- ASSISTANT (blocks)  → content is a list of content_blocks (incl. tool_use)
- TOOL_CALL_EXECUTED  → ``{"role": "tool", "tool_call_id": ..., "content": ...}``
- SUMMARY             → prepended as a synthetic user message reminding the
                        model of prior conversation (Claude pattern)
- SYSTEM              → concatenated into the system_prompt tail
- TURN_ABORTED        → projected to a synthetic assistant message that tells
                        the LLM what happened (user_superseded → "you were
                        interrupted", stream_error → "I got cut off", etc.).
                        This keeps the user/assistant alternation contract
                        (Anthropic requires it) AND gives the model context.
                        See plan §1.B.
- TURN_STARTED / TURN_COMPLETED / SKILL_ACTIVATED / INTERRUPT_* /
  CONVERSATION_FORKED / TOOL_CALL_REQUESTED/APPROVED/DENIED/FAILED →
  metadata; skipped in LLM projection (they inform UI / audit, not model).

Auto-compaction (P1.B minimum · full Claude-style in P2.B): if the event
stream is larger than ``max_history_events``, drop the oldest non-summary
events (keeping any SUMMARY events which themselves represent compressed
older history).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING, Any

from allhands.core import ConversationEvent, EventKind, TurnAbortReason

if TYPE_CHECKING:
    from allhands.core import Employee, SkillRuntime
    from allhands.execution.skills import SkillRegistry
    from allhands.persistence.repositories import ConversationEventRepo


# Synthetic assistant messages for TURN_ABORTED — kept short so they don't
# dominate the prompt. The model only needs to know "this is what happened
# before your current turn".
_ABORT_SYNTHETIC_ASSISTANT: dict[TurnAbortReason, str] = {
    TurnAbortReason.USER_SUPERSEDED: (
        "(The user sent a new message before I finished my previous reply. "
        "I'll address their latest message now.)"
    ),
    TurnAbortReason.STREAM_ERROR: (
        "(My previous reply was cut short by a stream error. "
        "Continuing based on the user's latest message.)"
    ),
    TurnAbortReason.CRASH_RECOVERY: (
        "(A previous turn did not complete due to a process restart. "
        "Resuming from the user's latest message.)"
    ),
    TurnAbortReason.CONCURRENT_WRITE_REJECTED: (
        "(A concurrent send from another client was rejected. "
        "Continuing with the authoritative user message.)"
    ),
    TurnAbortReason.CLIENT_DISCONNECT: ("(The client disconnected mid-turn. Resuming.)"),
}


def _synthetic_abort_message(reason: TurnAbortReason | str) -> str:
    """Return the synthetic assistant text for a given abort reason. Unknown
    reasons fall back to a generic placeholder so the alternation contract
    is never broken."""
    try:
        key = TurnAbortReason(reason)
    except ValueError:
        return "(Previous turn did not complete.)"
    return _ABORT_SYNTHETIC_ASSISTANT[key]


def _extract_text(content_json: dict[str, Any]) -> str:
    """Pull the ``content`` string out of a USER / ASSISTANT event's
    content_json. If ``content_blocks`` is present, fall through to its
    first text block; default to ""."""
    raw = content_json.get("content")
    if isinstance(raw, str):
        return raw
    blocks = content_json.get("content_blocks")
    if isinstance(blocks, list):
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "text":
                txt = block.get("text")
                if isinstance(txt, str):
                    return txt
    return ""


def _project_assistant(event: ConversationEvent) -> dict[str, Any]:
    """ASSISTANT events may carry any of three shapes, in priority order:

    1. ``content_blocks`` — already Anthropic-style (text + tool_use).
       Pass through verbatim.
    2. ``tool_calls`` — our internal ToolCall dicts (id, tool_id, args,
       status, result, ...). Reconstruct Anthropic-style content_blocks
       so the LLM sees the tool_use it originally emitted. Required for
       history validation: when a prior turn's tool_use has no paired
       tool_result, ``fill_orphan_tool_results`` can only detect it when
       the tool_use block is visible.
    3. Flat ``content`` — plain text, no tool usage.
    """
    blocks = event.content_json.get("content_blocks")
    if isinstance(blocks, list) and blocks:
        return {"role": "assistant", "content": list(blocks), "id": event.id}

    # Reconstruct content_blocks from tool_calls if present — defensive
    # against ASSISTANT events written by _persist_turn_events (which
    # stores ToolCall dicts, not Anthropic blocks).
    tool_calls = event.content_json.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        text = event.content_json.get("content", "") or ""
        reconstructed: list[dict[str, Any]] = []
        if isinstance(text, str) and text.strip():
            reconstructed.append({"type": "text", "text": text})
        for tc in tool_calls:
            if not isinstance(tc, dict):
                continue
            tc_id = tc.get("id")
            tc_name = tc.get("tool_id") or tc.get("name") or ""
            tc_args = tc.get("args") or tc.get("arguments") or {}
            if not isinstance(tc_id, str):
                continue
            reconstructed.append(
                {
                    "type": "tool_use",
                    "id": tc_id,
                    "name": str(tc_name),
                    "input": tc_args if isinstance(tc_args, dict) else {},
                }
            )
        if reconstructed:
            return {"role": "assistant", "content": reconstructed, "id": event.id}

    return {
        "role": "assistant",
        "content": event.content_json.get("content", ""),
        "id": event.id,
    }


def _project_tool_result(event: ConversationEvent) -> dict[str, Any] | None:
    """TOOL_CALL_EXECUTED / TOOL_CALL_FAILED both project to a tool message.
    We surface the tool_use_id so pairing with the assistant's tool_use
    block works on the LLM side."""
    content = event.content_json.get("content")
    tool_use_id = event.content_json.get("tool_use_id") or event.content_json.get("tool_call_id")
    if tool_use_id is None:
        return None
    if content is None and event.kind == EventKind.TOOL_CALL_FAILED:
        content = event.content_json.get("error") or "Tool call failed."
    if isinstance(content, (dict, list)):
        # Most providers accept string content; serialize dict/list via JSON
        # for compatibility with Qwen/OpenAI-compat gateways.
        import json as _json

        content = _json.dumps(content, ensure_ascii=False)
    return {
        "role": "tool",
        "tool_call_id": str(tool_use_id),
        "content": content if isinstance(content, str) else str(content or ""),
        "id": event.id,
    }


def _project_summary(event: ConversationEvent) -> dict[str, Any]:
    """A SUMMARY event is injected as a user-role reminder (Claude's
    compact-rebuild pattern · V08 § 2.3). Putting it as ``user`` preserves
    the alternation contract with the ensuing assistant turn.

    The ``_synthetic`` flag marks this message as projection-derived so the
    consecutive-user merger doesn't fuse it with a following real user msg.
    """
    text = event.content_json.get("summary_text") or event.content_json.get("summary", "")
    covers = event.content_json.get("covers_sequence_range")
    prefix = "<previous_conversation_summary>\n"
    suffix = "\n</previous_conversation_summary>"
    if covers:
        prefix = f"<previous_conversation_summary covers_events='{covers}'>\n"
    return {
        "role": "user",
        "content": f"{prefix}{text}{suffix}",
        "id": event.id,
        "_synthetic": True,
    }


def _render_skill_descriptors_block(
    employee: Employee,
    runtime: SkillRuntime,
    skill_registry: SkillRegistry | None,
) -> str:
    """Mirror of ``execution.skills.render_skill_descriptors`` but scoped to
    the employee's mounted skill_ids. Lives here so context_builder stays
    self-contained for test harnesses that don't wire a full SkillRegistry."""
    if skill_registry is None:
        return ""
    if not employee.skill_ids:
        return ""
    lines: list[str] = []
    for sid in employee.skill_ids:
        descriptor = skill_registry.get_descriptor(sid)
        if descriptor is None:
            continue
        lines.append(f"- {descriptor.id}: {descriptor.description}")
    if not lines:
        return ""
    header = 'Available skills (call resolve_skill("<id>") to activate):'
    return header + "\n" + "\n".join(lines)


def _compose_system_prompt(
    employee: Employee,
    runtime: SkillRuntime,
    skill_registry: SkillRegistry | None,
    system_override: str | None,
    extra_system_events: Iterable[ConversationEvent],
) -> str:
    parts: list[str] = []
    if system_override:
        override = system_override.strip()
        if override:
            parts.append(override)
    base = (employee.system_prompt or "").strip()
    if base:
        parts.append(base)
    descriptors_block = _render_skill_descriptors_block(employee, runtime, skill_registry)
    if descriptors_block:
        parts.append(descriptors_block)
    for fragment in runtime.resolved_fragments:
        frag = (fragment or "").strip()
        if frag:
            parts.append(frag)
    for evt in extra_system_events:
        text = evt.content_json.get("content") or evt.content_json.get("text") or ""
        text = text.strip() if isinstance(text, str) else ""
        if text:
            parts.append(text)
    return "\n\n".join(parts).strip()


def _merge_consecutive_user_messages(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Claude Code alternation contract: Anthropic rejects consecutive user
    messages. If — despite TURN_ABORTED synthesis — we still end up with
    two user messages back-to-back (e.g. legacy data, tests, edge cases),
    merge them with a ``(Follow-up)`` separator so the shape stays valid.

    This is the P2.D concern surfaced early in plan §1; doing it here keeps
    the invariant enforced at a single choke point.
    """
    out: list[dict[str, Any]] = []
    for msg in messages:
        if (
            out
            and msg["role"] == "user"
            and out[-1]["role"] == "user"
            and isinstance(msg["content"], str)
            and isinstance(out[-1]["content"], str)
            and not out[-1].get("_synthetic")
            and not msg.get("_synthetic")
        ):
            out[-1] = {
                **out[-1],
                "content": out[-1]["content"] + "\n\n(Follow-up) " + msg["content"],
            }
        else:
            out.append(msg)
    # Strip the internal marker before returning to caller
    return [{k: v for k, v in m.items() if k != "_synthetic"} for m in out]


async def build_llm_context(
    conversation_id: str,
    employee: Employee,
    runtime: SkillRuntime,
    event_repo: ConversationEventRepo,
    *,
    skill_registry: SkillRegistry | None = None,
    system_override: str | None = None,
    max_history_events: int = 200,
    include_compacted: bool = False,
    subagent_id: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Read the event log and project it into ``(system_prompt, messages)``.

    - ``include_compacted=False`` (default) hides events that have been
      covered by a SUMMARY event (Claude's compact pattern). The SUMMARY
      itself still shows up and stands in for the covered range.
    - ``max_history_events`` is a safety cap — legacy / runaway conversations
      get truncated to the most recent N events (keeping any SUMMARY events
      so long-term memory survives). Full Claude-style auto-compact with
      circuit breaker + summarization lives in P2.B.
    - ``subagent_id=None`` projects the main conversation; a specific id
      projects a subagent sidechain (P3.A). ``"*"`` means "include
      everything" (debug only).

    Returns: (system_prompt, messages). ``messages`` is a list of dicts the
    runner can hand directly to LangChain / provider adapters.
    """
    events = await event_repo.list_by_conversation(
        conversation_id,
        include_compacted=include_compacted,
        subagent_id=subagent_id,
    )

    # Safety cap — keep all SUMMARY events (long-term memory) + recent tail.
    if len(events) > max_history_events:
        summaries = [e for e in events if e.kind == EventKind.SUMMARY]
        non_summary_tail = [e for e in events if e.kind != EventKind.SUMMARY]
        kept_tail = non_summary_tail[-max_history_events:]
        events = sorted(summaries + kept_tail, key=lambda e: e.sequence)

    system_events: list[ConversationEvent] = []
    messages: list[dict[str, Any]] = []

    for evt in events:
        kind = evt.kind

        if kind == EventKind.USER:
            messages.append(
                {
                    "role": "user",
                    "content": _extract_text(evt.content_json),
                    "id": evt.id,
                }
            )
        elif kind == EventKind.ASSISTANT:
            messages.append(_project_assistant(evt))
        elif kind in (EventKind.TOOL_CALL_EXECUTED, EventKind.TOOL_CALL_FAILED):
            projected = _project_tool_result(evt)
            if projected is not None:
                messages.append(projected)
        elif kind == EventKind.SUMMARY:
            messages.append(_project_summary(evt))
        elif kind == EventKind.TURN_ABORTED:
            # Synthesize an assistant reply so the alternation contract
            # holds and the model knows why there's a gap. The actual
            # reason lives in content_json["reason"].
            reason = evt.content_json.get("reason", "")
            messages.append(
                {
                    "role": "assistant",
                    "content": _synthetic_abort_message(reason),
                    "id": evt.id,
                }
            )
        elif kind == EventKind.SYSTEM:
            system_events.append(evt)
        # TURN_STARTED / TURN_COMPLETED / SKILL_ACTIVATED / INTERRUPT_*
        # / TOOL_CALL_REQUESTED / TOOL_CALL_APPROVED / TOOL_CALL_DENIED
        # / CONVERSATION_FORKED → metadata, skipped in LLM projection.

    messages = _merge_consecutive_user_messages(messages)

    # P3.D · fill any orphaned tool_use blocks with a placeholder
    # tool_result so Anthropic / OpenAI don't 400 with 'orphan tool_use'.
    # Happens when the process crashed between an assistant's tool_use
    # emission and the tool executor's result write.
    from allhands.services.chain_repair import fill_orphan_tool_results

    messages = fill_orphan_tool_results(messages)

    system_prompt = _compose_system_prompt(
        employee=employee,
        runtime=runtime,
        skill_registry=skill_registry,
        system_override=system_override,
        extra_system_events=system_events,
    )
    return system_prompt, messages
