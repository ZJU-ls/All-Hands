"""ConfirmationGate — intercepts WRITE+ tool calls before execution."""

from __future__ import annotations

import asyncio
import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from allhands.core import Confirmation, ConfirmationStatus, Tool

if TYPE_CHECKING:
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
    """Real gate: writes Confirmation to DB, enqueues SSE event, polls for resolution."""

    def __init__(
        self,
        confirmation_repo: ConfirmationRepo,
        event_queue: asyncio.Queue[dict[str, object]],
        ttl_seconds: int = 300,
    ) -> None:
        self._repo = confirmation_repo
        self._queue = event_queue
        self._ttl = ttl_seconds

    async def request(
        self,
        tool: Tool,
        args: dict[str, object],
        tool_call_id: str,
        rationale: str,
        summary: str,
        diff: dict[str, object] | None = None,
    ) -> GateOutcome:
        now = datetime.now(UTC)
        confirmation = Confirmation(
            id=str(uuid.uuid4()),
            tool_call_id=tool_call_id,
            rationale=rationale,
            summary=summary,
            diff=diff,
            status=ConfirmationStatus.PENDING,
            created_at=now,
            expires_at=now + timedelta(seconds=self._ttl),
        )
        await self._repo.save(confirmation)

        await self._queue.put(
            {
                "type": "confirm_required",
                "confirmation_id": confirmation.id,
                "tool_call_id": tool_call_id,
                "summary": summary,
                "rationale": rationale,
                "diff": diff,
            }
        )

        deadline = confirmation.expires_at
        while True:
            await asyncio.sleep(1.0)
            updated = await self._repo.get(confirmation.id)
            if updated is None:
                return "expired"
            if updated.status == ConfirmationStatus.APPROVED:
                await self._queue.put(
                    {
                        "type": "confirm_resolved",
                        "confirmation_id": confirmation.id,
                        "status": "approved",
                    }
                )
                return "approved"
            if updated.status == ConfirmationStatus.REJECTED:
                await self._queue.put(
                    {
                        "type": "confirm_resolved",
                        "confirmation_id": confirmation.id,
                        "status": "rejected",
                    }
                )
                return "rejected"
            if datetime.now(UTC) > deadline:
                await self._repo.update_status(confirmation.id, ConfirmationStatus.EXPIRED)
                await self._queue.put(
                    {
                        "type": "confirm_resolved",
                        "confirmation_id": confirmation.id,
                        "status": "expired",
                    }
                )
                return "expired"
