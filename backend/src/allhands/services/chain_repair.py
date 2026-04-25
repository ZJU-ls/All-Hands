"""ADR 0017 · P3.D — event chain repair for projection safety.

Claude Code does two kinds of chain repair during resume / projection
(ref-src-claude/V11 § 2.3):

1. ``applySnipRemovals``: when a user deletes ("snips") a message, its
   parent_id references need to be reassigned to the next surviving
   ancestor so the DAG stays connected.
2. ``recoverOrphanedParallelToolResults``: if an assistant emits multiple
   parallel tool_use blocks and some tool_results never got written
   (crash, timeout), synthesize placeholder tool_result entries so the
   LLM's next call doesn't blow up with 'orphan tool_use' errors.

This module is pure-functional like ``context_builder`` — input goes in,
repaired output comes out, nothing is mutated. Callers (context_builder,
branch_service) can drop it into their pipelines without rearranging
schema.
"""

from __future__ import annotations

from typing import Any

from allhands.core import ConversationEvent


def repair_parent_chain(
    events: list[ConversationEvent],
    *,
    snipped_ids: set[str] | None = None,
) -> list[ConversationEvent]:
    """Return events with ``parent_id`` rewritten past any snipped ids.

    If ``e.parent_id in snipped_ids``, walk backward through each
    snipped ancestor until we find a surviving predecessor (or None).
    Claude Code's ``applySnipRemovals`` is essentially this.

    ``snipped_ids`` defaults to empty — i.e. the function is a no-op
    identity transform when there's nothing to repair. Callers wanting
    automatic snip detection should pass the set of event ids they
    intend to exclude (e.g. because ``is_compacted=True`` won't change
    chain structure, but user-initiated deletes would).
    """
    snipped_ids = snipped_ids or set()
    if not snipped_ids:
        return events

    # Build a map from id → parent_id so we can walk the chain cheaply.
    parent_of = {e.id: e.parent_id for e in events}

    def _resolve(pid: str | None) -> str | None:
        while pid is not None and pid in snipped_ids:
            pid = parent_of.get(pid)
        return pid

    out: list[ConversationEvent] = []
    for e in events:
        if e.id in snipped_ids:
            continue
        repaired = _resolve(e.parent_id)
        if repaired != e.parent_id:
            # Rebuild the event with the new parent_id. Pydantic models
            # are frozen; model_copy + update is the supported path.
            out.append(e.model_copy(update={"parent_id": repaired}))
        else:
            out.append(e)
    return out


_INTERRUPTED_PLACEHOLDER = "Interrupted by user"
_CRASH_PLACEHOLDER = "(tool result missing — recovered after crash)"


def fill_orphan_tool_results(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Post-projection repair: any assistant tool_use block without a
    following tool message (``role=='tool'`` with matching
    tool_call_id) gets a synthetic placeholder tool_result so the
    provider doesn't 400 with 'orphan tool_use'.

    Operates on the ``build_llm_context`` output (role/content dicts),
    not on raw events — by the time projection completed we have the
    canonical pairing view and can detect gaps cheaply.

    **2026-04-25 (interrupt parity with Claude Code):** if the parent
    assistant carries ``_interrupted=True`` (set by ``_project_assistant``
    when the source ASSISTANT event was marked interrupted by chat_service),
    the placeholder content becomes ``"Interrupted by user"``. Otherwise
    it stays the legacy crash-recovery message. This mirrors Claude
    Code's ``yieldMissingToolResultBlocks(messages, 'Interrupted by user')``
    path — the model sees an honest signal of why the tool didn't run,
    not a confusing "crash" framing.
    """
    # Collect tool_use ids from assistant content_blocks.
    tool_use_ids: list[str] = []
    tool_use_indices: dict[str, int] = {}
    tool_use_interrupted: dict[str, bool] = {}
    tool_result_ids: set[str] = set()
    for i, msg in enumerate(messages):
        if msg.get("role") == "assistant":
            interrupted = bool(msg.get("_interrupted", False))
            content = msg.get("content")
            if isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_use":
                        tid = b.get("id")
                        if isinstance(tid, str):
                            tool_use_ids.append(tid)
                            tool_use_indices[tid] = i
                            tool_use_interrupted[tid] = interrupted
        elif msg.get("role") == "tool":
            tid = msg.get("tool_call_id")
            if isinstance(tid, str):
                tool_result_ids.add(tid)

    orphan_ids = [tid for tid in tool_use_ids if tid not in tool_result_ids]
    if not orphan_ids:
        return list(messages)

    # Insert synthetic tool messages right after the assistant that
    # emitted the orphan tool_use. We walk from the back so earlier
    # insert indices stay valid.
    out = list(messages)
    # Sort orphans by descending tool_use_indices so later inserts don't
    # shift earlier ones.
    orphan_ids.sort(key=lambda tid: -tool_use_indices[tid])
    for tid in orphan_ids:
        insert_at = tool_use_indices[tid] + 1
        placeholder = (
            _INTERRUPTED_PLACEHOLDER if tool_use_interrupted.get(tid, False) else _CRASH_PLACEHOLDER
        )
        out.insert(
            insert_at,
            {
                "role": "tool",
                "tool_call_id": tid,
                "content": placeholder,
            },
        )
    return out
