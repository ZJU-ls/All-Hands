"""ADR 0018 · DeferredSignal · the unified suspend-and-await primitive.

A tool's executor can call ``signal.publish(...)`` to register a request
for external input (user confirmation, user reply to a question, sub-agent
completion, long task done) and ``signal.wait(req)`` to block until the
external system flips the corresponding state. The tool's coroutine
naturally awaits — the surrounding agent loop is unaware.

Crash safety: ``publish`` MUST persist the request (DB row, queue, file)
so process restart doesn't lose it. ``wait`` MUST be reconstructable
purely from the request_id (poll-and-resume pattern).
"""

from __future__ import annotations

import asyncio
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from allhands.core import Confirmation, ConfirmationStatus

if TYPE_CHECKING:
    from allhands.persistence.repositories import ConfirmationRepo


@dataclass
class DeferredRequest:
    """Returned by publish · opaque handle the loop holds while awaiting."""

    request_id: str
    confirmation_id: str | None = None  # filled for ConfirmationDeferred


# Outcome.kind enum:
#   "approved"  — user approved (confirmation) / answer received (clarification)
#   "rejected"  — user rejected
#   "expired"   — TTL elapsed before resolution
#   "answered"  — generic positive resolution (clarification answer present)
#   "completed" — sub-task / long task finished without explicit accept/reject
DeferredOutcomeKind = Literal["approved", "rejected", "expired", "answered", "completed"]


@dataclass
class DeferredOutcome:
    kind: DeferredOutcomeKind
    payload: object | None = None


class DeferredSignal(ABC):
    """Tool that needs to suspend awaiting an external signal implements this.

    Lifecycle:
      1. tool calls publish(...) → DeferredRequest
         (side effect: persist request, surface to UI)
      2. tool calls await wait(request) → DeferredOutcome
         (implementation polls the repo OR awaits an asyncio.Event,
         whatever fits the signal kind)
    """

    @abstractmethod
    async def publish(self, **kwargs: object) -> DeferredRequest: ...

    @abstractmethod
    async def wait(self, req: DeferredRequest) -> DeferredOutcome: ...


class ConfirmationDeferred(DeferredSignal):
    """Confirmation flow backed by ConfirmationRepo polling.

    publish() writes a PENDING row + sets expires_at = now + ttl.
    wait() polls every poll_interval_s; resolves on:
      - row.status == APPROVED → outcome("approved")
      - row.status == REJECTED → outcome("rejected")
      - now > row.expires_at   → outcome("expired") + flip row to EXPIRED
      - row missing            → outcome("expired") (defensive)
    """

    def __init__(
        self,
        repo: ConfirmationRepo,
        ttl_seconds: float = 300,
        poll_interval_s: float = 1.0,
    ) -> None:
        self._repo = repo
        self._ttl = ttl_seconds
        self._poll = poll_interval_s

    async def publish(  # type: ignore[override]
        self,
        *,
        tool_use_id: str,
        summary: str,
        rationale: str,
        diff: dict[str, object] | None = None,
    ) -> DeferredRequest:
        now = datetime.now(UTC)
        confirmation_id = str(uuid.uuid4())
        confirmation = Confirmation(
            id=confirmation_id,
            tool_call_id=tool_use_id,
            rationale=rationale,
            summary=summary,
            diff=diff,
            status=ConfirmationStatus.PENDING,
            created_at=now,
            expires_at=now + timedelta(seconds=self._ttl),
        )
        await self._repo.save(confirmation)
        return DeferredRequest(
            request_id=confirmation_id,
            confirmation_id=confirmation_id,
        )

    async def wait(self, req: DeferredRequest) -> DeferredOutcome:
        if req.confirmation_id is None:
            return DeferredOutcome(kind="expired")
        confirmation_id = req.confirmation_id
        while True:
            current = await self._repo.get(confirmation_id)
            if current is None:
                return DeferredOutcome(kind="expired")
            if current.status == ConfirmationStatus.APPROVED:
                return DeferredOutcome(kind="approved", payload=current)
            if current.status == ConfirmationStatus.REJECTED:
                return DeferredOutcome(kind="rejected", payload=current)
            if current.status == ConfirmationStatus.EXPIRED:
                return DeferredOutcome(kind="expired", payload=current)
            if datetime.now(UTC) > current.expires_at:
                await self._repo.update_status(confirmation_id, ConfirmationStatus.EXPIRED)
                return DeferredOutcome(kind="expired")
            await asyncio.sleep(self._poll)
