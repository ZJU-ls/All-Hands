"""Per-model token pricing endpoints (REST half of L01 parity).

Mirrors the 3 Meta Tools in ``execution/tools/meta/pricing_tools.py``. The
REST entry is what the read-only ``/observatory/pricing`` page calls; the
Meta Tool entry is what the Lead Agent / curator employee uses.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from allhands.api.deps import get_session
from allhands.i18n import t
from allhands.persistence.sql_repos import SqlModelPriceRepo
from allhands.services.pricing_service import PricingService

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


router = APIRouter(prefix="/pricing", tags=["pricing"])


class PriceRowDto(BaseModel):
    model_ref: str
    input_per_million_usd: float
    output_per_million_usd: float
    source: str = Field(..., description="'code' = built-in seed · 'db' = runtime overlay")
    source_url: str | None = None
    note: str | None = None
    updated_at: str | None = None
    updated_by_run_id: str | None = None


class PriceListResponse(BaseModel):
    prices: list[PriceRowDto]
    count: int
    db_count: int
    code_count: int


class UpsertPriceRequest(BaseModel):
    input_per_million_usd: float = Field(..., ge=0)
    output_per_million_usd: float = Field(..., ge=0)
    source_url: str = Field(..., min_length=1)
    note: str | None = None


@router.get("/models", response_model=PriceListResponse)
async def list_prices(session: AsyncSession = Depends(get_session)) -> PriceListResponse:
    svc = PricingService(price_repo=SqlModelPriceRepo(session))
    rows = await svc.list_all()
    return PriceListResponse(
        prices=[
            PriceRowDto(
                model_ref=r.model_ref,
                input_per_million_usd=r.input_per_million_usd,
                output_per_million_usd=r.output_per_million_usd,
                source=r.source,
                source_url=r.source_url,
                note=r.note,
                updated_at=r.updated_at.isoformat() if r.updated_at else None,
                updated_by_run_id=r.updated_by_run_id,
            )
            for r in rows
        ],
        count=len(rows),
        db_count=sum(1 for r in rows if r.source == "db"),
        code_count=sum(1 for r in rows if r.source == "code"),
    )


@router.put("/models/{model_ref:path}", response_model=PriceRowDto)
async def upsert_price(
    model_ref: str,
    body: UpsertPriceRequest,
    session: AsyncSession = Depends(get_session),
) -> PriceRowDto:
    if not model_ref:
        raise HTTPException(status_code=400, detail=t("errors.invalid_request"))
    svc = PricingService(price_repo=SqlModelPriceRepo(session))
    entry = await svc.upsert(
        model_ref=model_ref,
        input_per_million_usd=body.input_per_million_usd,
        output_per_million_usd=body.output_per_million_usd,
        source_url=body.source_url,
        note=body.note,
    )
    return PriceRowDto(
        model_ref=entry.model_ref,
        input_per_million_usd=entry.input_per_million_usd,
        output_per_million_usd=entry.output_per_million_usd,
        source=entry.source,
        source_url=entry.source_url,
        note=entry.note,
        updated_at=entry.updated_at.isoformat() if entry.updated_at else None,
        updated_by_run_id=entry.updated_by_run_id,
    )


@router.delete("/models/{model_ref:path}")
async def delete_override(
    model_ref: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    svc = PricingService(price_repo=SqlModelPriceRepo(session))
    removed = await svc.delete_override(model_ref)
    return {"model_ref": model_ref, "removed": removed}
