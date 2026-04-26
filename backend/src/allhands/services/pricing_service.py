"""Application service for the runtime price overlay.

Single source of truth behind the REST router and the 3 Meta Tools so the
two entry points cannot drift (Tool First · L01).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import ModelPriceEntry
from allhands.services.model_pricing import list_all_with_source

if TYPE_CHECKING:
    from allhands.persistence.repositories import ModelPriceRepo


class PricingService:
    def __init__(self, *, price_repo: ModelPriceRepo) -> None:
        self._repo = price_repo

    async def list_all(self) -> list[ModelPriceEntry]:
        """Merged list · DB rows + un-overridden code seeds."""
        db_entries = await self._repo.list_all()
        return list_all_with_source(overlay_entries=db_entries)

    async def upsert(
        self,
        *,
        model_ref: str,
        input_per_million_usd: float,
        output_per_million_usd: float,
        source_url: str,
        note: str | None = None,
        updated_by_run_id: str | None = None,
    ) -> ModelPriceEntry:
        entry = ModelPriceEntry(
            model_ref=model_ref,
            input_per_million_usd=input_per_million_usd,
            output_per_million_usd=output_per_million_usd,
            source="db",
            source_url=source_url,
            note=note,
            updated_at=datetime.now(UTC),
            updated_by_run_id=updated_by_run_id,
        )
        return await self._repo.upsert(entry)

    async def delete_override(self, model_ref: str) -> bool:
        return await self._repo.delete(model_ref)
