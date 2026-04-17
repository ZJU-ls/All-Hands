"""ConfirmationService — approve/reject/list confirmations."""

from __future__ import annotations

from typing import TYPE_CHECKING

from allhands.core import Confirmation, ConfirmationStatus

if TYPE_CHECKING:
    from allhands.persistence.repositories import ConfirmationRepo


class ConfirmationService:
    def __init__(self, repo: ConfirmationRepo) -> None:
        self._repo = repo

    async def get(self, confirmation_id: str) -> Confirmation | None:
        return await self._repo.get(confirmation_id)

    async def list_pending(self) -> list[Confirmation]:
        return await self._repo.list_pending()

    async def approve(self, confirmation_id: str) -> None:
        await self._repo.update_status(confirmation_id, ConfirmationStatus.APPROVED)

    async def reject(self, confirmation_id: str) -> None:
        await self._repo.update_status(confirmation_id, ConfirmationStatus.REJECTED)
