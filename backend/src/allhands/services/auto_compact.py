"""ADR 0017 · P2.B — auto-compaction for long conversations.

Modeled on Claude Code's ``autoCompact.ts`` (ref-src-claude/V08 § 2.2-2.4).

When the event log grows past a threshold, call a small summarizer model
on the oldest portion, emit a ``SUMMARY`` event covering that range, and
mark the covered events ``is_compacted=True``. ``build_llm_context``
already filters out compacted events by default and wraps SUMMARY events
as ``user``-role reminders — so the LLM sees the compressed narrative
instead of the raw oldest turns.

The original events are never deleted: compaction is a *projection
shortcut*, not destructive history editing (Claude Code's key design
invariant).

Circuit breaker: 3 consecutive failures → stop trying for this
conversation until reset. Prevents wedging the event log with retry
storms when the summarizer model itself is OOM / off / quota exceeded.

PTL (Prompt Too Long) fallback: if the summarize call itself returns a
context-window error, strip the oldest 20% of the payload and retry up
to 5 times, each halving the remaining weight. This mirrors Claude's
``compactWithPTLFallback``.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core import ConversationEvent, EventKind

if TYPE_CHECKING:
    from allhands.persistence.repositories import ConversationEventRepo


log = logging.getLogger(__name__)


# Approximate tokens per character — a rough proxy sufficient for
# thresholding without pulling in tiktoken. English averages ~4 chars/
# token, CJK averages ~1.5 chars/token, so we bias toward English since
# overshooting a trigger is cheap and undershooting is not.
_CHARS_PER_TOKEN = 4


# Default thresholds — can be tuned per deployment.
_DEFAULT_TRIGGER_RATIO = 0.7  # compact when est tokens > 70% of window
_DEFAULT_BUFFER_TOKENS = 13_000  # reserve for the next turn + summary IO
_DEFAULT_SUMMARY_RESERVE = 20_000  # Claude Code parity


# Per-conversation circuit breaker state.
@dataclass
class _CircuitState:
    consecutive_failures: int = 0


@dataclass
class CompactionConfig:
    """Compaction knobs. Overridable via environment / config in prod."""

    context_window_tokens: int = 128_000
    trigger_ratio: float = _DEFAULT_TRIGGER_RATIO
    buffer_tokens: int = _DEFAULT_BUFFER_TOKENS
    summary_reserve_tokens: int = _DEFAULT_SUMMARY_RESERVE
    max_circuit_failures: int = 3
    max_ptl_retries: int = 5
    ptl_strip_ratio: float = 0.2

    def effective_window(self) -> int:
        """Usable window after reserving space for summary IO + next turn."""
        return max(
            1000,
            self.context_window_tokens - self.summary_reserve_tokens,
        )

    def trigger_threshold(self) -> int:
        """Token count at which compaction should fire."""
        return int(self.effective_window() * self.trigger_ratio)


@dataclass
class CompactionResult:
    compacted: bool
    events_covered: int = 0
    summary_event_id: str | None = None
    failure_reason: str | None = None
    circuit_open: bool = False


# Summarizer callable: given a list of {role, content} dicts, returns
# a short prose summary. The real implementation lives in chat_service
# (it has access to the provider + model) — this module stays pure so
# tests can inject a fake summarizer.
Summarizer = "Callable[[list[dict[str, object]]], Awaitable[str]]"


def estimate_tokens_for_events(events: list[ConversationEvent]) -> int:
    """Character-count / 4 heuristic for a list of events."""
    chars = 0
    for e in events:
        chars += _estimate_chars_for_event(e)
    return chars // _CHARS_PER_TOKEN


def _estimate_chars_for_event(event: ConversationEvent) -> int:
    body = event.content_json
    # Pydantic guarantees dict shape per the core model, but keep the
    # estimator robust to future changes without tripping mypy's
    # unreachable check.
    # Common shapes we care about:
    # - {"content": "..."} (user/assistant/tool/summary/system)
    # - {"content_blocks": [{"type": "text", "text": "..."}, ...]}
    # - {"summary_text": "..."}
    total = 0
    c = body.get("content")
    if isinstance(c, str):
        total += len(c)
    blocks = body.get("content_blocks")
    if isinstance(blocks, list):
        for b in blocks:
            if isinstance(b, dict):
                t = b.get("text") or b.get("content") or ""
                if isinstance(t, str):
                    total += len(t)
    st = body.get("summary_text")
    if isinstance(st, str):
        total += len(st)
    return total


@dataclass
class AutoCompactManager:
    """Per-process circuit breaker + auto-compact entry point."""

    config: CompactionConfig = field(default_factory=CompactionConfig)
    _circuits: dict[str, _CircuitState] = field(default_factory=dict)

    def should_try_compact(self, conversation_id: str, events: list[ConversationEvent]) -> bool:
        """True if estimated tokens exceed the trigger threshold AND the
        circuit breaker is closed."""
        if self._is_circuit_open(conversation_id):
            return False
        # Count only non-compacted events — there's no point re-compacting
        # already-compressed ranges.
        live_events = [e for e in events if not e.is_compacted]
        est = estimate_tokens_for_events(live_events)
        return est >= self.config.trigger_threshold()

    def _is_circuit_open(self, conversation_id: str) -> bool:
        cs = self._circuits.get(conversation_id)
        return cs is not None and cs.consecutive_failures >= self.config.max_circuit_failures

    def _record_failure(self, conversation_id: str) -> None:
        cs = self._circuits.setdefault(conversation_id, _CircuitState())
        cs.consecutive_failures += 1

    def _record_success(self, conversation_id: str) -> None:
        self._circuits[conversation_id] = _CircuitState()  # reset

    def reset_circuit(self, conversation_id: str) -> None:
        self._circuits.pop(conversation_id, None)

    async def maybe_compact(
        self,
        conversation_id: str,
        event_repo: ConversationEventRepo,
        summarizer: Any,
        *,
        subagent_id: str | None = None,
    ) -> CompactionResult:
        """Check threshold; if exceeded, run the compaction pipeline.

        Returns a CompactionResult describing what happened. Never raises
        for expected paths (circuit open, below threshold, summarizer
        failure) — those return ``compacted=False`` with a reason.
        """
        events = await event_repo.list_by_conversation(
            conversation_id, include_compacted=True, subagent_id=subagent_id
        )
        if not self.should_try_compact(conversation_id, events):
            if self._is_circuit_open(conversation_id):
                return CompactionResult(compacted=False, circuit_open=True)
            return CompactionResult(compacted=False)

        # Identify the oldest half that we'll compress. Keep the most
        # recent half fresh (Claude Code pattern: summary replaces the
        # older turns, recent turns stay verbatim).
        live = [e for e in events if not e.is_compacted]
        # Preserve any existing SUMMARY events in the "old" half — they
        # are themselves compressed memory and we'll just leave them.
        eligible = [e for e in live if e.kind != EventKind.SUMMARY]
        if len(eligible) < 4:
            # Not enough events to meaningfully compact; ignore.
            return CompactionResult(compacted=False)

        split_at = len(eligible) // 2
        old_half = eligible[:split_at]
        if not old_half:
            return CompactionResult(compacted=False)

        covers_range = (old_half[0].sequence, old_half[-1].sequence)
        summary_messages = _events_to_summarizer_input(old_half)

        summary_text = await self._summarize_with_ptl_retries(
            summarizer, summary_messages, conversation_id
        )
        if summary_text is None:
            return CompactionResult(
                compacted=False, failure_reason="summarizer_failed_even_after_ptl"
            )

        # Append SUMMARY event + mark old_half compacted. The SUMMARY
        # event's sequence comes AFTER the last event being covered so
        # projection ordering stays sane.
        summary_event_id = str(uuid.uuid4())
        await event_repo.append(
            ConversationEvent(
                id=summary_event_id,
                conversation_id=conversation_id,
                parent_id=None,
                sequence=await event_repo.next_sequence(conversation_id),
                kind=EventKind.SUMMARY,
                content_json={
                    "summary_text": summary_text,
                    "covers_sequence_range": list(covers_range),
                    "events_covered": len(old_half),
                },
                subagent_id=subagent_id,
                turn_id=None,
                idempotency_key=None,
                is_compacted=False,
                created_at=datetime.now(UTC),
            )
        )
        await event_repo.mark_compacted([e.id for e in old_half])

        self._record_success(conversation_id)
        return CompactionResult(
            compacted=True,
            events_covered=len(old_half),
            summary_event_id=summary_event_id,
        )

    async def _summarize_with_ptl_retries(
        self,
        summarizer: Any,
        messages: list[dict[str, object]],
        conversation_id: str,
    ) -> str | None:
        """Attempt the summarize call, on PTL-like failure strip 20% of
        the oldest input and retry up to config.max_ptl_retries."""
        attempt = 0
        payload = list(messages)
        while attempt <= self.config.max_ptl_retries:
            try:
                text: Any = await summarizer(payload)
                if text and text.strip():
                    return str(text.strip())
                # Empty summary — treat as failure
                self._record_failure(conversation_id)
                return None
            except Exception as exc:
                exc_text = str(exc).lower()
                is_ptl = (
                    "too long" in exc_text
                    or "context" in exc_text
                    or "prompt" in exc_text
                    or "tokens" in exc_text
                )
                if not is_ptl:
                    log.warning(
                        "auto_compact.summarize_failed_not_ptl",
                        extra={
                            "conversation_id": conversation_id,
                            "error": str(exc)[:200],
                        },
                    )
                    self._record_failure(conversation_id)
                    return None
                # PTL — strip the oldest 20% and try again
                strip = max(1, int(len(payload) * self.config.ptl_strip_ratio))
                payload = payload[strip:]
                attempt += 1
                if not payload:
                    self._record_failure(conversation_id)
                    return None
        self._record_failure(conversation_id)
        return None


def _events_to_summarizer_input(events: list[ConversationEvent]) -> list[dict[str, object]]:
    """Convert events to the same {role, content} shape we send to the
    LLM elsewhere, so the summarizer sees real prose rather than our
    internal event schema."""
    out: list[dict[str, object]] = []
    for e in events:
        body = e.content_json
        if e.kind == EventKind.USER:
            out.append({"role": "user", "content": body.get("content", "")})
        elif e.kind == EventKind.ASSISTANT:
            content = body.get("content", "")
            if not content:
                blocks = body.get("content_blocks")
                if isinstance(blocks, list):
                    content = " ".join(
                        b.get("text", "")
                        for b in blocks
                        if isinstance(b, dict) and b.get("type") == "text"
                    )
            out.append({"role": "assistant", "content": content})
        elif e.kind == EventKind.SUMMARY:
            out.append(
                {
                    "role": "user",
                    "content": f"<earlier summary>\n{body.get('summary_text', '')}\n</earlier summary>",
                }
            )
    return out
