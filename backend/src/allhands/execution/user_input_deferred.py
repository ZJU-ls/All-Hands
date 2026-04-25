"""ADR 0019 C3 · UserInputDeferred · clarification flow signal.

Mirrors ConfirmationDeferred but resolves to ``answered`` (with the
answers dict as payload) instead of ``approved`` / ``rejected``. The
tool_pipeline's Defer branch sees ``outcome.kind == "answered"`` and
merges ``outcome.payload`` (the answers dict) into the executor's
input before invoking it — so ``ask_user_question_executor`` receives
``answers={label: choice}`` and just echoes it back to the LLM.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from allhands.core import UserInput, UserInputQuestion, UserInputStatus
from allhands.execution.deferred import (
    DeferredOutcome,
    DeferredRequest,
    DeferredSignal,
)

if TYPE_CHECKING:
    from allhands.persistence.repositories import UserInputRepo


class UserInputDeferred(DeferredSignal):
    """Suspend awaiting user clarification (multiple-choice answers).

    publish() writes a PENDING UserInput row with the questions list and
    expires_at = now + ttl_seconds.
    wait() polls every poll_interval_s; resolves on:
      - row.status == ANSWERED → outcome("answered", payload=answers_dict)
      - row.status == EXPIRED  → outcome("expired")
      - now > row.expires_at   → outcome("expired") + flip row to EXPIRED
      - row missing            → outcome("expired") (defensive)

    TTL defaults to 600s (10 minutes) — clarification answers can take
    longer than confirmations because the user may need to think.
    """

    def __init__(
        self,
        repo: UserInputRepo,
        ttl_seconds: float = 600,
        poll_interval_s: float = 1.0,
    ) -> None:
        self._repo = repo
        self._ttl = ttl_seconds
        self._poll = poll_interval_s

    async def publish(  # type: ignore[override]
        self,
        *,
        tool_use_id: str,
        questions: list[dict[str, object]] | list[UserInputQuestion] | None = None,
        **_: object,
    ) -> DeferredRequest:
        now = datetime.now(UTC)
        ui_id = str(uuid.uuid4())
        normalized: list[UserInputQuestion] = []
        for q in questions or []:
            if isinstance(q, UserInputQuestion):
                normalized.append(q)
            elif isinstance(q, dict):
                normalized.append(UserInputQuestion.model_validate(q))
        ui = UserInput(
            id=ui_id,
            tool_call_id=tool_use_id,
            questions=normalized,
            answers={},
            status=UserInputStatus.PENDING,
            created_at=now,
            expires_at=now + timedelta(seconds=self._ttl),
        )
        await self._repo.save(ui)
        return DeferredRequest(request_id=ui_id, confirmation_id=ui_id)

    async def wait(self, req: DeferredRequest) -> DeferredOutcome:
        ui_id = req.confirmation_id or req.request_id
        if not ui_id:
            return DeferredOutcome(kind="expired")
        while True:
            current = await self._repo.get(ui_id)
            if current is None:
                return DeferredOutcome(kind="expired")
            if current.status == UserInputStatus.ANSWERED:
                return DeferredOutcome(kind="answered", payload=dict(current.answers))
            if current.status == UserInputStatus.EXPIRED:
                return DeferredOutcome(kind="expired", payload=current)
            if datetime.now(UTC) > current.expires_at:
                await self._repo.update_status(ui_id, UserInputStatus.EXPIRED)
                return DeferredOutcome(kind="expired")
            await asyncio.sleep(self._poll)


__all__ = ["UserInputDeferred"]
