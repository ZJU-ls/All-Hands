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


class InterruptConfirmationGate(BaseGate):
    """LangGraph-native gate (ADR 0014 · Phase 4c).

    Instead of writing a Confirmation row to DB and polling it, this gate
    calls ``langgraph.types.interrupt(value)`` which pauses the graph at
    the tool-node's invocation point. LangGraph's checkpointer captures
    the pre-pause state; the next runner invocation with
    ``Command(resume=<decision>)`` returns the decision from interrupt().

    Contract:
      - Must run inside a graph node executed through a graph compiled
        with a checkpointer. Outside LangGraph (unit-level tool calls) the
        interrupt() call will raise — that's by design: a WRITE tool being
        invoked outside a gated graph is a contract violation.
      - The pre-interrupt portion of ``request()`` is minimal on purpose:
        LangGraph re-executes the node on resume (from the top) so any
        side effect before ``interrupt()`` runs twice. We stash only the
        interrupt payload here; the "write a Confirmation row for the
        pending-confirmations API" concern is moved up to
        ``chat_service._persist_assistant_reply`` which taps the
        InterruptEvent and writes the row exactly once per pause.

    Decision mapping:
      - resume="approve" → "approved" → tool executes
      - resume="reject"  → "rejected" → tool execution skipped
      - anything else     → "expired" (conservative default)
    """

    def __init__(self, ttl_seconds: int = 300) -> None:
        # ttl_seconds kept on the class for symmetry with PersistentConfirmationGate
        # + future timeout enforcement (Phase 5 cleanup job). For now, LangGraph
        # pauses indefinitely and relies on the user to respond.
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
        # Deferred import: interrupt() is only callable inside a LangGraph
        # node execution. Importing at call time keeps gate.py usable in
        # test contexts that construct BaseGate subclasses without pulling
        # LangGraph into memory.
        from langgraph.types import interrupt as lg_interrupt

        payload: dict[str, object] = {
            "kind": "confirm_required",
            "tool_call_id": tool_call_id,
            "summary": summary,
            "rationale": rationale,
        }
        if diff is not None:
            payload["diff"] = diff

        # First call: raises GraphInterrupt → graph pauses → whole astream
        # terminates (the runner's multi-mode stream surfaces this as an
        # InterruptEvent to the frontend).
        # Resume call: returns the value that was passed as Command(resume=...).
        decision_raw = lg_interrupt(payload)

        if decision_raw == "approve":
            return "approved"
        if decision_raw == "reject":
            return "rejected"
        # Unknown / malformed resume value → treat as expired. Better than
        # silently approving an unknown string or blowing up here.
        return "expired"


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
