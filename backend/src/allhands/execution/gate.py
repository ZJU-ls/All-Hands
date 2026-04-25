"""ConfirmationGate — intercepts WRITE+ tool calls before execution."""

from __future__ import annotations

import asyncio
import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from allhands.core import Confirmation, ConfirmationStatus, Tool

if TYPE_CHECKING:
    from allhands.execution.deferred import DeferredOutcome, DeferredRequest
    from allhands.persistence.repositories import ConfirmationRepo

GateOutcome = Literal["approved", "rejected", "expired"]


class BaseGate(ABC):
    @abstractmethod
    async def request(
        self,
        tool: Tool,
        args: dict[str, object],
        tool_call_id: str,
        rationale: str,
        summary: str,
        diff: dict[str, object] | None = None,
    ) -> GateOutcome: ...


class AutoApproveGate(BaseGate):
    """Always approves — for tests only."""

    async def request(
        self,
        tool: Tool,
        args: dict[str, object],
        tool_call_id: str,
        rationale: str,
        summary: str,
        diff: dict[str, object] | None = None,
    ) -> GateOutcome:
        return "approved"


class AutoRejectGate(BaseGate):
    """Always rejects — for negative-path tests."""

    async def request(
        self,
        tool: Tool,
        args: dict[str, object],
        tool_call_id: str,
        rationale: str,
        summary: str,
        diff: dict[str, object] | None = None,
    ) -> GateOutcome:
        return "rejected"


class PersistentConfirmationGate(BaseGate):
    """ADR 0018 ConfirmationDeferred · writes Confirmation row, polls.

    Implements both the legacy ``BaseGate.request()`` API (still called by
    callers that haven't migrated) AND the ADR 0018 ``DeferredSignal``
    contract (``publish()`` + ``wait()``). AgentLoop uses the deferred
    surface; it gets the same row + event_queue side effects.
    """

    def __init__(
        self,
        confirmation_repo: ConfirmationRepo,
        event_queue: asyncio.Queue[dict[str, object]],
        ttl_seconds: int = 300,
        poll_interval_s: float = 1.0,
    ) -> None:
        self._repo = confirmation_repo
        self._queue = event_queue
        self._ttl = ttl_seconds
        self._poll = poll_interval_s

    # --- Legacy BaseGate API (kept for back-compat, just delegates to
    # publish+wait) -----------------------------------------------------
    async def request(
        self,
        tool: Tool,
        args: dict[str, object],
        tool_call_id: str,
        rationale: str,
        summary: str,
        diff: dict[str, object] | None = None,
    ) -> GateOutcome:
        req = await self.publish(
            tool_use_id=tool_call_id,
            summary=summary,
            rationale=rationale,
            diff=diff,
        )
        outcome = await self.wait(req)
        if outcome.kind == "approved":
            return "approved"
        if outcome.kind == "rejected":
            return "rejected"
        return "expired"

    # --- ADR 0018 DeferredSignal API ----------------------------------
    async def publish(
        self,
        *,
        tool_use_id: str,
        summary: str,
        rationale: str,
        diff: dict[str, object] | None = None,
        **_: object,
    ) -> DeferredRequest:
        from allhands.execution.deferred import DeferredRequest

        now = datetime.now(UTC)
        confirmation = Confirmation(
            id=str(uuid.uuid4()),
            tool_call_id=tool_use_id,
            rationale=rationale,
            summary=summary,
            diff=diff,
            status=ConfirmationStatus.PENDING,
            created_at=now,
            expires_at=now + timedelta(seconds=self._ttl),
        )
        await self._repo.save(confirmation)
        # Push the legacy event_queue notification so any listener (cockpit
        # feed / pending-confirmations SSE) still sees it. The AG-UI
        # ConfirmationRequested event also fires from AgentLoop separately;
        # the queue is the side channel for non-SSE consumers.
        await self._queue.put(
            {
                "type": "confirm_required",
                "confirmation_id": confirmation.id,
                "tool_call_id": tool_use_id,
                "summary": summary,
                "rationale": rationale,
                "diff": diff,
            }
        )
        return DeferredRequest(request_id=confirmation.id, confirmation_id=confirmation.id)

    async def wait(self, req: DeferredRequest) -> DeferredOutcome:
        from allhands.execution.deferred import DeferredOutcome

        cid = req.confirmation_id or req.request_id
        while True:
            await asyncio.sleep(self._poll)
            row = await self._repo.get(cid)
            if row is None:
                return DeferredOutcome(kind="expired")
            if row.status == ConfirmationStatus.APPROVED:
                await self._queue.put(
                    {"type": "confirm_resolved", "confirmation_id": cid, "status": "approved"}
                )
                return DeferredOutcome(kind="approved", payload=row)
            if row.status == ConfirmationStatus.REJECTED:
                await self._queue.put(
                    {"type": "confirm_resolved", "confirmation_id": cid, "status": "rejected"}
                )
                return DeferredOutcome(kind="rejected", payload=row)
            if datetime.now(UTC) > row.expires_at:
                await self._repo.update_status(cid, ConfirmationStatus.EXPIRED)
                await self._queue.put(
                    {"type": "confirm_resolved", "confirmation_id": cid, "status": "expired"}
                )
                return DeferredOutcome(kind="expired")
